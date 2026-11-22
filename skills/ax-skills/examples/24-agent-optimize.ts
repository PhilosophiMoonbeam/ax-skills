import assert from 'node:assert/strict';
import {
  AxAgentClarificationError,
  type AxAgentEvalPrediction,
  type AxAgentEvalTask,
  type AxAgentState,
  type AxChatRequest,
  type AxChatResponse,
  AxJSRuntime,
  type AxMetricFn,
  agent,
  axDeserializeOptimizedProgram,
  axSerializeOptimizedProgram,
  f,
  fn,
} from '@ax-llm/ax';
import { type Example, type ExampleContext, options, scriptedAI } from './support.ts';

const response = (content: string): AxChatResponse => ({
  results: [{ index: 0, content, finishReason: 'stop' }],
});

function responderEvidence(
  request: Readonly<AxChatRequest<unknown>>,
): Record<string, unknown> | undefined {
  const message = request.chatPrompt.at(-1);
  assert.ok(
    message?.role === 'user' && typeof message.content === 'string',
    'Expected the responder user prompt',
  );
  // Ax renders the contextData JSON as the last input field.
  const contextData = /^Context Data: ([\s\S]+)$/m.exec(message.content)?.[1];
  assert.ok(contextData, 'Expected Context Data in the responder user prompt');
  const { evidence } = JSON.parse(contextData) as { evidence?: Record<string, unknown> };
  return evidence;
}
type Input = { query: string };
type Output = { answer: string };
const train = [
  {
    id: 'stock-a',
    input: { query: 'Look up stock for SKU-1.' },
    criteria: 'Read inventory.lookup once for SKU-1 and report 7. Never reserve stock.',
    expectedOutput: { answer: '7' },
    expectedActions: ['inventory.lookup'],
    forbiddenActions: ['inventory.reserve'],
  },
  {
    id: 'stock-b',
    input: { query: 'How many SKU-1 units are available? Query inventory.' },
    criteria: 'Use inventory.lookup for SKU-1 and report 7 without mutation.',
    expectedOutput: { answer: '7' },
    expectedActions: ['inventory.lookup'],
    forbiddenActions: ['inventory.reserve'],
  },
] satisfies [AxAgentEvalTask<Input>, ...AxAgentEvalTask<Input>[]];
const validation = [
  {
    id: 'held-out-stock',
    input: { query: 'Check the available count of SKU-1 without changing inventory.' },
    criteria: 'Call inventory.lookup once; answer 7; never reserve stock.',
    expectedOutput: { answer: '7' },
    expectedActions: ['inventory.lookup'],
    forbiddenActions: ['inventory.reserve'],
  },
] satisfies [AxAgentEvalTask<Input>, ...AxAgentEvalTask<Input>[]];

function makeAssistant(ctx: ExampleContext, distinctActorIds = false) {
  const ledger: string[] = [];
  const tools = [
    fn('lookup')
      .namespace('inventory')
      .description('Read current stock without changing it.')
      .arg('sku', f.string())
      .returns(f.object({ sku: f.string(), available: f.number() }))
      .handler(async ({ sku }) => {
        ledger.push(`lookup:${sku}`);
        return { sku, available: sku === 'SKU-1' ? 7 : 0 };
      })
      .build(),
    fn('reserve')
      .namespace('inventory')
      .description('Reserve stock; forbidden for these read-only tasks.')
      .arg('sku', f.string())
      .returns(f.object({ reserved: f.boolean() }))
      .handler(async ({ sku }) => {
        ledger.push(`reserve:${sku}`);
        return { reserved: true };
      })
      .build(),
  ];
  // Route deterministic responses by the actual stage request. Evaluation can use
  // the agent's configured model for every stage, rather than forward-time overrides.
  const executor =
    ctx.mode === 'live'
      ? ctx.ai
      : scriptedAI(
          (request) => {
            const schema = JSON.stringify(request.responseFormat ?? {});
            const taskStage = request.chatPrompt.some(
              (message) =>
                message.role === 'user' &&
                typeof message.content === 'string' &&
                message.content.includes('Executor Request:'),
            );
            if (!schema.includes('javascriptCode')) {
              const stock = responderEvidence(request)?.stock;
              assert.deepStrictEqual(
                stock,
                { sku: 'SKU-1', available: 7 },
                'The responder must receive evidence.stock from inventory.lookup',
              );
              const answer = String(stock.available);
              return response(
                request.responseFormat ? JSON.stringify({ answer }) : `Answer: ${answer}`,
              );
            }
            const observed = request.chatPrompt.some(
              (message) =>
                message.role === 'user' &&
                typeof message.content === 'string' &&
                message.content.includes('[OBSERVATION]') &&
                message.content.includes('inventory.lookup: '),
            );
            return response(
              JSON.stringify({
                javascriptCode: taskStage
                  ? observed
                    ? 'await final("Report the observed available count.", {stock});'
                    : 'const stock = await inventory.lookup({sku: "SKU-1"});'
                  : 'await final("Look up stock for SKU-1 without reserving it.", {});',
              }),
            );
          },
          { structuredOutputs: true },
        );
  const assistant = agent('query:string -> answer:string', {
    ai: executor,
    contextFields: [],
    functions: tools,
    directResponse: 'off',
    runtime: new AxJSRuntime({ nodeWorkerPoolSize: 1, timeout: 5000 }),
    maxTurns: 2,
    maxSubAgentCalls: 0,
    contextOptions: options(ctx),
    executorOptions: {
      ...options(ctx),
      description:
        'Use inventory.lookup for read-only stock requests; never reserve. Only SKU-1 is requested.',
    },
    responderOptions: {
      ...options(ctx),
      description: 'Return only the numeric available count as answer.',
    },
  });
  if (distinctActorIds) {
    // Only the error-boundary case separates IDs to expose the raw context
    // trace incorrectly routed to the executor by the published SDK.
    const contextProgram = assistant
      .namedProgramInstances()
      .find((entry) => entry.id.startsWith('ctx.') && !entry.id.endsWith('.actor'))?.program;
    assert.ok(contextProgram);
    contextProgram.setId('stock-context');
    assistant.setId('stock-task');
  }
  return { assistant, executor, ledger };
}

// A deterministic metric replaces (does not supplement) the built-in judge.
// Explicit action checks matter: a fluent answer alone must not earn full credit.
const actionMetric: AxMetricFn = ({ prediction }) => {
  const run = prediction as AxAgentEvalPrediction<Output>;
  if (run.completionType !== 'final' || run.output.answer.trim() !== '7') return 0;
  const reads = run.functionCalls.filter((call) => call.qualifiedName === 'inventory.lookup');
  if (
    reads.length !== 1 ||
    run.functionCalls.some((call) => call.qualifiedName === 'inventory.reserve')
  )
    return 0;
  if (run.toolErrors.length > 0) return 0;
  return 1;
};

async function deterministicTuning(ctx: ExampleContext) {
  const { assistant, executor, ledger } = makeAssistant(ctx);
  const teacher =
    ctx.mode === 'live'
      ? ctx.ai
      : scriptedAI((request) =>
          response(
            JSON.stringify(request.chatPrompt).includes('New Value')
              ? 'New Value: Prefer the read-only inventory lookup; never reserve when only stock is requested.'
              : 'Feedback Summary: Keep exact SKU lookup and avoid all write operations.',
          ),
        );
  const result = await assistant.optimize(
    { train, validation },
    {
      studentAI: executor,
      teacherAI: teacher,
      teacherOptions: options(ctx),
      metric: actionMetric,
      // This successful artifact path deliberately does not request the broken
      // pipeline bootstrap path. The separate offline case exposes both defects.
      bootstrap: false,
      apply: false,
      numTrials: 1,
      sampleCount: 1,
      minibatch: true,
      minibatchSize: 1,
      maxMetricCalls: 6,
      seed: 7,
      verbose: false,
    },
  );
  assert.ok(result.optimizedProgram);
  assert.equal(typeof result.baselineScore, 'number');
  assert.ok(
    result.optimizedProgram.componentMap &&
      Object.keys(result.optimizedProgram.componentMap).length > 0,
  );
  assert.equal(result.optimizedProgram.demos?.length ?? 0, 0);
  assert.ok(result.stats.totalCalls <= 6);
  assert.ok(ledger.every((entry) => entry.startsWith('lookup:')));
  const saved = axSerializeOptimizedProgram(result.optimizedProgram);
  // Fresh tool ledger and agent continuation state: evaluation side effects cannot leak into replay.
  const fresh = makeAssistant(ctx);
  fresh.assistant.setId(assistant.getId());
  const restored = axDeserializeOptimizedProgram(saved);
  assert.deepEqual(restored.componentMap, result.optimizedProgram.componentMap);
  assert.deepEqual(restored.demos, result.optimizedProgram.demos);
  fresh.assistant.applyOptimization(restored);
  const replay = await fresh.assistant.forward(fresh.executor, validation[0].input, options(ctx));
  assert.equal(replay.answer.trim(), '7');
  assert.deepEqual(fresh.ledger, ['lookup:SKU-1']);
  return {
    baseline: result.baselineScore,
    selected: result.bestScore,
    componentKeys: Object.keys(restored.componentMap ?? {}),
    bootstrap:
      'Explicitly disabled: bootstrap-boundaries covers pipeline trace filtering and routing separately; there is no automatic fallback.',
    optimizationLookups: ledger.length,
    replay,
    replayLedger: fresh.ledger,
    comparison:
      'Train and held-out selection tasks are disjoint. The offline student already obeys the action policy: this real component artifact proves portability, not a quality gain or demonstration training. Public BootstrapFewShot demonstration training and restore are exercised separately in 23-optimize. Reward depends on this dataset, action policy, and cost rubric.',
  };
}

async function bootstrapBoundaries(ctx: ExampleContext) {
  const filtered = makeAssistant(ctx);
  const scoredTasks: string[] = [];
  const common = {
    teacherOptions: options(ctx),
    numTrials: 1,
    sampleCount: 1,
    maxMetricCalls: 1,
    apply: false,
    verbose: false,
    bootstrap: { maxBootstrapMetricCalls: 1, maxBootstrapDemos: 3, scoreThreshold: 1 },
  } as const;
  const result = await filtered.assistant.optimize(
    { train, validation },
    {
      ...common,
      studentAI: filtered.executor,
      teacherAI: filtered.executor,
      metric: async (args) => {
        const score = await actionMetric(args);
        assert.equal(score, 1);
        const { id } = args.example as AxAgentEvalTask<Input>;
        assert.ok(id, 'Expected an ID for the scored stock task');
        scoredTasks.push(id);
        return score;
      },
    },
  );
  assert.ok(result.optimizedProgram);
  assert.equal(result.optimizedProgram.demos?.length ?? 0, 0);
  assert.ok(scoredTasks.includes(train[0].id));
  assert.ok(scoredTasks.includes(validation[0].id));
  assert.deepEqual(filtered.ledger, ['lookup:SKU-1', 'lookup:SKU-1']);

  // Selecting every descriptor removes the trace filter, but is NOT a fix:
  // bootstrap then passes the context actor's raw ID to the task-side router.
  const unroutable = makeAssistant(ctx, true);
  await assert.rejects(
    () =>
      unroutable.assistant.optimize(
        { train, validation },
        {
          ...common,
          studentAI: unroutable.executor,
          teacherAI: unroutable.executor,
          metric: actionMetric,
          target: unroutable.assistant.namedPrograms().map(({ id }) => id),
        },
      ),
    /Unknown program ID\(s\) in demos: stock-context\.actor/,
  );
  assert.deepEqual(unroutable.ledger, ['lookup:SKU-1', 'lookup:SKU-1']);
  return {
    successfulScoredTasks: scoredTasks,
    defaultBootstrapDemos: result.optimizedProgram.demos?.length ?? 0,
    explicitAllDescriptorsRejected: true,
    lookupCounts: [filtered.ledger.length, unroutable.ledger.length],
    boundary:
      'Default pipeline targets filter out raw trace IDs; selecting every descriptor exposes incompatible context-demo routing instead. Neither is a working agent bootstrap recipe. Use the explicit bootstrap:false component-artifact case, or public BootstrapFewShot training in 23-optimize for supported generator demonstrations.',
  };
}

async function builtInJudge(ctx: ExampleContext) {
  const { assistant, executor, ledger } = makeAssistant(ctx);
  let judgeCalls = 0;
  const judgeAI =
    ctx.mode === 'live'
      ? ctx.ai
      : scriptedAI(() => {
          judgeCalls++;
          return response(
            'Reasoning: The full run reads SKU-1 exactly once, returns 7, and has no reservation or tool error.\nQuality: excellent',
          );
        });
  // No custom metric: Ax owns holistic run judging and expected/forbidden-action adjustment.
  // One baseline validation evaluation exhausts the budget, yielding a real baseline artifact.
  const result = await assistant.optimize(
    { train, validation },
    {
      studentAI: executor,
      judgeAI,
      teacherAI: judgeAI,
      judgeOptions: {
        ...options(ctx),
        description: 'Prioritize correct read-only actions over wording.',
      },
      teacherOptions: options(ctx),
      bootstrap: false,
      maxMetricCalls: 1,
      numTrials: 1,
      sampleCount: 1,
      apply: false,
      verbose: false,
    },
  );
  assert.ok(result.optimizedProgram);
  assert.equal(result.bestScore, result.baselineScore);
  if (ctx.mode === 'offline') assert.equal(judgeCalls, 1);
  assert.deepEqual(ledger, ['lookup:SKU-1']);
  return {
    baseline: result.baselineScore,
    selected: result.bestScore,
    ledger,
    artifactComponents: Object.keys(result.optimizedProgram.componentMap ?? {}).length,
    boundary:
      'Built-in judge sees completion, final output, calls, errors and turns. This bounded validation does not claim evolution or reward invariance.',
  };
}

async function datasetBoundary(ctx: ExampleContext) {
  const { assistant, ledger } = makeAssistant(ctx);
  await assert.rejects(
    () => assistant.optimize([], { maxMetricCalls: 1 }),
    /at least one training task/,
  );
  assert.deepEqual(ledger, []);
  return { emptyDatasetRejected: true, toolSideEffects: ledger.length };
}

async function clarificationRollouts(ctx: ExampleContext) {
  type ClarificationInput = { query: string; answer?: string };
  let phase: 'seed' | 'evaluate' | 'resume' = 'seed';
  const stageCalls = { seed: 0, evaluate: 0, resume: 0 };
  let evaluationResponderCalls = 0;
  const model = scriptedAI(
    (request) => {
      const index = stageCalls[phase]++;
      // Scalar code/string outputs use field-title text, even when the model
      // advertises native structured outputs (AxGen selects no responseFormat).
      const actor = request.chatPrompt.some(
        (message) =>
          message.role === 'system' &&
          (message.content.includes('## Distiller\n') || message.content.includes('## Executor\n')),
      );
      if (phase === 'evaluate') {
        if (!actor) {
          evaluationResponderCalls++;
          throw new Error('Clarification evaluation must skip the responder');
        }
        assert.ok(index < 4, 'Two evaluations each require one distiller and one executor call');
        const executor = request.chatPrompt.some(
          (message) => message.role === 'system' && message.content.includes('## Executor\n'),
        );
        return response(
          `Javascript Code: ${
            executor
              ? 'if (typeof callerToken !== "undefined" || typeof evaluationToken !== "undefined") throw new Error("Evaluation reused continuation"); var evaluationToken = inputs.query; await askClarification({question:"Which destination?", type:"single_choice", choices:["Oslo","Rome"]});'
              : 'if (typeof callerToken !== "undefined" || typeof evaluationToken !== "undefined") throw new Error("Evaluation inherited caller or previous task state"); await final("Ask for the missing destination without guessing", {});'
          }`,
        );
      }
      const steps =
        phase === 'seed'
          ? [
              'Javascript Code: await final("Save caller continuation and ask for destination", {});',
              'Javascript Code: const callerToken = "CALLER_ONLY"; await askClarification({question:"Which caller destination?", type:"single_choice", choices:["Oslo","Rome"]});',
            ]
          : [
              'Javascript Code: await final("Resume the original caller with its saved token", {token:callerToken});',
              'Javascript Code: if (typeof evaluationToken !== "undefined") throw new Error("Evaluation leaked into caller"); await final("Report the saved caller token", {token:callerToken});',
              'Answer Text: CALLER_ONLY',
            ];
      const step = steps[index];
      assert.ok(step, 'Unexpected extra caller stage');
      return response(step);
    },
    { structuredOutputs: true },
  );
  const assistant = agent('query:string, answer?:string -> answerText:string', {
    ai: model,
    contextFields: [],
    directResponse: 'off',
    maxTurns: 2,
    runtime: new AxJSRuntime({ nodeWorkerPoolSize: 1, timeout: 5000 }),
    contextOptions: options(ctx),
    executorOptions: options(ctx),
    responderOptions: options(ctx),
  });
  const initial = Object.fromEntries(
    assistant.getOptimizableComponents().map((c) => [c.key, c.current]),
  );
  let callerState: AxAgentState | undefined;
  const observed: { id: string; prediction: AxAgentEvalPrediction<{ answerText: string }> }[] = [];
  const tasks = [
    {
      id: 'missing-destination-a',
      input: { query: 'Book a route, but I have not supplied the destination.' },
      criteria: 'Ask precisely for the missing destination; do not invent a final answer.',
    },
    {
      id: 'missing-destination-b',
      input: { query: 'Find a route; destination is missing.' },
      criteria: 'Clarify the destination before producing any final answer.',
    },
  ] satisfies [AxAgentEvalTask<ClarificationInput>, AxAgentEvalTask<ClarificationInput>];
  try {
    await assert.rejects(
      () => assistant.forward(model, { query: 'Seed an unfinished caller request.' }, options(ctx)),
      (error) => {
        if (!(error instanceof AxAgentClarificationError)) return false;
        callerState = error.getState();
        return true;
      },
    );
    assert.ok(callerState);
    assert.equal(callerState.runtimeBindings.callerToken, 'CALLER_ONLY');
    const saved = structuredClone(callerState);
    phase = 'evaluate';
    const result = await assistant.optimize(
      {
        train: [
          {
            id: 'train-missing-destination-a',
            input: { query: 'Plan a route without a destination.' },
            criteria: tasks[0].criteria,
          },
          {
            id: 'train-missing-destination-b',
            input: { query: 'I omitted the destination for this route.' },
            criteria: tasks[1].criteria,
          },
        ],
        validation: tasks,
      },
      {
        studentAI: model,
        teacherAI: model,
        bootstrap: false,
        apply: false,
        maxMetricCalls: 2,
        numTrials: 1,
        sampleCount: 1,
        seed: 7,
        verbose: false,
        metric: ({ prediction, example }) => {
          const run = prediction as AxAgentEvalPrediction<{ answerText: string }>;
          const { id } = example as AxAgentEvalTask<ClarificationInput>;
          assert.ok(id, 'Expected an ID for the scored clarification task');
          observed.push({ id, prediction: run });
          return run.completionType === 'askClarification' &&
            run.clarification.question === 'Which destination?' &&
            !('output' in run) &&
            run.toolErrors.length === 0
            ? 1
            : 0;
        },
      },
    );
    assert.ok(result.optimizedProgram);
    assert.deepEqual(
      observed.map((row) => row.id),
      tasks.map((task) => task.id),
    );
    for (const { prediction } of observed) {
      assert.equal(prediction.completionType, 'askClarification');
      assert.ok(prediction.clarification);
      assert.equal(prediction.clarification.question, 'Which destination?');
      assert.deepEqual(prediction.clarification.choices, ['Oslo', 'Rome']);
      assert.ok(!('output' in prediction));
      assert.deepEqual(prediction.toolErrors, []);
    }
    assert.equal(evaluationResponderCalls, 0);
    assert.equal(stageCalls.evaluate, 4, 'No previous evaluation continuation is resumed');
    assert.equal(result.stats.totalCalls, 2);
    assert.equal(result.baselineScore, 1);
    assert.deepEqual(
      assistant.getState(),
      saved,
      'The original caller continuation is restored after every scored rollout',
    );
    phase = 'resume';
    const resumed = await assistant.forward(
      model,
      { query: 'Seed an unfinished caller request.', answer: 'Oslo' },
      options(ctx),
    );
    assert.equal(resumed.answerText, 'CALLER_ONLY');
    assert.equal(stageCalls.resume, 3);
    return {
      completionTypes: observed.map((row) => row.prediction.completionType),
      taskIds: observed.map((row) => row.id),
      metricCalls: result.stats.totalCalls,
      evaluationResponderCalls,
      callerContinuationRestored: true,
      resumed,
    };
  } finally {
    assistant.applyOptimizedComponents(initial);
    assistant.setState(callerState);
    assistant.stop();
  }
}

async function delegationCallPolicy(ctx: ExampleContext) {
  type PolicyInput = { policyCase: string; accountId: string; sku: string; privateContext: string };
  const childInputs: string[] = [];
  let childModelCalls = 0;
  const childAI = scriptedAI(
    (request) => {
      childModelCalls++;
      assert.ok(childModelCalls <= 9, 'Exactly three bounded child rollouts are allowed');
      const prompt = JSON.stringify(request.chatPrompt);
      assert.ok(
        !prompt.includes('PRIVATE_PARENT_CONTEXT'),
        'Child receives explicit narrow inputs, not parent context',
      );
      childInputs.push(prompt);
      const actor = request.chatPrompt.some(
        (message) =>
          message.role === 'system' &&
          (message.content.includes('## Distiller\n') || message.content.includes('## Executor\n')),
      );
      return response(
        actor
          ? 'Javascript Code: await final("Return seven available units for this explicitly supplied account and SKU", {accountId:inputs.accountId, sku:inputs.sku, available:7});'
          : 'Available: 7',
      );
    },
    { structuredOutputs: true },
  );
  const child = agent('accountId:string, sku:string -> available:number', {
    ai: childAI,
    agentIdentity: {
      name: 'Stock Clerk',
      namespace: 'team',
      description: 'Read stock for an explicitly supplied account and SKU',
    },
    contextFields: [],
    directResponse: 'off',
    maxTurns: 2,
    runtime: new AxJSRuntime({ nodeWorkerPoolSize: 1, timeout: 5000 }),
    // Delegated func forwards the caller's AI; pin each child pipeline stage
    // explicitly so only the narrow child fixture handles these requests.
    contextOptions: { ...options(ctx), ai: childAI },
    executorOptions: { ...options(ctx), ai: childAI },
    responderOptions: { ...options(ctx), ai: childAI },
  });
  const lookupInputs: { sku: string }[] = [];
  const lookup = fn('lookup')
    .namespace('inventory')
    .description('Read the owned public stock count')
    .arg('sku', f.string())
    .returns(f.number())
    .handler(async ({ sku }) => {
      lookupInputs.push({ sku });
      return sku === 'SKU-1' ? 7 : 0;
    })
    .build();
  const policies = [
    {
      id: 'required-child',
      calls: ['team.stockClerk'],
      forbidden: ['inventory.lookup'],
      answer: '7',
      score: 1,
    },
    {
      id: 'required-tool',
      calls: ['inventory.lookup'],
      forbidden: ['team.stockClerk'],
      answer: '7',
      score: 1,
    },
    {
      id: 'direct-no-child',
      calls: [],
      forbidden: ['team.stockClerk', 'inventory.lookup'],
      answer: 'direct',
      score: 1,
    },
    {
      id: 'missing-required-child',
      calls: ['team.stockClerk'],
      forbidden: ['inventory.lookup'],
      answer: '7',
      score: 0,
    },
    { id: 'forbidden-child', calls: [], forbidden: ['team.stockClerk'], answer: '7', score: 0 },
    { id: 'unnecessary-child', calls: [], forbidden: [], answer: '7', score: 0 },
    { id: 'unnecessary-tool', calls: [], forbidden: [], answer: '7', score: 0 },
  ] as const;
  let parentModelCalls = 0;
  let directExecutorCalls = 0;
  const model = scriptedAI(
    (request) => {
      parentModelCalls++;
      assert.ok(
        parentModelCalls <= 24,
        'Five four-call parent pipelines plus two two-call direct responses',
      );
      const prompt = JSON.stringify(request.chatPrompt);
      // Match a complete input value, not overlapping suffixes such as
      // required-child inside missing-required-child.
      const policy = policies.find((item) => prompt.includes(`POLICY[${item.id}]`));
      assert.ok(policy, 'Every actual stage request retains its stable task identity');
      const actor = request.chatPrompt.some(
        (message) =>
          message.role === 'system' &&
          (message.content.includes('## Distiller\n') || message.content.includes('## Executor\n')),
      );
      const direct = policy.id === 'direct-no-child' || policy.id === 'missing-required-child';
      const childCall =
        policy.id === 'required-child' ||
        policy.id === 'forbidden-child' ||
        policy.id === 'unnecessary-child';
      if (!actor) {
        if (direct) return response(`Answer: ${policy.answer}`);
        // A synthetic final after maxTurns also reaches the responder, but has no final evidence.
        const evidence = responderEvidence(request);
        if (childCall) {
          const report = evidence?.report;
          assert.strictEqual(
            report,
            'Available: 7',
            `${policy.id}: final evidence.report must contain the Stock Clerk result`,
          );
          return response(`Answer: ${report.slice('Available: '.length)}`);
        }
        const count = evidence?.count;
        assert.strictEqual(
          count,
          7,
          `${policy.id}: final evidence.count must contain the inventory.lookup result`,
        );
        return response(`Answer: ${count}`);
      }
      const executor = request.chatPrompt.some(
        (message) => message.role === 'system' && message.content.includes('## Executor\n'),
      );
      if (direct) {
        if (executor) directExecutorCalls++;
        return response(
          `Javascript Code: await respond("Answer directly; no child or tool is needed", {answer:${JSON.stringify(policy.answer)}});`,
        );
      }
      if (!executor)
        return response(
          'Javascript Code: await final("Follow the explicit policyCase call route using only the needed fields", {});',
        );
      const callable = childCall ? 'team.stockClerk' : 'inventory.lookup';
      const observed = request.chatPrompt.some(
        (message) =>
          message.role === 'user' &&
          typeof message.content === 'string' &&
          message.content.includes('[OBSERVATION]') &&
          message.content.includes(`${callable}: `),
      );
      if (observed) {
        return response(
          childCall
            ? 'Javascript Code: await final("Return the child-reported available count", {report});'
            : 'Javascript Code: await final("Return the tool-reported available count", {count});',
        );
      }
      return response(
        `Javascript Code: ${
          childCall
            ? 'const report = await team.stockClerk({accountId:inputs.accountId, sku:inputs.sku});'
            : 'const count = await inventory.lookup({sku:inputs.sku});'
        }`,
      );
    },
    { structuredOutputs: true },
  );
  const assistant = agent(
    'policyCase:string, accountId:string, sku:string, privateContext:string -> answer:string',
    {
      ai: model,
      contextFields: [],
      functions: [child, lookup],
      directResponse: 'auto',
      maxTurns: 2,
      runtime: new AxJSRuntime({ nodeWorkerPoolSize: 1, timeout: 5000 }),
      contextOptions: options(ctx),
      executorOptions: options(ctx),
      responderOptions: options(ctx),
    },
  );
  const initial = Object.fromEntries(
    assistant.getOptimizableComponents().map((c) => [c.key, c.current]),
  );
  const tasks: readonly AxAgentEvalTask<PolicyInput>[] = policies.map((policy) => ({
    id: policy.id,
    input: {
      policyCase: `POLICY[${policy.id}]`,
      accountId: 'acct-demo',
      sku: 'SKU-1',
      privateContext: 'PRIVATE_PARENT_CONTEXT',
    },
    criteria: `Required calls: ${policy.calls.join(', ') || 'none'}; forbidden calls: ${policy.forbidden.join(', ') || 'none'}. No unnecessary calls. Child arguments must contain only accountId and sku.`,
    expectedActions: [...policy.calls],
    forbiddenActions: [...policy.forbidden],
    expectedOutput: { answer: policy.answer },
  }));
  const scored: { id: string; score: number; prediction: AxAgentEvalPrediction<Output> }[] = [];
  const [childRouting, toolRouting] = tasks;
  assert.ok(childRouting && toolRouting, 'Expected child and tool routing fixtures');
  try {
    const result = await assistant.optimize(
      {
        train: [
          { ...childRouting, id: 'train-child-routing' },
          { ...toolRouting, id: 'train-tool-routing' },
        ],
        validation: tasks,
      },
      {
        studentAI: model,
        teacherAI: model,
        bootstrap: false,
        apply: false,
        maxMetricCalls: tasks.length,
        numTrials: 1,
        sampleCount: 1,
        seed: 7,
        verbose: false,
        metric: ({ prediction, example }) => {
          const task = example as AxAgentEvalTask<PolicyInput>;
          const { id } = task;
          assert.ok(id, 'Expected an ID for the scored delegation task');
          const policy = policies.find((item) => item.id === id);
          assert.ok(policy, `Missing delegation policy for ${id}`);
          const run = prediction as AxAgentEvalPrediction<Output>;
          const names = run.functionCalls.map((call) => call.qualifiedName);
          const required = task.expectedActions ?? [];
          const forbidden = task.forbiddenActions ?? [];
          const narrow = run.functionCalls.every((call) => {
            if (call.qualifiedName !== 'team.stockClerk') return true;
            const args = call.arguments;
            return (
              args !== null &&
              typeof args === 'object' &&
              !Array.isArray(args) &&
              Object.keys(args).length === 2 &&
              Reflect.get(args, 'accountId') === task.input.accountId &&
              Reflect.get(args, 'sku') === task.input.sku
            );
          });
          const score =
            run.completionType === 'final' &&
            run.output.answer === policy.answer &&
            run.toolErrors.length === 0 &&
            names.length === required.length &&
            required.every((name) => names.filter((actual) => actual === name).length === 1) &&
            !forbidden.some((name) => names.includes(name)) &&
            narrow
              ? 1
              : 0;
          scored.push({ id, score, prediction: run });
          return score;
        },
      },
    );
    assert.ok(result.optimizedProgram);
    assert.deepEqual(
      scored.map((row) => ({ id: row.id, score: row.score })),
      policies.map(({ id, score }) => ({ id, score })),
    );
    assert.deepEqual(
      scored.map((row) => row.prediction.functionCalls.map((call) => call.qualifiedName)),
      [
        ['team.stockClerk'],
        ['inventory.lookup'],
        [],
        [],
        ['team.stockClerk'],
        ['team.stockClerk'],
        ['inventory.lookup'],
      ],
    );
    for (const { prediction } of scored) {
      assert.equal(prediction.completionType, 'final');
      assert.deepEqual(prediction.toolErrors, []);
      for (const call of prediction.functionCalls) {
        if (call.qualifiedName === 'team.stockClerk') {
          assert.deepEqual(call.arguments, { accountId: 'acct-demo', sku: 'SKU-1' });
          assert.match(String(call.result), /7/);
        } else {
          assert.deepEqual(call.arguments, { sku: 'SKU-1' });
          assert.equal(call.result, 7);
        }
      }
    }
    assert.equal(result.stats.totalCalls, tasks.length);
    assert.equal(childModelCalls, 9);
    assert.equal(childInputs.length, 9);
    assert.deepEqual(lookupInputs, [{ sku: 'SKU-1' }, { sku: 'SKU-1' }]);
    assert.equal(directExecutorCalls, 0, 'Direct/no-child predictions bypass the executor');
    assert.equal(parentModelCalls, 24);
    return {
      scores: scored.map(({ id, score, prediction }) => ({
        id,
        score,
        calls: prediction.functionCalls.map((call) => ({
          name: call.qualifiedName,
          arguments: call.arguments,
        })),
      })),
      metricCalls: result.stats.totalCalls,
      parentModelCalls,
      childModelCalls,
      boundary:
        'Real child/tool/direct optimizer predictions establish this deterministic call policy, not model-quality improvement or production authorization.',
    };
  } finally {
    assistant.applyOptimizedComponents(initial);
    assistant.setState(undefined);
    child.setState(undefined);
    assistant.stop();
    child.stop();
  }
}

export const examples: readonly Example[] = [
  {
    id: '24-agent-optimize/action-metric-artifact',
    title: 'Action-aware tuning with a real component-only artifact and held-out replay',
    features: [
      'agent.optimize',
      'dataset',
      'action-aware',
      'deterministic-metric',
      'saved-components',
      'artifact-replay',
    ],
    modes: ['offline', 'live'],
    nodeOnly: ['live'],
    run: deterministicTuning,
  },
  {
    id: '24-agent-optimize/bootstrap-boundaries',
    title: 'Pipeline bootstrap exposes filtered traces and rejects unroutable context demos',
    features: [
      'agent.optimize',
      'bootstrap',
      'trace-eligibility',
      'demo-routing',
      'error-boundary',
    ],
    modes: ['offline'],
    run: bootstrapBoundaries,
  },
  {
    id: '24-agent-optimize/builtin-judge-validation',
    title: 'Built-in holistic judge with an explicit baseline-only call budget',
    features: [
      'agent.optimize',
      'built-in-judge',
      'judgeOptions',
      'validation',
      'baseline-artifact',
    ],
    modes: ['offline', 'live'],
    nodeOnly: ['live'],
    run: builtInJudge,
  },
  {
    id: '24-agent-optimize/dataset-boundary',
    title: 'Empty task dataset fails before any tool execution',
    features: ['agent.optimize', 'error-boundary'],
    modes: ['offline'],
    run: datasetBoundary,
  },
  {
    id: '24-agent-optimize/clarification-rollouts',
    title: 'Score necessary clarification with clean rollouts and restore caller continuation',
    features: [
      'agent.optimize',
      'askClarification',
      'completionType',
      'state-isolation',
      'caller-resume',
    ],
    modes: ['offline'],
    run: clarificationRollouts,
  },
  {
    id: '24-agent-optimize/delegation-call-policy',
    title:
      'Score real child, tool and direct predictions against required and unnecessary call policies',
    features: [
      'agent.optimize',
      'delegation',
      'functionCalls',
      'required-actions',
      'forbidden-actions',
      'narrow-child-inputs',
      'direct-response',
    ],
    modes: ['offline'],
    run: delegationCallPolicy,
  },
];

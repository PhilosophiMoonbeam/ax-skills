import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import {
  AxAIServiceAbortedError,
  type AxChatRequest,
  type AxChatResponse,
  type AxCodeSession,
  AxJSRuntime,
  agent,
  f,
  fn,
} from '@ax-llm/ax';
import { type Example, options, scriptedAI } from './support.ts';

const code = (javascriptCode: string): AxChatResponse => ({
  results: [{ index: 0, content: JSON.stringify({ javascriptCode }), finishReason: 'stop' }],
});
const answer = (content: string): AxChatResponse => ({
  results: [{ index: 0, content: `Answer: ${content}`, finishReason: 'stop' }],
});

function readActionLog(prompt: AxChatRequest['chatPrompt']): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const message = prompt[i];
    if (message?.role !== 'user') continue;
    if (typeof message.content !== 'string') break;
    const actionLog = message.content.match(/^Action Log: ([\s\S]*)/m)?.[1];
    if (actionLog !== undefined) {
      const section = actionLog.search(
        /\n\n(?:Relevance Hints|Live Runtime State|Context Pressure): /,
      );
      return section === -1 ? actionLog : actionLog.slice(0, section);
    }
    break;
  }
  assert.fail('expected an Action Log in the executor request');
}

export const examples: readonly Example[] = [
  {
    id: '32-executor-context/prompt-detail-comparison',
    title: 'Reuse invoice state under both declared prompt detail settings',
    features: ['promptLevel', 'liveRuntimeState', 'explicit stage routing', 'distiller handoff'],
    modes: ['offline'],
    async run(ctx) {
      const results: {
        level: string;
        distillerSystemChars: number;
        executorSystemChars: number;
        total: number;
      }[] = [];
      for (const level of ['default', 'detailed'] as const) {
        let distillerSystem = '',
          executorSystem = '',
          calls = 0;
        const worker = agent('task:string -> answer:string', {
          runtime: new AxJSRuntime(),
          promptLevel: level,
          maxTurns: 4,
          directResponse: 'off',
          contextOptions: { model: 'fixture-distiller' },
          executorOptions: { model: 'fixture-executor' },
          responderOptions: { model: 'fixture-responder' },
          contextPolicy: { preset: 'adaptive', budget: 'balanced' },
        });
        const responses = [
          code('await final("Compute the invoice sum from these amounts", { amounts: [9, 4] })'),
          code('const amounts = inputs.distilledContext.amounts; console.log(amounts.length)'),
          code('const sum = amounts.reduce((a, b) => a + b, 0); console.log(sum)'),
          code('await final("Report the observed invoice total", { sum })'),
          answer('13'),
        ];
        // The distiller request is not the executor prompt. Explicit model routes
        // identify the stage without injecting or modifying its SDK instructions.
        const stages = [
          'fixture-distiller',
          'fixture-executor',
          'fixture-executor',
          'fixture-executor',
          'fixture-responder',
        ];
        const model = scriptedAI(
          (request, index) => {
            calls++;
            assert.equal(request.model, stages[index]);
            if (index < 2) {
              const system = request.chatPrompt
                .flatMap((message) => (message.role === 'system' ? [message.content] : []))
                .join('\n');
              if (index === 0) distillerSystem = system;
              else executorSystem = system;
            }
            const response = responses[index];
            assert.ok(response, 'unexpected extra stage request');
            return response;
          },
          { structuredOutputs: true },
        );
        try {
          const result = await worker.forward(
            model,
            { task: 'Compute the invoice sum.' },
            options(ctx),
          );
          assert.equal(result.answer, '13');
          assert.equal(calls, responses.length);
          assert.ok(
            distillerSystem.includes(
              'Do not add steps, checks, deliverables, reporting, or completion requirements that the user did not state',
            ),
          );
          assert.ok(
            executorSystem.includes(
              "The user's own task inputs remain the authority on what was asked",
            ),
          );
          assert.ok(executorSystem.includes('or leaves out ones they do, follow the task inputs'));
          const bindings = worker.getState()?.runtimeBindings;
          assert.deepEqual(bindings?.amounts, [9, 4]);
          const total = bindings?.sum;
          assert.ok(typeof total === 'number');
          assert.equal(total, 13);
          results.push({
            level,
            distillerSystemChars: distillerSystem.length,
            executorSystemChars: executorSystem.length,
            total,
          });
        } finally {
          worker.stop();
        }
      }
      return {
        results,
        proof:
          'both settings receive the shipped fidelity clauses and retain real runtime arithmetic; prompt delivery and scripted behavior are not evidence of semantic compliance or a template difference caused by promptLevel',
      };
    },
  },
  {
    id: '32-executor-context/executor-only-model-upgrades',
    title: 'Recover after an error, discover a billing function, and upgrade only the executor',
    features: [
      'executorModelPolicy ordered rules',
      'aboveErrorTurns',
      'namespaces',
      'functionDiscovery',
      'executorOptions',
      'contextOptions',
      'responderOptions',
      'actorTurnCallback model',
    ],
    modes: ['offline'],
    async run(ctx) {
      const models: unknown[] = [];
      const events: { stage: string; turn: number; model?: string; error: boolean }[] = [];
      const worker = agent('task:string -> answer:string', {
        runtime: new AxJSRuntime(),
        maxTurns: 5,
        promptLevel: 'detailed',
        directResponse: 'off',
        functionDiscovery: true,
        contextPolicy: { preset: 'full' },
        contextOptions: {
          model: 'fixture-context',
          description: 'Normalize invoice requests without executing billing tools.',
        },
        executorOptions: {
          model: 'fixture-cheap',
          description: 'Compute via billing tools and report actual results.',
        },
        responderOptions: {
          model: 'fixture-synthesis',
          description: 'Return only the observed numeric total.',
        },
        executorModelPolicy: [
          { model: 'fixture-recovery', aboveErrorTurns: 1 },
          { model: 'fixture-specialist', namespaces: ['billing'] },
        ],
        functions: [
          fn('total')
            .namespace('billing')
            .description('Sum invoice amounts')
            .arg('amounts', f.number('Amount').array())
            .returns(f.number('Sum'))
            .handler(({ amounts }) => amounts.reduce((a, b) => a + b, 0))
            .build(),
        ],
        actorTurnCallback: (turn) => {
          events.push({
            stage: turn.stage,
            turn: turn.turn,
            model: turn.model,
            error: turn.isError,
          });
        },
      });
      const responses = [
        code('await final("Compute invoice total using billing.total", { amounts: [4, 6] })'),
        code('throw new Error("Invoice schema needs the billing function docs")'),
        code('await discover(["billing.total"])'),
        code(
          'const total = await billing.total({ amounts: inputs.distilledContext.amounts }); console.log(total)',
        ),
        code('await final("Return the observed total", { total })'),
        answer('10'),
      ];
      const fixture = scriptedAI(
        (request, index) => {
          models.push(request.model);
          const response = responses[index];
          assert.ok(response);
          return response;
        },
        { structuredOutputs: true },
      );
      const result = await worker.forward(
        fixture,
        { task: 'Compute the total for invoices of 4 and 6.' },
        options(ctx),
      );
      assert.equal(result.answer, '10');
      assert.deepEqual(models, [
        'fixture-context',
        'fixture-cheap',
        'fixture-recovery',
        'fixture-specialist',
        'fixture-specialist',
        'fixture-synthesis',
      ]);
      assert.ok(events.some((event) => event.stage === 'executor' && event.error));
      assert.ok(events.some((event) => event.model === 'fixture-specialist'));
      return {
        answer: result.answer,
        models,
        events,
        boundary:
          'fixture model IDs inspect SDK routing, not real deployed model identifiers; production requires valid model mappings. Ordered last matching executor rule wins; responder routing is independent.',
      };
    },
  },
  {
    id: '32-executor-context/dynamic-output-truncation',
    title: 'Watch replay shrink as history grows while the complete runtime value stays usable',
    features: [
      'maxRuntimeChars',
      'dynamic budget-proportional truncation',
      'raw versus replay output',
      'contextPolicy compact budget',
      'live runtime value',
    ],
    modes: ['offline'],
    async run(ctx) {
      const payload = 'invoice-detail-'.repeat(1200);
      const rows = [
        { name: 'full decay control', preset: 'full', cap: 1800, samples: 3 },
        { name: 'checkpointed decay', preset: 'checkpointed', cap: 1800, samples: 3 },
        { name: 'omitted cap', preset: 'full', cap: undefined, samples: 1 },
        { name: 'explicit 12000', preset: 'full', cap: 12_000, samples: 1 },
        { name: 'explicit 3000', preset: 'full', cap: 3000, samples: 1 },
      ] as const;
      const results: { name: string; retainedLength: number; visibleChars: number[] }[] = [];
      for (const { name, preset, cap, samples } of rows) {
        const outputs: string[] = [];
        const worker = agent('task:string -> answer:string', {
          runtime: new AxJSRuntime(),
          maxTurns: samples + 1,
          directResponse: 'off',
          ...(cap === undefined ? {} : { maxRuntimeChars: cap }),
          contextPolicy: { preset, budget: 'compact' },
          contextOptions: { model: 'fixture-distiller' },
          executorOptions: { model: 'fixture-executor' },
          responderOptions: { model: 'fixture-responder' },
          actorTurnCallback: (turn) => {
            assert.equal(turn.isError, false);
            if (turn.result !== undefined) {
              assert.equal(turn.result, `sample-${outputs.length + 1}: ${payload}`);
              outputs.push(turn.output);
            }
          },
        });
        const responses = [
          code(
            'await final("Inspect the invoice-detail payload and report its retained character count", {})',
          ),
          code(
            'const fullPayload = "invoice-detail-".repeat(1200); console.log("sample-" + 1 + ": " + fullPayload)',
          ),
          ...Array.from({ length: samples - 1 }, (_, i) =>
            code(`console.log("sample-" + ${i + 2} + ": " + fullPayload)`),
          ),
          code(
            'const completeLength = fullPayload.length; await final("Report the retained payload length", { completeLength })',
          ),
          answer(String(payload.length)),
        ];
        let calls = 0;
        const model = scriptedAI(
          (request, index) => {
            calls++;
            assert.equal(
              request.model,
              index === 0
                ? 'fixture-distiller'
                : index === samples + 2
                  ? 'fixture-responder'
                  : 'fixture-executor',
            );
            if (index >= 2 && index <= samples + 1) {
              const sample = index - 1;
              const output = outputs[sample - 1];
              assert.ok(
                output?.startsWith(`sample-${sample}: `),
                'the turn marker must survive truncation',
              );
              assert.ok(
                readActionLog(request.chatPrompt).includes(`\nResult:\n${output}`),
                `formatted output from sample ${sample} must reach the next actor request`,
              );
            }
            const response = responses[index];
            assert.ok(response);
            return response;
          },
          { structuredOutputs: true },
        );
        try {
          const result = await worker.forward(
            model,
            { task: 'Inspect invoice details and report their retained size.' },
            options(ctx),
          );
          assert.equal(result.answer, String(payload.length));
          assert.equal(calls, responses.length);
          assert.equal(worker.getState()?.runtimeBindings.fullPayload, payload);
          assert.equal(worker.getState()?.runtimeBindings.completeLength, payload.length);
          assert.equal(outputs.length, samples);
          assert.ok(outputs.every((output) => output.length < payload.length));
          results.push({
            name,
            retainedLength: payload.length,
            visibleChars: outputs.map((output) => output.length),
          });
        } finally {
          worker.stop();
        }
      }
      const [full, checkpointed, omitted, explicit, small] = results;
      assert.ok(full && checkpointed && omitted && explicit && small);
      assert.ok(full.visibleChars.every((chars) => chars === full.visibleChars[0]));
      assert.equal(checkpointed.visibleChars[0], full.visibleChars[0]);
      assert.ok(
        checkpointed.visibleChars.every((chars, i, sizes) => {
          if (i === 0) return true;
          const previous = sizes[i - 1];
          return previous !== undefined && chars < previous;
        }),
      );
      assert.deepEqual(omitted.visibleChars, explicit.visibleChars);
      assert.deepEqual(explicit.visibleChars, [12_000]);
      assert.deepEqual(small.visibleChars, [3000]);
      return {
        results,
        boundary:
          'visible runtime output can shrink independently of saved values; not a token, cost or host-memory limit',
      };
    },
  },
  {
    id: '32-executor-context/shared-reference-serialization',
    title: 'Preserve sibling shared values in real agent replay while marking a genuine cycle',
    features: [
      'PR #893',
      'AxJSRuntime return mode',
      'actorTurnCallback raw versus replay',
      'sibling shared references',
      'true cycle',
    ],
    modes: ['offline'],
    async run(ctx) {
      const turns: { result: unknown; output: string; error: boolean }[] = [];
      const prompts: string[] = [];
      const worker = agent('task:string -> answer:string', {
        // stdout is already text and would bypass the object serializer fixed
        // by PR893. Return actual worker objects to exercise that SDK path.
        runtime: new AxJSRuntime({ outputMode: 'return' }),
        directResponse: 'off',
        maxTurns: 5,
        maxRuntimeChars: 4000,
        contextPolicy: { preset: 'full' },
        contextOptions: { model: 'fixture-distiller' },
        executorOptions: { model: 'fixture-executor' },
        responderOptions: { model: 'fixture-responder' },
        actorTurnCallback: (turn) => {
          if (turn.stage === 'executor' && turn.result !== undefined) {
            turns.push({ result: turn.result, output: turn.output, error: turn.isError });
          }
        },
      });
      const responses = [
        code(
          'await final("Inspect shared invoice views and a cycle, then report the sum of both sibling amounts", {})',
        ),
        code(
          'globalThis.shared = { invoiceId: "INV-7", cents: 1700 }; globalThis.siblings = { primary: shared, backup: shared }; siblings',
        ),
        code('globalThis.repeated = { first: [shared], second: [shared] }; repeated'),
        code('globalThis.cyclic = { invoiceId: "INV-cycle" }; cyclic.self = cyclic; cyclic'),
        code(
          'await final("Report the sum of both sibling invoice amounts", { total: siblings.primary.cents + siblings.backup.cents })',
        ),
        answer('3400'),
      ];
      const stages = [
        'fixture-distiller',
        'fixture-executor',
        'fixture-executor',
        'fixture-executor',
        'fixture-executor',
        'fixture-responder',
      ];
      const model = scriptedAI(
        (request, index) => {
          assert.equal(request.model, stages[index]);
          prompts.push(JSON.stringify(request.chatPrompt));
          const response = responses[index];
          assert.ok(response, 'finite serialization fixture exhausted');
          return response;
        },
        { structuredOutputs: true },
      );
      try {
        const result = await worker.forward(
          model,
          {
            task: 'Inspect the same invoice object through sibling keys and arrays; distinguish a self-reference.',
          },
          options(ctx),
        );
        assert.equal(result.answer, '3400');
        assert.equal(prompts.length, responses.length);
        assert.equal(turns.length, 3);
        assert.ok(turns.every((turn) => !turn.error));
        const sibling = turns[0],
          arrays = turns[1],
          cycle = turns[2];
        assert.ok(sibling && arrays && cycle);
        assert.ok(sibling.result && typeof sibling.result === 'object');
        assert.equal(
          Reflect.get(sibling.result, 'primary'),
          Reflect.get(sibling.result, 'backup'),
          'the worker result must actually share one object',
        );
        const invoice = { invoiceId: 'INV-7', cents: 1700 };
        assert.deepEqual(JSON.parse(sibling.output), { primary: invoice, backup: invoice });
        assert.ok(arrays.result && typeof arrays.result === 'object');
        const first = Reflect.get(arrays.result, 'first'),
          second = Reflect.get(arrays.result, 'second');
        assert.ok(Array.isArray(first) && Array.isArray(second));
        assert.equal(
          first[0],
          second[0],
          'distinct sibling arrays must actually contain the same object',
        );
        assert.deepEqual(JSON.parse(arrays.output), { first: [invoice], second: [invoice] });
        assert.doesNotMatch(sibling.output + arrays.output, /\[Circular\]/);
        assert.ok(cycle.result && typeof cycle.result === 'object');
        assert.equal(
          Reflect.get(cycle.result, 'self'),
          cycle.result,
          'the control must actually close an ancestor cycle',
        );
        assert.deepEqual(JSON.parse(cycle.output), { invoiceId: 'INV-cycle', self: '[Circular]' });
        for (const [index, turn] of turns.entries()) {
          assert.ok(
            prompts[index + 2]?.includes(JSON.stringify(turn.output).slice(1, -1)),
            'the next real executor request must receive the serialized replay',
          );
        }
        return {
          answer: result.answer,
          siblings: JSON.parse(sibling.output),
          arrays: JSON.parse(arrays.output),
          cycle: JSON.parse(cycle.output),
          proof:
            'real AxJSRuntime objects, identity assertions, SDK serialization and subsequent executor prompts; scripted model I/O, not model-quality evidence',
        };
      } finally {
        worker.stop();
      }
    },
  },
  {
    id: '32-executor-context/observer-failure-boundaries',
    title: 'A runtime-call observer fails open; an awaited actor-turn callback can abort the run',
    features: [
      'onFunctionCall fail-open',
      'actorTurnCallback awaited failure',
      'executor ownership',
      'no responder after failure',
    ],
    modes: ['offline'],
    async run(ctx) {
      const failure = new Error('actor-turn telemetry sink unavailable');
      const reads: number[] = [],
        observedCalls: string[] = [],
        observedStages: string[] = [];
      let modelCalls = 0;
      const worker = agent('task:string -> answer:string', {
        runtime: new AxJSRuntime(),
        directResponse: 'off',
        maxTurns: 2,
        functions: [
          fn('amount')
            .namespace('billing')
            .description('Read one in-memory invoice amount')
            .returns(f.number())
            .handler(() => {
              reads.push(17);
              return 17;
            })
            .build(),
        ],
        onFunctionCall: (call) => {
          if (call.qualifiedName === 'billing.amount') {
            observedCalls.push(call.qualifiedName);
            throw new Error('runtime-call telemetry sink unavailable');
          }
        },
        actorTurnCallback: (turn) => {
          observedStages.push(turn.stage);
          throw failure;
        },
      });
      const responses = [
        code('await final("Read the invoice amount using billing.amount", {})'),
        code('const observedAmount = await billing.amount({}); console.log(observedAmount)'),
      ];
      const model = scriptedAI(
        (_request, index) => {
          modelCalls++;
          const response = responses[index];
          assert.ok(response, 'no responder or recovery request may follow the callback failure');
          return response;
        },
        { structuredOutputs: true },
      );
      try {
        await assert.rejects(
          () => worker.forward(model, { task: 'Read the invoice amount.' }, options(ctx)),
          (error) => error === failure,
        );
        assert.deepEqual(observedCalls, ['billing.amount']);
        assert.deepEqual(
          reads,
          [17],
          'the failing runtime-call observer must not block its host function',
        );
        assert.deepEqual(
          observedStages,
          ['executor'],
          'the top-level actor-turn observer is not a distiller callback',
        );
        assert.equal(modelCalls, 2, 'the awaited callback failure prevents responder execution');
        return {
          runtimeCallObserverFailedOpen: true,
          actorTurnObserverAborted: true,
          reads,
          observedStages,
          modelCalls,
          boundary:
            'catch actor-turn telemetry-sink failures in the application when observability must not abort execution',
        };
      } finally {
        worker.stop();
      }
    },
  },
  {
    id: '32-executor-context/actor-cutoff-no-execution',
    title: 'Never execute length-rejected actor code or roll back an earlier completed effect',
    features: [
      'actor cutoff safety',
      'bounded generation attempts',
      'maxRetries',
      'host effect ledger',
      'stage isolation',
    ],
    modes: ['offline'],
    async run(ctx) {
      const results: { stage: string; cutoffCalls: number; effects: string[]; error: string }[] =
        [];
      for (const stage of ['distiller', 'executor'] as const) {
        const effects: string[] = [];
        const executedSources: string[] = [];
        class ObservedRuntime extends AxJSRuntime {
          override createSession(...args: Parameters<AxJSRuntime['createSession']>): AxCodeSession {
            const session = super.createSession(...args);
            const execute = session.execute.bind(session);
            session.execute = (source, options) => {
              executedSources.push(source);
              return execute(source, options);
            };
            const executeWithStatus = session.executeWithStatus?.bind(session);
            if (executeWithStatus) {
              session.executeWithStatus = (source, options) => {
                executedSources.push(source);
                return executeWithStatus(source, options);
              };
            }
            return session;
          }
        }
        let cutoffCalls = 0,
          distillerCalls = 0,
          executorCalls = 0,
          priorTurnCompleted = false;
        const worker = agent('task:string -> answer:string', {
          runtime: new ObservedRuntime(),
          directResponse: 'off',
          maxTurns: 2,
          contextOptions: { model: 'fixture-distiller' },
          executorOptions: { model: 'fixture-executor' },
          responderOptions: { model: 'fixture-responder' },
          functions: [
            fn('record')
              .namespace('billing')
              .description('Record a fixture invoice read')
              .returns(f.number())
              .handler(() => {
                effects.push('prior-read');
                return 17;
              })
              .build(),
            fn('forbidden')
              .namespace('billing')
              .description('A fixture effect that rejected code must never invoke')
              .returns(f.number())
              .handler(() => {
                effects.push('forbidden');
                return 99;
              })
              .build(),
          ],
          actorTurnCallback: (turn) => {
            assert.equal(turn.isError, false);
            priorTurnCompleted = true;
          },
        });
        const model = scriptedAI(
          (request) => {
            if (request.model === 'fixture-distiller') {
              distillerCalls++;
              if (stage === 'executor') {
                assert.equal(distillerCalls, 1, 'a cutoff must not restart the pipeline');
                return code('await final("Read and report the fixture invoice amount", {})');
              }
            } else if (request.model === 'fixture-executor') {
              assert.equal(stage, 'executor', 'no executor after distiller cutoff');
              executorCalls++;
              if (executorCalls === 1)
                return code(
                  'const observedAmount = await billing.record({}); console.log(observedAmount)',
                );
              assert.equal(priorTurnCompleted, true);
              assert.deepEqual(effects, ['prior-read']);
            } else {
              assert.fail('no responder or other model request is allowed after cutoff');
            }
            cutoffCalls++;
            assert.ok(
              cutoffCalls <= 4,
              'finite cutoff fixture allows initial generation plus at most three advertised reasks',
            );
            const marker = `REJECTED_CUTOFF_${cutoffCalls}`;
            const javascriptCode =
              stage === 'distiller'
                ? `const rejectedDistillerValue = "${marker}"; await final("Rejected distiller handoff", { rejectedDistillerValue })`
                : `await billing.forbidden({}); await final("Rejected executor completion", { marker: "${marker}" })`;
            return {
              results: [
                { index: 0, content: JSON.stringify({ javascriptCode }), finishReason: 'length' },
              ],
            };
          },
          { structuredOutputs: true },
        );
        let terminal = '';
        try {
          await assert.rejects(
            () =>
              worker.forward(
                model,
                { task: 'Read the fixture invoice amount once and report it.' },
                { ...options(ctx), maxRetries: 0 },
              ),
            (error) => {
              terminal =
                error instanceof Error
                  ? `${error.message}\n${String(error.cause ?? '')}`
                  : String(error);
              return /max tokens reached before completion/i.test(terminal);
            },
          );
          assert.equal(cutoffCalls, 4);
          assert.match(terminal, /REJECTED_CUTOFF_4/);
          assert.doesNotMatch(terminal, /REJECTED_CUTOFF_[123]/);
          assert.deepEqual(effects, stage === 'executor' ? ['prior-read'] : []);
          assert.ok(
            !executedSources.some((source) => /REJECTED_CUTOFF_[1-4]/.test(source)),
            'no length-rejected code may be submitted to the real runtime',
          );
          if (stage === 'distiller') {
            assert.equal(executorCalls, 0);
            assert.equal(priorTurnCompleted, false);
          } else {
            assert.ok(
              executedSources.some((source) => source.includes('billing.record({})')),
              'the runtime observer must see the accepted prior turn',
            );
            assert.equal(priorTurnCompleted, true);
            assert.equal(distillerCalls, 1);
            assert.equal(executorCalls, 5);
          }
          results.push({ stage, cutoffCalls, effects, error: terminal });
        } finally {
          worker.stop();
        }
      }
      return {
        results,
        boundary:
          'four generation attempts in the failed actor turn, with the latest cutoff propagated; no rejected ordinary code or responder, no replay or rollback of an earlier effect',
      };
    },
  },
  {
    id: '32-executor-context/actor-cutoff-recovery',
    title: 'Retry a cutoff inside the same distiller or executor turn',
    features: [
      'finishReason length',
      'same-turn recovery',
      'retry guidance',
      'preserved stage state and effects',
    ],
    modes: ['offline'],
    async run(ctx) {
      const note =
        '[NOTE: Your last reply could not be used: it was cut off at the output limit or was incomplete, so nothing ran. Think briefly and return a shorter, complete step now; continue the rest on later turns.]';
      const input = {
        task: 'Read the invoice originating in accounts payable and report its amount.',
      };
      const forwardOptions = { ...options(ctx), maxRetries: 0 };
      const recovered: { cutoffsPerStage: number; actorAttempts: number; effects: string[] }[] = [];
      for (const cutoffs of [1, 2]) {
        const effects: string[] = [];
        const attempts = { distiller: [] as string[], executor: [] as string[] };
        let distillerCalls = 0,
          executorCalls = 0,
          responderCalls = 0;
        const steps: string[] = [];
        const worker = agent('task:string -> answer:string', {
          runtime: new AxJSRuntime(),
          directResponse: 'off',
          maxTurns: 2,
          contextOptions: { model: 'fixture-distiller' },
          executorOptions: { model: 'fixture-executor' },
          responderOptions: { model: 'fixture-responder' },
          functions: [
            fn('read')
              .namespace('billing')
              .description('Read the amount from the authorized fixture origin')
              .arg('origin', f.string())
              .returns(f.number())
              .handler(({ origin }) => {
                effects.push(origin);
                return 17;
              })
              .build(),
          ],
          actorTurnCallback: (turn) => {
            assert.equal(turn.isError, false);
            steps.push(turn.code);
          },
        });
        const model = scriptedAI(
          (request) => {
            if (request.model === 'fixture-responder') {
              assert.equal(++responderCalls, 1);
              const prompt = JSON.stringify(request.chatPrompt);
              assert.match(prompt, /observedAmount[^0-9]*17/);
              assert.match(prompt, /accounts payable/);
              return answer('17');
            }
            assert.ok(
              request.model === 'fixture-distiller' || request.model === 'fixture-executor',
            );
            const stage = request.model === 'fixture-distiller' ? 'distiller' : 'executor';
            const first = (stage === 'distiller' ? distillerCalls++ : executorCalls++) === 0;
            if (first) {
              return stage === 'distiller'
                ? code(
                    'const origin = inputs.task.match(/originating in (.+?) and/)?.[1]; console.log(origin)',
                  )
                : code('const observedAmount = await billing.read({ origin });');
            }
            const prompts = attempts[stage];
            prompts.push(JSON.stringify(request.chatPrompt));
            assert.ok(prompts.length <= cutoffs + 1);
            if (stage === 'executor') assert.deepEqual(effects, ['accounts payable']);
            if (prompts.length <= cutoffs) {
              const javascriptCode =
                stage === 'distiller'
                  ? 'const rejectedDistiller = "must not run"; await final("Rejected handoff", {})'
                  : 'const rejectedExecutor = await billing.read({ origin: "must not run" }); await final("Rejected completion", {})';
              return {
                results: [
                  { index: 0, content: JSON.stringify({ javascriptCode }), finishReason: 'length' },
                ],
              };
            }
            return stage === 'distiller'
              ? code('await final("Report the invoice amount from the saved origin", { origin })')
              : code(
                  'await final("Report the observed amount and origin", { observedAmount, origin })',
                );
          },
          { structuredOutputs: true },
        );
        try {
          const result = await worker.forward(model, input, forwardOptions);
          assert.equal(result.answer, '17');
          assert.equal(responderCalls, 1);
          assert.equal(steps.length, 2, 'only accepted executor code consumes actor turns');
          assert.deepEqual(effects, ['accounts payable']);
          for (const prompts of Object.values(attempts)) {
            assert.equal(prompts.length, cutoffs + 1);
            const [firstPrompt] = prompts;
            assert.ok(firstPrompt !== undefined, 'expected the initial actor request');
            assert.equal(prompts[1], firstPrompt, 'the first retry is unchanged');
            assert.ok(!firstPrompt.includes(note));
            if (cutoffs === 2) {
              assert.ok(prompts[2]?.includes(note));
              assert.equal(
                prompts[2]?.replace(`\\n\\n${note}`, ''),
                firstPrompt,
                'only one shorter-step note changes the next prompt',
              );
            }
          }
          const bindings = worker.getState()?.runtimeBindings;
          assert.ok(bindings);
          assert.equal(bindings.origin, 'accounts payable');
          assert.equal(bindings.observedAmount, 17);
          assert.ok(
            !Object.hasOwn(bindings, 'rejectedDistiller') &&
              !Object.hasOwn(bindings, 'rejectedExecutor'),
          );
          recovered.push({
            cutoffsPerStage: cutoffs,
            actorAttempts: distillerCalls + executorCalls,
            effects,
          });
        } finally {
          worker.stop();
        }
      }
      for (const failure of [
        new Error('fixture transport refused this request'),
        new AxAIServiceAbortedError('offline-script', 'fixture transport aborted'),
      ]) {
        let calls = 0;
        const worker = agent('task:string -> answer:string', {
          directResponse: 'off',
          maxTurns: 1,
        });
        const model = scriptedAI(
          () => {
            calls++;
            throw failure;
          },
          { structuredOutputs: true },
        );
        try {
          await assert.rejects(
            () => worker.forward(model, input, forwardOptions),
            (error) =>
              failure instanceof AxAIServiceAbortedError
                ? error === failure
                : /fixture transport refused/.test(String(error)),
          );
          assert.equal(calls, 1, 'other errors and aborts do not take the cutoff retry path');
        } finally {
          worker.stop();
        }
      }
      return {
        recovered,
        proof:
          'real actor generation retries, retained origin and one host read, then normal responder synthesis',
      };
    },
  },
  {
    id: '32-executor-context/fresh-evidence-handoff',
    title:
      'Pause for inspection evidence, resume from initialized bindings, and compare older replay',
    features: [
      'default inspect result policy',
      'guarded function and final',
      'resultPolicy data',
      'initialized bindings',
      'older_observation',
      'full context',
    ],
    modes: ['offline'],
    async run(ctx) {
      const head = 'invoice-hold-head',
        middle = 'archival-caveat-middle',
        tail = 'invoice-audit-tail';
      const cases = [
        { name: 'short-checkpointed', full: false, long: false, guard: 'call' },
        { name: 'long-checkpointed', full: false, long: true, guard: 'final' },
        { name: 'long-full', full: true, long: true, guard: 'final' },
      ] as const;
      const results: { name: string; readCount: number; olderObservationTurns: number[] }[] = [];
      for (const row of cases) {
        const report = `${head}|${row.long ? 'A'.repeat(620) + middle + 'B'.repeat(620) + tail : 'no additional notes'}`;
        let reads = 0,
          calls = 0;
        let freshObservation = '';
        const routes: string[] = [];
        const olderObservationTurns: number[] = [];
        const worker = agent('task:string -> answer:string', {
          runtime: new AxJSRuntime(),
          directResponse: 'off',
          maxTurns: 3,
          ...(row.full ? { contextPolicy: { preset: 'full' as const } } : {}),
          contextOptions: { model: 'fixture-distiller' },
          executorOptions: { model: 'fixture-executor' },
          responderOptions: { model: 'fixture-responder' },
          functions: [
            fn('read')
              .namespace('ledger')
              .description('Inspect the invoice status and caveats')
              .returns(f.string())
              .handler(() => {
                reads++;
                return report;
              })
              .build(),
            fn('routeCode')
              .namespace('ledger')
              .description('Map an observed status to its numeric routing code')
              .arg('status', f.string())
              .returns(f.number())
              .resultPolicy('data')
              .handler(({ status }) => {
                routes.push(status);
                return status === head ? 41 : 0;
              })
              .build(),
          ],
          actorTurnCallback: (turn) => {
            assert.equal(turn.isError, false);
            if (turn.stage === 'executor' && turn.turn === 1) freshObservation = turn.output;
          },
          onContextEvent: (event) => {
            if (
              event.stage === 'executor' &&
              event.kind === 'action_compacted' &&
              event.reason === 'older_observation'
            )
              olderObservationTurns.push(event.turn);
          },
        });
        const guarded =
          row.guard === 'call'
            ? 'await ledger.routeCode({ status: invoiceReport.split("|")[0] })'
            : 'await final("Give a premature answer", { invoiceReport })';
        const responses = [
          code(
            'await final("Read the current invoice report and route it by its observed status", {})',
          ),
          code(
            `const invoiceReport = await ledger.read({}); ${guarded}; const unexecutedSuffix = "SUFFIX_MUST_NOT_APPEAR";`,
          ),
          code('const reportSize = invoiceReport.length; console.log(reportSize);'),
          code(
            'const route = await ledger.routeCode({ status: invoiceReport.split("|")[0] }); await final("Report the retained report size and route", { reportSize, route })',
          ),
          answer(String(report.length)),
        ];
        const model = scriptedAI(
          (request, index) => {
            calls++;
            assert.equal(
              request.model,
              index === 0
                ? 'fixture-distiller'
                : index === 4
                  ? 'fixture-responder'
                  : 'fixture-executor',
            );
            const prompt = JSON.stringify(request.chatPrompt);
            if (index === 2) {
              assert.equal(reads, 1);
              assert.deepEqual(
                routes,
                [],
                'a dependent guarded call must not dispatch in the inspection turn',
              );
              assert.match(prompt, /\[OBSERVATION\] Execution paused/);
              assert.match(prompt, /Initialized bindings after pause:[^.]*invoiceReport/);
              assert.ok(prompt.includes(report), 'the next executor sees the fresh observation');
              assert.doesNotMatch(
                prompt,
                /unexecutedSuffix|SUFFIX_MUST_NOT_APPEAR|Give a premature answer/,
              );
              assert.deepEqual(olderObservationTurns, []);
            }
            if (index === 3) {
              assert.deepEqual(routes, []);
              assert.ok(prompt.includes(head));
              if (row.long) {
                assert.ok(prompt.includes(tail));
                assert.equal(prompt.includes(middle), row.full);
                assert.equal(prompt.includes('older observation, excerpt'), !row.full);
              } else {
                const actionLog = readActionLog(request.chatPrompt);
                assert.ok(freshObservation.includes(`ledger.read: ${report}\n`));
                assert.ok(
                  actionLog.includes(`\nResult:\n${freshObservation}\n\n`),
                  'the full older short observation must remain in the Action Log',
                );
              }
            }
            if (index === 4) {
              assert.match(prompt, new RegExp(`reportSize[^0-9]*${report.length}\\b`));
              assert.match(prompt, /route[^0-9]*41\b/);
            }
            const response = responses[index];
            assert.ok(response);
            return response;
          },
          { structuredOutputs: true },
        );
        try {
          const result = await worker.forward(
            model,
            { task: 'Review the invoice report, then report its character count and route.' },
            options(ctx),
          );
          assert.equal(result.answer, String(report.length));
          assert.equal(calls, responses.length);
          assert.equal(reads, 1, 'resuming must not repeat the inspection');
          assert.deepEqual(routes, [head]);
          const bindings = worker.getState()?.runtimeBindings;
          assert.ok(bindings);
          assert.equal(bindings.invoiceReport, report);
          assert.equal(bindings.reportSize, report.length);
          assert.equal(bindings.route, 41);
          assert.ok(!Object.hasOwn(bindings, 'unexecutedSuffix'));
          assert.deepEqual([...new Set(olderObservationTurns)], row.long && !row.full ? [1] : []);
          results.push({ name: row.name, readCount: reads, olderObservationTurns });
        } finally {
          worker.stop();
        }
      }
      return {
        results,
        boundary:
          'guarded actions yield for fresh inspection; excerpting older evidence does not truncate saved values or prove model interpretation',
      };
    },
  },
  {
    id: '32-executor-context/batch-evidence-handoff',
    title: 'Discover every missing batch contract before effects; retain ordered partial results',
    features: [
      'batch discovery preflight',
      'ordered partial outcomes',
      'resultPolicy data',
      'deterministic chaining',
    ],
    modes: ['offline'],
    async run(ctx) {
      const effects: string[] = [];
      const worker = agent('task:string -> answer:string', {
        runtime: new AxJSRuntime(),
        directResponse: 'off',
        maxTurns: 4,
        functionDiscovery: true,
        contextPolicy: { preset: 'full' },
        contextOptions: { model: 'fixture-distiller' },
        executorOptions: { model: 'fixture-executor' },
        responderOptions: { model: 'fixture-responder' },
        functions: [
          fn('baseline')
            .namespace('billing')
            .description('Read the fixed ledger baseline')
            .returns(f.number())
            .resultPolicy('data')
            .handler(async () => {
              // Complete after the synchronous members without a timed delay.
              await setImmediate();
              effects.push('baseline');
              return 3;
            })
            .build(),
          fn('subtotal')
            .namespace('billing')
            .description('Inspect the audited invoice subtotal')
            .arg('auditReference', f.string())
            .returns(f.number())
            .handler(({ auditReference }) => {
              effects.push(`subtotal:${auditReference}`);
              return 17;
            })
            .build(),
          fn('adjustment')
            .namespace('billing')
            .description(
              'Compute a deterministic adjustment from an adjustment key; retired keys fail',
            )
            .arg('adjustmentKey', f.string())
            .returns(f.number())
            .resultPolicy('data')
            .handler(({ adjustmentKey }) => {
              effects.push(`adjustment:${adjustmentKey}`);
              if (adjustmentKey === 'retired') throw new Error('retired adjustment key');
              return 5;
            })
            .build(),
        ],
        actorTurnCallback: (turn) => {
          assert.equal(turn.isError, false);
        },
      });
      const independentCalls =
        '[{ name: "billing.baseline" }, { name: "billing.adjustment", args: { adjustmentKey: "retired" } }, { name: "billing.subtotal", args: { auditReference: "A1" } }]';
      const responses = [
        code('await final("Read independent ledger items and compute the total after review", {})'),
        code('await discover(["billing.baseline"])'),
        code(`const missingContracts = await batch(${independentCalls});`),
        code(
          `const outcomes = await batch(${independentCalls}); await final("Premature batch completion", {});`,
        ),
        code(
          'const corrected = await billing.adjustment({ adjustmentKey: "current" }); const total = outcomes[0].value + corrected + outcomes[2].value; await final("Report the total after correcting only the failed adjustment", { total });',
        ),
        answer('25'),
      ];
      let calls = 0;
      const model = scriptedAI(
        (request, index) => {
          calls++;
          assert.equal(
            request.model,
            index === 0
              ? 'fixture-distiller'
              : index === 5
                ? 'fixture-responder'
                : 'fixture-executor',
          );
          const prompt = JSON.stringify(request.chatPrompt);
          if (index === 2) {
            assert.deepEqual(effects, []);
            assert.match(prompt, /### `billing\.baseline`/);
            assert.doesNotMatch(prompt, /auditReference|adjustmentKey/);
          }
          if (index === 3) {
            assert.deepEqual(
              effects,
              [],
              'even the already discovered batch member cannot run before all contracts load',
            );
            assert.match(prompt, /auditReference/);
            assert.match(prompt, /adjustmentKey/);
          }
          if (index === 4) {
            assert.deepEqual(
              effects,
              ['adjustment:retired', 'subtotal:A1', 'baseline'],
              'handler outcomes do not settle in submitted order',
            );
            assert.match(prompt, /retired adjustment key/);
            assert.match(prompt, /batch\[2\] billing\.subtotal: 17/);
            assert.doesNotMatch(prompt, /Premature batch completion/);
          }
          if (index === 5) assert.match(prompt, /total[^0-9]*25\b/);
          const response = responses[index];
          assert.ok(response);
          return response;
        },
        { structuredOutputs: true },
      );
      try {
        const result = await worker.forward(
          model,
          { task: 'Read the independent billing entries and report their corrected total.' },
          options(ctx),
        );
        assert.equal(result.answer, '25');
        assert.equal(calls, responses.length);
        assert.deepEqual([...effects].sort(), [
          'adjustment:current',
          'adjustment:retired',
          'baseline',
          'subtotal:A1',
        ]);
        const bindings = worker.getState()?.runtimeBindings;
        assert.ok(bindings);
        assert.ok(!Object.hasOwn(bindings, 'missingContracts'));
        assert.ok(Array.isArray(bindings.outcomes));
        assert.deepEqual(
          bindings.outcomes.map(({ name, status }) => ({ name, status })),
          [
            { name: 'billing.baseline', status: 'fulfilled' },
            { name: 'billing.adjustment', status: 'rejected' },
            { name: 'billing.subtotal', status: 'fulfilled' },
          ],
        );
        assert.equal(bindings.outcomes[0].value, 3);
        assert.match(bindings.outcomes[1].error, /retired adjustment key/);
        assert.equal(bindings.outcomes[2].value, 17);
        assert.equal(bindings.total, 25);
        return {
          effects,
          total: bindings.total,
          boundary:
            'real preflight and partial batch outcomes; independent inputs are known before dispatch, and only the failed item is retried',
        };
      } finally {
        worker.stop();
      }
    },
  },
];

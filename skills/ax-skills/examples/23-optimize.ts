import assert from 'node:assert/strict';
import {
  AxBootstrapFewShot, AxGEPA, AxGen, ax, f, fn, flow, optimize,
  axSerializeOptimizedProgram, axDeserializeOptimizedProgram,
  type AxChatResponse, type AxMetricFn, type AxMultiMetricFn,
} from '@ax-llm/ax';
import { options, scriptedAI, type Example, type ExampleContext } from './support.js';

// Fixtures are explicit model outputs. Ax still collects traces, scores candidates,
// selects the frontier, and applies serialized artifacts; this is not model-quality evidence.
const response = (content: string): AxChatResponse => ({ results: [{ index: 0, content, finishReason: 'stop' }] });
const field = (value: unknown, key: string): unknown =>
  value !== null && typeof value === 'object' && key in value ? Reflect.get(value, key) : undefined;
const train = [
  { ticket: 'Checkout is down for every customer.', priority: 'high' },
  { ticket: 'Production database unavailable.', priority: 'high' },
];
// Selection holdout: never supplied as bootstrap training or teacher feedback examples.
const validation = [{ ticket: 'All customer logins fail with a server error.', priority: 'high' }];
const metric: AxMetricFn = ({ prediction, example }) => field(prediction, 'priority') === example.priority ? 1 : 0;
const makeProgram = () => ax('ticket:string -> priority:class "high, normal", rationale:string');
const answer = 'Priority: high\nRationale: Customer-facing outage.';

function teacherFixture() {
  return scriptedAI(request => {
    const prompt = JSON.stringify(request.chatPrompt);
    if (prompt.includes('Feedback Summary')) return response('Feedback Summary: Route customer-facing outages to high priority.');
    if (prompt.includes('New Value')) return response('New Value: OUTAGE_RULE: Classify customer-facing outages as high priority. Explain in one short sentence.');
    return response(answer); // Bootstrap execution, not a prebuilt demonstration artifact.
  });
}

async function globalPipeline(ctx: ExampleContext) {
  const studentAI = ctx.mode === 'live' ? ctx.ai : scriptedAI(() => response(answer));
  const teacherAI = ctx.mode === 'live' ? ctx.ai : teacherFixture();
  const program = makeProgram();
  const result = await optimize(program, train, metric, {
    studentAI, teacherAI, teacherOptions: options(ctx),
    bootstrap: { maxRounds: 1, maxExamples: 1, maxDemos: 1, batchSize: 1, verboseMode: false },
    numTrials: 1, sampleCount: 1, minibatch: true, minibatchSize: 1,
    validationExamples: validation, maxMetricCalls: 8, seed: 7, verbose: false,
  });
  assert.ok(result.optimizedProgram);
  assert.ok(result.optimizedProgram.demos?.some(demo => demo.traces.length > 0));
  assert.equal(typeof result.baselineScore, 'number');
  assert.ok(result.bestScore >= (result.baselineScore ?? 0));
  // The serializer returns JSON-compatible data, not a string. Persist metadata separately.
  const serialized = axSerializeOptimizedProgram(result.optimizedProgram);
  const restored = axDeserializeOptimizedProgram(serialized);
  const production = makeProgram();
  production.setId(program.getId()); // Component/demo ownership is identified by stable program IDs.
  production.applyOptimization(restored);
  const replay = await production.forward(studentAI, validation[0]!, options(ctx));
  assert.ok(['high', 'normal'].includes(replay.priority));
  return { baseline: result.baselineScore, selected: result.bestScore,
    validationCount: validation.length, demoGroups: restored.demos?.length,
    totalEvaluationsIncludingBootstrap: result.stats.totalCalls, replay,
    comparison: 'Same held-out subset, model, sampleCount and metric before/after bootstrap. This fixture already scores 1; no improvement is claimed.' };
}

async function bootstrapOnly(ctx: ExampleContext) {
  const model = scriptedAI(() => response(answer));
  const program = makeProgram();
  const optimizer = new AxBootstrapFewShot({ studentAI: model, teacherAI: model,
    teacherOptions: options(ctx), verbose: false,
    options: { maxRounds: 1, maxExamples: 1, maxDemos: 1, batchSize: 1, verboseMode: false } });
  const result = await optimizer.compile(program, train, metric, { maxIterations: 1, maxDemos: 1, verbose: false });
  assert.ok(result.demos);
  assert.ok(result.demos.some(demo => demo.traces.length > 0));
  assert.equal(result.stats.totalCalls, 1);
  program.setDemos(result.demos);
  const replay = await program.forward(model, validation[0]!, options(ctx));
  assert.equal(replay.priority, 'high');
  return { demos: result.demos, calls: result.stats.totalCalls, replay,
    boundary: 'Bootstrap bestScore is successful-demo rate, not a held-out baseline comparison; validation above is separate.' };
}

async function directGEPA(ctx: ExampleContext, pareto: boolean) {
  let studentCalls = 0;
  let teacherCalls = 0;
  const studentAI = scriptedAI(request => {
    studentCalls++;
    const repaired = JSON.stringify(request.chatPrompt).includes('OUTAGE_RULE');
    return response(repaired ? answer : 'Priority: normal\nRationale: A deliberately verbose baseline explanation of a customer-facing outage.');
  });
  const teacherAI = scriptedAI(request => {
    teacherCalls++;
    return response(JSON.stringify(request.chatPrompt).includes('New Value')
      ? 'New Value: OUTAGE_RULE: Route customer-facing outages to high priority; keep rationale under 40 characters.'
      : 'Feedback Summary: The outage was misclassified; prioritize correctness and concise explanations.');
  });
  const program = makeProgram();
  const multi: AxMultiMetricFn = ({ prediction, example }) => ({
    accuracy: field(prediction, 'priority') === example.priority ? 1 : 0,
    brevity: String(field(prediction, 'rationale') ?? '').length <= 40 ? 1 : 0,
  });
  const optimizer = new AxGEPA({ studentAI, teacherAI, teacherOptions: options(ctx),
    numTrials: 1, sampleCount: 1, minibatch: true, minibatchSize: 1, seed: 7, verbose: false });
  const result = await optimizer.compile(program, train, pareto ? multi : metric, {
    bootstrap: false, validationExamples: validation, maxMetricCalls: 8, skipPerfectScore: false, verbose: false,
  });
  assert.ok(result.optimizedProgram);
  assert.equal(result.baselineScore, 0);
  assert.ok(result.bestScore > result.baselineScore);
  assert.ok(result.paretoFront.length > 0);
  assert.ok(teacherCalls >= 2 && teacherCalls <= 4);
  assert.ok(studentCalls <= 8);
  const restored = axDeserializeOptimizedProgram(axSerializeOptimizedProgram(result.optimizedProgram));
  program.applyOptimization(restored);
  const replay = await program.forward(studentAI, validation[0]!, options(ctx));
  assert.equal(replay.priority, 'high');
  return { baseline: result.baselineScores, selected: result.bestScore,
    frontier: result.paretoFront.map(point => ({ scores: point.scores, configuration: point.configuration })),
    componentMap: restored.componentMap, studentCalls, teacherCalls, replay,
    comparison: 'Train supplies reflection; held-out selection uses the same validation subset for baseline and candidates. Scalar reward depends on objective definitions/weights and dataset, so it is not an invariant across experiments.' };
}

async function budgetBoundary(ctx: ExampleContext) {
  let calls = 0;
  const model = scriptedAI(() => { calls++; return response(answer); });
  const optimizer = new AxGEPA({ studentAI: model, numTrials: 1, verbose: false });
  await assert.rejects(() => optimizer.compile(makeProgram(), train, metric, { maxMetricCalls: 0 }), /maxMetricCalls/);
  assert.equal(calls, 0);
  const program = makeProgram();
  const result = await optimizer.compile(program, train, metric, {
    maxMetricCalls: 1, validationExamples: validation, bootstrap: false,
  });
  assert.ok(result.optimizedProgram);
  assert.equal(result.baselineScore, result.bestScore);
  assert.equal(calls, 1);
  return { invalidBudgetRejectedBeforeModel: true, exhaustedBudgetRetainsBaseline: result.bestScore, calls };
}

async function qualitativeMetric(ctx: ExampleContext) {
  // Outside agent.optimize, own the qualitative rubric with one plain typed AxGen.
  const evaluator = new AxGen<{ taskInput: string; candidateOutput: string; expectedOutput: string }, { score: number }>(
    'taskInput:string, candidateOutput:string, expectedOutput:string -> score:number');
  evaluator.setInstruction('Score factual correctness from 0 to 1. Penalize invented claims. Return only score.');
  const judgeAI = ctx.mode === 'live' ? ctx.ai : scriptedAI([response('Score: 1')]);
  const judged = await evaluator.forward(judgeAI, {
    taskInput: 'Summarize: checkout is down.', candidateOutput: 'Checkout is unavailable.', expectedOutput: 'Checkout outage.',
  }, options(ctx));
  assert.ok(Number.isFinite(judged.score));
  const score = Math.max(0, Math.min(1, judged.score));
  assert.ok(score >= 0 && score <= 1);
  return { score, boundary: 'A rubric-bound model judgment is not exact correctness or an action-policy invariant. Use this numeric evaluator as a metric only when deterministic scoring is unavailable.' };
}

async function flowTreeComponents(ctx: ExampleContext) {
  const makeFlow = () => {
    const route = ax('ticket:string -> route:class "high, normal"');
    const classify = ax('route:string -> priority:class "high, normal"');
    const program = flow<{ ticket: string }>()
      .node('route', route).node('classify', classify)
      .execute('route', state => ({ ticket: state.ticket }))
      .execute('classify', state => ({ route: state.routeResult.route }))
      .returns(state => ({ priority: state.classifyResult.priority }));
    program.setId('outage-flow');
    return { program, route, classify };
  };
  const training = makeFlow();
  const production = makeFlow();
  const initial = Object.fromEntries(training.program.getOptimizableComponents().map(c => [c.key, c.current]));
  const productionInitial = Object.fromEntries(production.program.getOptimizableComponents().map(c => [c.key, c.current]));
  const requests: { stage: string; repaired: boolean }[] = [];
  let teacherCalls = 0;
  const studentAI = scriptedAI(request => {
    const prompt = JSON.stringify(request.chatPrompt);
    const user = JSON.stringify(request.chatPrompt.filter(message => message.role === 'user').at(-1));
    // Scalar signatures use labeled text, not a responseFormat JSON schema.
    const routeStage = user.includes('Ticket:');
    assert.ok(routeStage || user.includes('Route:'));
    const repaired = prompt.includes('FLOW_REPAIRED');
    requests.push({ stage: routeStage ? 'route' : 'classify', repaired });
    return response(routeStage
      ? `Route: ${repaired ? 'high' : 'normal'}`
      : `Priority: ${repaired || /high/i.test(user) ? 'high' : 'normal'}`);
  });
  const teacherAI = scriptedAI(request => {
    teacherCalls++;
    assert.ok(teacherCalls <= 4, 'One reflective mutation has bounded teacher I/O');
    return response(JSON.stringify(request.chatPrompt).includes('New Value')
      ? 'New Value: FLOW_REPAIRED: Route customer-facing outages to high priority.'
      : 'Feedback Summary: The two-node flow returned normal for an outage; change the selected child instruction.');
  });
  try {
    const result = await optimize(training.program, train, metric, {
      studentAI, teacherAI, teacherOptions: options(ctx), bootstrap: false,
      validationExamples: validation, maxMetricCalls: 8, numTrials: 1,
      sampleCount: 1, minibatch: true, minibatchSize: 1, seed: 7, verbose: false,
    });
    assert.ok(result.optimizedProgram);
    const restored = axDeserializeOptimizedProgram(JSON.parse(JSON.stringify(
      axSerializeOptimizedProgram(result.optimizedProgram))));
    assert.deepEqual(restored.componentMap, result.optimizedProgram.componentMap);
    assert.deepEqual(Object.keys(restored.componentMap ?? {}).sort(), Object.keys(initial).sort());
    assert.ok(`${training.route.getId()}::instruction` in (restored.componentMap ?? {}));
    assert.ok(`${training.classify.getId()}::instruction` in (restored.componentMap ?? {}));
    const changed = Object.entries(restored.componentMap ?? {}).filter(([key, value]) => initial[key] !== value);
    assert.ok(changed.some(([key, value]) => key.startsWith('outage-flow.') && value.includes('FLOW_REPAIRED')));
    assert.equal(result.baselineScore, 0);
    const before = await production.program.forward(studentAI, validation[0]!, options(ctx));
    assert.equal(before.priority, 'normal');
    assert.equal(production.route.getId(), training.route.getId());
    assert.equal(production.classify.getId(), training.classify.getId());
    production.program.applyOptimization(restored);
    const replayStart = requests.length;
    const after = await production.program.forward(studentAI, validation[0]!, options(ctx));
    assert.equal(after.priority, 'high');
    assert.ok(requests.slice(replayStart).some(request => request.repaired), 'Applied child text must reach a real model request');
    assert.ok(result.stats.totalCalls <= 8);
    assert.equal(requests.length, 2 * result.stats.totalCalls + 4, 'Each real rollout executes both child nodes');
    return { componentKeys: Object.keys(restored.componentMap ?? {}), changed, before, after,
      metricCalls: result.stats.totalCalls, childModelCalls: requests.length, teacherCalls,
      boundary: 'A scripted text-dependent fixture demonstrates tree artifacts and stable-ID routing, not model-quality improvement.' };
  } finally {
    training.program.applyOptimizedComponents(initial);
    production.program.applyOptimizedComponents(productionInitial);
    training.program.setDemos([]);
    production.program.setDemos([]);
    training.program.resetTraces();
    production.program.resetTraces();
  }
}

async function bootstrapBaselineFreshness(ctx: ExampleContext) {
  // A registered generator tree intentionally retains inactive child traces.
  // Flow clears its trace inventory on every forward, so it cannot expose
  // the stale-child regression addressed by the bootstrap identity snapshot.
  const signature = 'ticket:string, inspect:boolean -> priority:class "high, normal"' as const;
  const heldOnly = ax(signature);
  let childCalls = 0;
  const childAI = scriptedAI(() => { childCalls++; return response('Priority: high'); });
  const inspectTicket = fn('inspectTicket').description('Inspect only held-out tickets with inspect=true')
    .arg('ticket', f.string()).arg('inspect', f.boolean()).returns(f.string())
    .handler(async input => {
      assert.equal(input.inspect, true);
      assert.equal(input.ticket, 'HELD-OUT');
      const inspected = await heldOnly.forward(childAI, input, options(ctx));
      return inspected.priority;
    }).build();
  const program = ax(signature, { ...options(ctx), functions: [inspectTicket], functionCallMode: 'native' });
  program.register(heldOnly, 'heldOnly');
  program.setId('fresh-bootstrap');
  const initial = Object.fromEntries(program.getOptimizableComponents().map(c => [c.key, c.current]));
  const callerDemos = [{
    programId: program.getId(),
    traces: [{ ticket: 'CALLER_BASELINE', inspect: false, priority: 'normal' }],
  }] satisfies Parameters<typeof program.setDemos>[0];
  program.setDemos(callerDemos);
  const examples = [
    { ticket: 'TRAIN-A', inspect: false, priority: 'high' },
    { ticket: 'TRAIN-B', inspect: false, priority: 'high' },
  ];
  const heldout = [{ ticket: 'HELD-OUT', inspect: true, priority: 'high' }];
  const scored: { ticket: unknown; priority: unknown }[] = [];
  const validationDemoKinds: string[] = [];
  let studentCalls = 0;
  let bootstrapCalls = 0;
  let staleHeldTraceObserved = false;
  const studentAI = scriptedAI(request => {
    studentCalls++;
    const user = JSON.stringify(request.chatPrompt.filter(message => message.role === 'user').at(-1));
    // Demos render as real user/assistant pairs before the current input.
    const demoInputs = JSON.stringify(request.chatPrompt.filter(message => message.role === 'user').slice(0, -1));
    const callerSeeded = demoInputs.includes('CALLER_BASELINE');
    const trainingSeeded = /TRAIN-[AB]/.test(demoInputs);
    if (user.includes('HELD-OUT') && !request.chatPrompt.some(message => message.role === 'function')) {
      assert.notEqual(callerSeeded, trainingSeeded, 'Each validation request must contain exactly one demo source');
      validationDemoKinds.push(callerSeeded ? 'caller' : 'training');
      return { results: [{ index: 0, functionCalls: [{
        id: `inspect-${studentCalls}`, type: 'function',
        function: { name: 'inspectTicket', params: { ticket: 'HELD-OUT', inspect: true } },
      }], finishReason: 'function_call' }] };
    }
    return response(`Priority: ${callerSeeded ? 'normal' : 'high'}`);
  });
  const teacherAI = scriptedAI(() => {
    bootstrapCalls++;
    staleHeldTraceObserved = program.getTraces().some(trace => trace.programId === heldOnly.getId());
    return response('Priority: high');
  });
  const score: AxMetricFn = args => {
    scored.push({ ticket: args.example.ticket, priority: field(args.prediction, 'priority') });
    return metric(args);
  };
  const settings = {
    studentAI, teacherAI, teacherOptions: options(ctx),
    bootstrap: { maxRounds: 1, maxExamples: 1, maxDemos: 1, batchSize: 1, verboseMode: false },
    validationExamples: heldout, numTrials: 1, sampleCount: 1, seed: 7, verbose: false,
  } as const;
  try {
    const result = await optimize(program, examples, score, { ...settings, maxMetricCalls: 2 });
    assert.ok(result.optimizedProgram);
    assert.equal(result.baselineScore, 0, 'Caller-supplied demos belong to the pre-bootstrap baseline');
    assert.deepEqual(result.baselineScores, { score: 0 });
    assert.equal(result.bestScore, 1, 'The seeded validation pass uses training demos, without overwriting baseline metadata');
    assert.deepEqual(scored.map(row => row.priority), ['normal', 'high', 'high']);
    assert.deepEqual(validationDemoKinds, ['caller', 'training'], 'Both validation passes must render their actual demo source');
    assert.equal(scored[0]?.ticket, 'HELD-OUT');
    assert.ok(examples.some(example => example.ticket === scored[1]?.ticket));
    assert.equal(scored[2]?.ticket, 'HELD-OUT');
    assert.ok(staleHeldTraceObserved, 'Bootstrap starts with a real held-out child trace already present');
    assert.ok(result.demos?.some(demo => demo.programId === program.getId()));
    assert.ok(!result.demos?.some(demo => demo.programId === heldOnly.getId()), 'Inactive held-out child cannot seed training demos');
    assert.ok(result.demos?.every(demo => demo.traces.every(trace => !JSON.stringify(trace).includes('HELD-OUT'))));
    assert.equal(bootstrapCalls, 1);
    assert.equal(studentCalls, 4, 'Each of two validation passes requests the conditional child and then final output');
    assert.equal(childCalls, 2, 'The conditional child runs only during held-out validation');
    assert.equal(result.stats.totalCalls, 3, 'Two GEPA metric evaluations plus one separate BootstrapFewShot evaluation');

    program.setDemos(callerDemos);
    scored.length = 0;
    const beforeStudent = studentCalls;
    const beforeBootstrap = bootstrapCalls;
    const beforeChild = childCalls;
    await assert.rejects(() => optimize(program, examples, score, { ...settings, maxMetricCalls: 1 }),
      /maxMetricCalls=1 is too small for bootstrapped Pareto evaluation; need at least 2 metric calls/);
    assert.deepEqual(scored.map(row => row.priority), ['normal', 'high']);
    assert.deepEqual(validationDemoKinds, ['caller', 'training', 'caller']);
    assert.equal(studentCalls - beforeStudent, 2, 'Rejected budget permits only the original validation pass');
    assert.equal(childCalls - beforeChild, 1);
    assert.equal(bootstrapCalls - beforeBootstrap, 1, 'Bootstrap metric calls are separate, not silently added to the GEPA budget');
    return { baseline: result.baselineScore, selected: result.bestScore,
      gepaMetricCalls: 2, bootstrapMetricCalls: 1, totalMetricCalls: result.stats.totalCalls,
      staleHeldTraceObserved, validationDemoKinds,
      demoPrograms: result.demos?.map(demo => demo.programId), explicitBudgetRejected: true };
  } finally {
    program.applyOptimizedComponents(initial);
    program.setDemos(callerDemos);
  }
}

export const examples: readonly Example[] = [
  { id: '23-optimize/bootstrap-gepa-artifact', title: 'Normal optimize pipeline with bounded bootstrap and reusable artifact', features: ['optimize', 'BootstrapFewShot', 'baseline', 'validation', 'call-budgets', 'artifact-serialize-restore-apply'], modes: ['offline', 'live'], run: globalPipeline },
  { id: '23-optimize/bootstrap-traces', title: 'Low-level successful-trace demonstration selection', features: ['AxBootstrapFewShot', 'demos', 'held-out-replay'], modes: ['offline'], run: bootstrapOnly },
  { id: '23-optimize/direct-gepa', title: 'One real reflective mutation retained by the metric', features: ['AxGEPA', 'reflection', 'candidate-selection'], modes: ['offline'], run: ctx => directGEPA(ctx, false) },
  { id: '23-optimize/pareto', title: 'Accuracy and brevity as an actual Pareto objective vector', features: ['AxGEPA', 'Pareto', 'multi-objective', 'componentMap'], modes: ['offline'], run: ctx => directGEPA(ctx, true) },
  { id: '23-optimize/budget-boundary', title: 'Invalid budget rejection and baseline-only bounded selection', features: ['call-budgets', 'error-boundary', 'baseline-artifact'], modes: ['offline'], run: budgetBoundary },
  { id: '23-optimize/qualitative-metric', title: 'Plain typed AxGen qualitative evaluator, not a judge framework', features: ['AxGen', 'qualitative-metric', 'rubric'], modes: ['offline', 'live'], run: qualitativeMetric },
  { id: '23-optimize/flow-tree-components', title: 'Optimize and restore full component keys across a real two-node Flow', features: ['Flow', 'GEPA', 'componentMap', 'stable-IDs', 'artifact-serialize-restore-apply'], modes: ['offline'], run: flowTreeComponents },
  { id: '23-optimize/bootstrap-baseline-freshness', title: 'Preserve caller baseline, exclude held-out child traces, and respect explicit budgets', features: ['optimize', 'BootstrapFewShot', 'caller-demos', 'fresh-traces', 'validation', 'call-budgets'], modes: ['offline'], run: bootstrapBaselineFreshness },
];

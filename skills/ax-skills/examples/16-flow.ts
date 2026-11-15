import assert from 'node:assert/strict';
import {
  ai, ax, f, fn, flow, runControl, axGlobals, AxMockAIService, AxAIOpenAI, AxAIOpenAIModel,
  AxInMemoryEventStore, eventInput, eventPath, eventRoute, eventRuntime, eventTarget,
  type AxAIServiceOptions, type AxChatRequest, type AxChatResponse, type AxEventContext, type AxEventIngress,
  type AxChatSession, type AxChatSessionEvent, type AxGenOut, type AxRunControlEvent,
} from '@ax-llm/ax';
import { ROOT_CONTEXT, metrics, trace } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { options, scriptedAI, type Example } from './support.js';

// These are deterministic model outputs, not evidence of model quality. All
// orchestration, signature parsing and state transitions below are real Ax APIs.
const reply = (content: string): AxChatResponse => ({
  results: [{ index: 0, content, finishReason: 'stop' }],
});

export const examples: readonly Example[] = [
  {
    id: '16-flow/typesafe-rubric-score',
    title: 'Run an explicit native rubric score through a real Flow node',
    features: ['flow', 'typesafe', 'explicit score rubric', 'native evidence', 'one batch'],
    modes: ['offline'],
    async run(ctx) {
      const levels = ['Minor inconvenience', 'Feature impaired', 'Core task blocked'] as const;
      const judge = ax(f().input('ticket', f.string())
        .output('severity', f.score(levels, 'Customer impact').withEvidence()).build());
      const workflow = flow<{ ticket: string }>()
        .node('judgeImpact', judge)
        .execute('judgeImpact', (state) => ({ ticket: state.ticket }))
        .returns((state) => ({ severity: state.judgeImpactResult.severity }));
      let calls = 0;
      // Inject HTTP I/O only: Flow execution and adapter serialization/decoding stay real.
      const aiTypesafe = ai({ name: 'typesafe', apiKey: 'isolated-fixture-not-a-secret', options: {
        fetch: async (input, init) => {
          const request = new Request(input, init);
          assert.equal(new URL(request.url).pathname, '/v1/systemone');
          const body = await request.json() as {
            questions: Record<string, { type: string; criteria: unknown }>;
          };
          assert.deepEqual(Object.keys(body.questions), ['severity']);
          assert.equal(body.questions.severity?.type, 'score');
          assert.deepEqual(body.questions.severity?.criteria, levels);
          calls++;
          return Response.json({ model: 'jev-fixture', answers: {
            severity: { type: 'score', score: 1.8, probabilities: { '0': 0.1, '1': 0.4, '2': 0.5 },
              legend: { '0': levels[0], '1': levels[1], '2': levels[2] }, confidence: 0.75 },
          }, usage: { input_tokens: 24, output_tokens: 5 } });
        },
      } });
      const result = await workflow.forward(aiTypesafe, {
        ticket: 'Checkout fails for every customer; payments cannot complete.',
      }, { ...options(ctx), modelConfig: {} });
      assert.equal(result.severity.value, 1.8); // Preserve the native fractional value, not weighted mean 1.4.
      assert.deepEqual(result.severity.levels, levels);
      assert.deepEqual(result.severity.probabilities, [0.1, 0.4, 0.5]);
      assert.equal(result.severity.confidence, 0.75);
      assert.deepEqual(result.severity.provenance, { source: 'native', provider: 'Typesafe', model: 'jev-fixture' });
      assert.equal(calls, 1);
      return { result, batches: calls,
        proof: 'Injected HTTP fixture, not inference quality or calibration. f.score declares ordered rubric levels; an ordinary number field would not define a Typesafe rubric.' };
    },
  },
  {
    id: '16-flow/serial-contracts',
    title: 'Typed nodes: normalize → extract → explain with an actual dependency',
    features: ['flow', 'typed-nodes', 'input-mapping', 'serial-dependencies', 'extended-nodes'],
    modes: ['offline', 'live'],
    async run(ctx) {
      const extraction = ax('documentText:string -> orderCode:string');
      extraction.addAssert(({ orderCode }) => /^ORD-\d{3}$/.test(orderCode), 'Use the exact ORD-000 identifier from the document');
      const pipeline = flow<{ document: string }, { orderCode: string; explanation: string }>()
        .node('extractOrder', extraction)
        .nodeExtended('explainOrder', 'orderCode:string -> explanation:string', {
          appendInputs: [{ name: 'audience', type: f.string() }],
        })
        .map((state) => ({ ...state, normalizedDocument: state.document.trim() }))
        .execute('extractOrder', (state) => ({ documentText: state.normalizedDocument }))
        .execute('explainOrder', (state) => ({ orderCode: state.extractOrderResult.orderCode, audience: 'customer support' }))
        .returns((state) => {
          const explanation = state.explainOrderResult.explanation;
          assert.equal(typeof explanation, 'string');
          if (typeof explanation !== 'string') throw new Error('Expected a textual explanation');
          return { orderCode: state.extractOrderResult.orderCode, explanation };
        });
      const ai = ctx.mode === 'live' ? ctx.ai : scriptedAI([
        reply('Order Code: ORD-104'),
        reply('Explanation: ORD-104 is the order identifier support should use.'),
      ]);
      const result = await pipeline.forward(ai, { document: '  Customer order ORD-104 is ready.  ' }, options(ctx));
      assert.equal(result.orderCode, 'ORD-104');
      assert.ok(result.explanation.includes(result.orderCode));
      return { ...result, ownership: 'Application owns the DAG; no agent chooses the next step and no business write occurs.' };
    },
  },
  {
    id: '16-flow/branch-boundaries',
    title: 'Application-owned routing executes only the selected branch',
    features: ['flow', 'branch', 'when', 'merge', 'untaken-branch-boundary'],
    modes: ['offline', 'live'],
    async run(ctx) {
      const visited: string[] = [];
      const workflow = flow<{ question: string; detailed: boolean }, { answer: string; hasSimple: boolean; hasDetailed: boolean }>()
        .node('simpleReply', 'question:string -> answer:string')
        .node('detailedReply', 'question:string -> answer:string')
        .branch((state) => state.detailed)
        .when(true)
        .execute('detailedReply', (state) => {
          visited.push('detailed');
          return { question: state.question };
        })
        .when(false)
        .execute('simpleReply', (state) => {
          visited.push('simple');
          return { question: state.question };
        })
        .merge()
        .returns((state) => ({
          answer: state.detailedReplyResult?.answer ?? state.simpleReplyResult?.answer ?? '',
          hasSimple: state.simpleReplyResult !== undefined,
          hasDetailed: state.detailedReplyResult !== undefined,
        }));
      const ai = ctx.mode === 'live' ? ctx.ai : scriptedAI([
        reply('Answer: Backups allow recovery after data loss.'),
        reply('Answer: Backups preserve independent copies; restore tests check recovery.'),
      ]);
      const simple = await workflow.forward(ai, { question: 'Why keep backups?', detailed: false }, options(ctx));
      const detailed = await workflow.forward(ai, { question: 'Why keep backups? Give two facts.', detailed: true }, options(ctx));
      assert.deepEqual(visited, ['simple', 'detailed']);
      assert.deepEqual([simple.hasSimple, simple.hasDetailed], [true, false]);
      assert.deepEqual([detailed.hasSimple, detailed.hasDetailed], [false, true]);
      assert.ok(simple.answer.length > 0 && detailed.answer.length > 0);
      return { simple, detailed, boundary: 'Results are per run, not sticky branch state or durable records.' };
    },
  },
  {
    id: '16-flow/parallel-merge',
    title: 'Independent reviews fan out through Ax parallel and join explicitly',
    features: ['flow', 'parallel', 'merge', 'execution-plan'],
    modes: ['offline', 'live'],
    async run(ctx) {
      const workflow = flow<{ releaseNote: string }, { review: { customer: string; operator: string } }>()
        .node('customerReview', 'releaseNote:string -> customerImpact:string')
        .node('operatorReview', 'releaseNote:string -> operatorAction:string')
        .parallel([
          (sub) => sub.execute('customerReview', (state) => ({ releaseNote: state.releaseNote })),
          (sub) => sub.execute('operatorReview', (state) => ({ releaseNote: state.releaseNote })),
        ])
        .merge('joinedReview', (customer, operator) => {
          assert.ok(customer && typeof customer === 'object' && 'customerReviewResult' in customer);
          assert.ok(operator && typeof operator === 'object' && 'operatorReviewResult' in operator);
          const customerResult = customer.customerReviewResult;
          const operatorResult = operator.operatorReviewResult;
          assert.ok(customerResult && typeof customerResult === 'object' && 'customerImpact' in customerResult);
          assert.ok(operatorResult && typeof operatorResult === 'object' && 'operatorAction' in operatorResult);
          assert.equal(typeof customerResult.customerImpact, 'string');
          assert.equal(typeof operatorResult.operatorAction, 'string');
          return { customer: String(customerResult.customerImpact), operator: String(operatorResult.operatorAction) };
        })
        .returns((state) => ({ review: state.joinedReview }));
      // Distinct signature labels select fixtures independently of scheduler order.
      const ai = ctx.mode === 'live' ? ctx.ai : scriptedAI((request) => {
        const prompt = JSON.stringify(request.chatPrompt);
        return prompt.includes('Customer Impact')
          ? reply('Customer Impact: The maintenance window interrupts checkout for five minutes.')
          : reply('Operator Action: Monitor checkout errors during the maintenance window.');
      });
      const result = await workflow.forward(ai, { releaseNote: 'Checkout maintenance lasts five minutes; operators must monitor errors.' }, options(ctx));
      assert.ok(result.review.customer.length > 0);
      assert.ok(result.review.operator.length > 0);
      return { ...result, plan: workflow.getExecutionPlan(), ownership: 'Parallel read-only reviews; merge is a barrier, not a transaction.' };
    },
  },
  {
    id: '16-flow/map-reduce',
    title: 'Bounded array derivation and deterministic business reduction',
    features: ['flow', 'derive', 'batch-size', 'map', 'reduce', 'state-transformation'],
    modes: ['offline'],
    async run(ctx) {
      const workflow = flow<{ quantities: number[]; unitCents: number }, { lineCents: number[]; totalCents: number }>({ batchSize: 2 })
        .map((state) => ({ ...state, lineCents: [] as number[] }))
        .derive('lineCents', 'quantities', (quantity: number, _index, state) => {
          assert.ok(state);
          return quantity * state.unitCents;
        }, { batchSize: 2 })
        .map((state) => ({ ...state, totalCents: state.lineCents.reduce((sum, cents) => sum + cents, 0) }))
        .returns((state) => ({ lineCents: state.lineCents, totalCents: state.totalCents }));
      // No model is needed for arithmetic. Exhaustion detects an accidental call.
      const result = await workflow.forward(scriptedAI([]), { quantities: [2, 1, 3], unitCents: 125 }, options(ctx));
      assert.deepEqual(result.lineCents, [250, 125, 375]);
      assert.equal(result.totalCents, 750);
      const empty = await workflow.forward(scriptedAI([]), { quantities: [], unitCents: 125 }, options(ctx));
      assert.deepEqual(empty, { lineCents: [], totalCents: 0 });
      return { result, empty, reason: 'Use Ax derive for batched work, host integer arithmetic for money; no LLM arithmetic or custom Promise.all.' };
    },
  },
  {
    id: '16-flow/async-parallel-map',
    title: 'Async order lookup and parallel owned reads merge into a typed fulfillment decision',
    features: ['flow', 'async-map', 'parallel-map-array', 'typed-state-merge', 'overlap-barrier'],
    modes: ['offline'],
    async run(ctx) {
      const events: string[] = [];
      const orderRows: Record<string, { sku: string; requestedUnits: number } | undefined> = {
        'ORD-104': { sku: 'BACKUP-DRIVE', requestedUnits: 3 },
      };
      const inventoryRows: Record<string, number | undefined> = { 'BACKUP-DRIVE': 4 };
      const priceRows: Record<string, number | undefined> = { 'BACKUP-DRIVE': 12500 };
      const bothReadsStarted = Promise.withResolvers<void>();
      let startedReads = 0;
      let activeReads = 0;
      let peakReads = 0;
      const abortBarrier = () => bothReadsStarted.reject(ctx.signal.reason);
      ctx.signal.throwIfAborted();
      ctx.signal.addEventListener('abort', abortBarrier, { once: true });
      const beginRead = async (name: string) => {
        events.push(`${name}:start`);
        activeReads++;
        peakReads = Math.max(peakReads, activeReads);
        if (++startedReads === 2) bothReadsStarted.resolve();
        try {
          // Neither read can finish until the SDK starts the other transform.
          await bothReadsStarted.promise;
        } finally {
          activeReads--;
          events.push(`${name}:end`);
        }
      };
      const readOrder = async (orderId: string) => {
        events.push('order:start');
        const order = await Promise.resolve(orderRows[orderId]);
        assert.ok(order);
        events.push('order:end');
        return order;
      };
      const readInventory = async (sku: string) => {
        await beginRead('inventory');
        const availableUnits = inventoryRows[sku];
        assert.notEqual(availableUnits, undefined);
        return availableUnits;
      };
      const readPrice = async (sku: string) => {
        await beginRead('price');
        const unitCents = priceRows[sku];
        assert.notEqual(unitCents, undefined);
        return unitCents;
      };
      type EnrichedOrder = {
        orderId: string;
        sku: string;
        requestedUnits: number;
        availableUnits?: number;
        unitCents?: number;
      };
      const workflow = flow<{ orderId: string }>({ batchSize: 2 })
        .map(async (state) => ({ ...state, ...await readOrder(state.orderId) }))
        // Each callback owns one new key; neither mutates the shared input state.
        // Optional fields model partial results honestly until the join validates them.
        .map<EnrichedOrder>([
          async (state) => ({ ...state, availableUnits: await readInventory(state.sku) }),
          async (state) => ({ ...state, unitCents: await readPrice(state.sku) }),
        ], { parallel: true })
        .returns((state) => {
          assert.equal(typeof state.availableUnits, 'number');
          assert.equal(typeof state.unitCents, 'number');
          if (state.availableUnits === undefined || state.unitCents === undefined) {
            throw new Error('Both owned reads must complete before fulfillment');
          }
          events.push('fulfillment');
          return {
            orderId: state.orderId,
            canFulfill: state.availableUnits >= state.requestedUnits,
            totalCents: state.requestedUnits * state.unitCents,
            remainingUnits: state.availableUnits - state.requestedUnits,
          };
        });
      let result;
      try {
        result = await workflow.forward(scriptedAI([]), { orderId: 'ORD-104' }, options(ctx));
      } finally {
        ctx.signal.removeEventListener('abort', abortBarrier);
      }
      assert.deepEqual(result, { orderId: 'ORD-104', canFulfill: true, totalCents: 37500, remainingUnits: 1 });
      assert.equal(peakReads, 2);
      assert.equal(startedReads, 2);
      assert.equal(activeReads, 0);
      assert.deepEqual(events.slice(0, 2), ['order:start', 'order:end']);
      const lastStart = Math.max(events.indexOf('inventory:start'), events.indexOf('price:start'));
      assert.ok(lastStart < events.indexOf('inventory:end') && lastStart < events.indexOf('price:end'));
      assert.equal(events.at(-1), 'fulfillment');
      return { result, events, peakReads, ownership: 'Finite application-owned read fixtures; Ax awaits the async map and joins parallel transforms. No model call, external write or sleep-based timing claim.' };
    },
  },
  {
    id: '16-flow/bounded-state-loops',
    title: 'While and feedback mutate explicit flat state with hard iteration limits',
    features: ['flow', 'while', 'endWhile', 'label', 'feedback', 'program-state'],
    modes: ['offline'],
    async run(ctx) {
      const counter = flow<{ target: number }, { count: number; attempts: number }>()
        .map((state) => ({ ...state, count: 0, attempts: 0 }))
        .while((state) => state.count < state.target && state.count < 3)
        .map((state) => ({ ...state, count: state.count + 1 }))
        .endWhile()
        .label('retryBudget')
        .map((state) => ({ ...state, attempts: state.attempts + 1 }))
        .feedback((state) => state.attempts < 2, 'retryBudget')
        .returns((state) => ({ count: state.count, attempts: state.attempts }));
      const capped = await counter.forward(scriptedAI([]), { target: 100 }, options(ctx));
      assert.deepEqual(capped, { count: 3, attempts: 2 });
      const fresh = await counter.forward(scriptedAI([]), { target: 1 }, options(ctx));
      assert.deepEqual(fresh, { count: 1, attempts: 2 });
      return { capped, fresh, boundary: 'Flat run state resets; these loops do not persist checkpoints or retry external writes.' };
    },
  },
  {
    id: '16-flow/program-cache',
    title: 'Named programs, demos, application-owned cache and flow tool schema',
    features: ['flow', 'namedPrograms', 'setDemos', 'cachingFunction', 'toFunction', 'chat-log'],
    modes: ['offline'],
    async run(ctx) {
      let calls = 0;
      const cache = new Map<string, AxGenOut>();
      const workflow = flow<{ question: string }, { answer: string }>()
        .node('answerQuestion', 'question:string -> answer:string')
        .execute('answerQuestion', (state) => ({ question: state.question }))
        .returns((state) => ({ answer: state.answerQuestionResult.answer }))
        .description('Answer Question', 'Read-only answer from an explicit question.');
      const programs = workflow.namedPrograms();
      assert.ok(programs.some((program) => program.id.endsWith('answerQuestion')));
      workflow.setDemos([{ programId: 'root.answerQuestion', traces: [{ question: 'What is a backup?', answer: 'An independent recovery copy.' }] }]);
      const ai = scriptedAI(() => {
        calls++;
        return reply('Answer: A backup is an independent recovery copy.');
      });
      const forwardOptions = {
        ...options(ctx),
        cachingFunction: async (key: string, value?: AxGenOut): Promise<AxGenOut | undefined> => {
          if (value === undefined) return cache.get(key);
          cache.set(key, value);
          return undefined;
        },
      };
      const first = await workflow.forward(ai, { question: 'What is a backup?' }, forwardOptions);
      const chatLogEntries = workflow.getChatLog().length;
      assert.ok(chatLogEntries > 0);
      const second = await workflow.forward(ai, { question: 'What is a backup?' }, forwardOptions);
      assert.deepEqual(first, second);
      assert.equal(calls, 1);
      const tool = workflow.toFunction();
      assert.ok(tool.name.length > 0 && tool.parameters);
      return { first, modelCalls: calls, cacheEntries: cache.size, chatLogEntries, programs: programs.map(({ id }) => id), toolName: tool.name, boundary: 'Volatile cache stores accepted output, not authorization, durability or an exactly-once effect ledger.' };
    },
  },
  {
    id: '16-flow/automatic-session-control',
    title: 'Node-scoped session updates preserve completed work and bypass cached Flow results',
    features: ['flow', 'runControl', 'automatic-sessions', 'executionPath', 'targeted-updates', 'completed-node-boundary', 'cache-bypass'],
    modes: ['offline'],
    async run(ctx) {
      const control = runControl();
      const rootInstruction = 'Include the shared retention policy.';
      const reviewInstruction = 'Review only: include the operator warning.';
      const completedInstruction = 'Do not replay this completed baseline.';
      const events: AxRunControlEvent[] = [];
      type SessionRecord = {
        path: string;
        steering: string[];
        thinking: string[];
        continuations: number;
        closed: number;
      };
      const sessions: SessionRecord[] = [];
      let updatesQueued = false;
      const unsubscribe = control.onEvent((event) => {
        events.push(event);
        if (event.type !== 'model.output' || event.path !== 'root/review' || updatesQueued) return;
        updatesQueued = true;
        // The first review response is an event barrier, not a sleep. Baseline
        // has finished; review is active; archive cannot start until review joins.
        control.steer(completedInstruction, { target: 'root/baseline' });
        control.steer(reviewInstruction, { target: 'root/review' });
        control.setThinkingTokenBudget('low', { target: 'root/review' });
        control.steer(rootInstruction);
      });
      class FlowSessionFixture extends AxMockAIService<string> {
        constructor() {
          super({
            name: 'flow-session-transport-fixture',
            features: { functions: true, streaming: true },
            chatResponse: async () => { throw new Error('Controlled Flow nodes must open sessions, not fall back to chat'); },
          });
        }
        override getFeatures() { return { ...super.getFeatures(), asyncTools: true }; }
        async openChatSession(
          request: Readonly<AxChatRequest<unknown>>,
          serviceOptions?: Readonly<AxAIServiceOptions>,
        ): Promise<AxChatSession> {
          const path = serviceOptions?.executionPath;
          assert.ok(path === 'root/baseline' || path === 'root/review' || path === 'root/archive');
          assert.ok(!sessions.some((record) => record.path === path), 'A completed node must not reopen');
          // Each SDK-opened conversation starts with its own mapped inputs,
          // rather than inheriting another node's assistant messages.
          assert.ok(!request.chatPrompt.some((message) => message.role === 'assistant'));
          const prompt = JSON.stringify(request.chatPrompt);
          if (path === 'root/review') assert.ok(prompt.includes('BASELINE-104'));
          if (path === 'root/archive') assert.ok(prompt.includes('reviewed with operator warning and retention policy'));
          const record: SessionRecord = { path, steering: [], thinking: [], continuations: 0, closed: 0 };
          sessions.push(record);
          const session: AxChatSession = {
            model: 'finite-flow-session-fixture',
            signal: ctx.signal,
            async *events(): AsyncIterable<AxChatSessionEvent> {
              ctx.signal.throwIfAborted();
              const first = path === 'root/baseline'
                ? reply('Baseline Text: BASELINE-104')
                : path === 'root/review'
                  ? reply('Review Text: Provisional review')
                  : reply('Archive Text: Provisional archive');
              yield { type: 'response', responseId: `${path}/first`, response: first };
              yield { type: 'response.completed', responseId: `${path}/first`, response: first };
              if (path === 'root/baseline') throw new Error('Baseline must finish at its first boundary');
              // Ax must deliver matching controls and request a successor before
              // this finite transport script supplies its revised response.
              assert.equal(record.continuations, 1);
              assert.deepEqual(record.steering, path === 'root/review'
                ? [reviewInstruction, rootInstruction] : [rootInstruction]);
              assert.deepEqual(record.thinking, path === 'root/review' ? ['low'] : []);
              const final = path === 'root/review'
                ? reply('Review Text: BASELINE-104 reviewed with operator warning and retention policy')
                : reply('Archive Text: Retention policy recorded without the review-only instruction');
              ctx.signal.throwIfAborted();
              yield { type: 'response', responseId: `${path}/final`, response: final };
              yield { type: 'response.completed', responseId: `${path}/final`, response: final };
              throw new Error('Final response must finish the node without another continuation');
            },
            async submitToolResults() { throw new Error('This fixture has no tool calls'); },
            async continue() { assert.equal(record.closed, 0); record.continuations++; },
            async steer(instruction) {
              assert.equal(record.closed, 0);
              record.steering.push(instruction);
              return 'next-response';
            },
            async setThinkingTokenBudget(level) {
              assert.equal(record.closed, 0);
              record.thinking.push(level);
              return 'next-response';
            },
            close() { if (record.closed === 0) record.closed++; },
          };
          return session;
        }
      }
      // `flow` is the public typed builder; there is no typedFlow export in 25.4.9.
      const typedFlow = flow<{ releaseNote: string }, { baselineText: string; reviewText: string; archiveText: string }>()
        .node('baseline', ax('releaseNote:string -> baselineText:string'))
        .node('review', ax('baselineText:string -> reviewText:string'))
        .node('archive', ax('reviewText:string -> archiveText:string'))
        .execute('baseline', (state) => ({ releaseNote: state.releaseNote }))
        .execute('review', (state) => ({ baselineText: state.baselineResult.baselineText }))
        .execute('archive', (state) => ({ reviewText: state.reviewResult.reviewText }))
        .returns((state) => ({
          baselineText: state.baselineResult.baselineText,
          reviewText: state.reviewResult.reviewText,
          archiveText: state.archiveResult.archiveText,
        }));
      const cached = { baselineText: 'Cached baseline', reviewText: 'Cached review', archiveText: 'Cached archive' };
      let cacheReads = 0;
      let cacheWrites = 0;
      const forwardOptions = {
        ...options(ctx),
        cachingFunction: async (_key: string, value?: AxGenOut): Promise<AxGenOut | undefined> => {
          if (value !== undefined) { cacheWrites++; return undefined; }
          cacheReads++;
          return cached;
        },
      };
      const input = { releaseNote: 'Release 104 requires an operator review and a retention record.' };
      try {
        ctx.signal.throwIfAborted();
        const ai = new FlowSessionFixture();
        // Negative control: the same callback can short-circuit this Flow.
        assert.deepEqual(await typedFlow.forward(ai, input, forwardOptions), cached);
        assert.equal(cacheReads, 1);
        assert.equal(sessions.length, 0);
        const result = await typedFlow.forward(ai, input, { ...forwardOptions, control });
        assert.deepEqual(result, {
          baselineText: 'BASELINE-104',
          reviewText: 'BASELINE-104 reviewed with operator warning and retention policy',
          archiveText: 'Retention policy recorded without the review-only instruction',
        });
        assert.equal(updatesQueued, true);
        assert.deepEqual(sessions.map(({ path }) => path), ['root/baseline', 'root/review', 'root/archive']);
        assert.deepEqual(sessions.map(({ continuations, closed }) => [continuations, closed]), [[0, 1], [1, 1], [1, 1]]);
        assert.deepEqual(sessions[0]?.steering, []);
        assert.deepEqual(sessions[0]?.thinking, []);
        const applied = events.filter((event) => event.type === 'applied');
        assert.deepEqual([...new Set(applied.map(({ path }) => path))], ['root/review', 'root/archive']);
        assert.equal(events.filter((event) => event.type === 'completed' && event.path === 'root/baseline').length, 1);
        assert.ok(events.findIndex((event) => event.type === 'completed' && event.path === 'root/baseline')
          < events.findIndex((event) => event.type === 'queued'));
        assert.equal(cacheReads, 1, 'Controlled run must not read even the existing cached result');
        assert.equal(cacheWrites, 0, 'Controlled run must not populate either Flow or node caches');
        return { result, sessions, applied, cacheReads, cacheWrites,
          boundary: 'Finite scripted provider-session I/O; Ax owns node scheduling, path matching, continuation, cache bypass and cleanup. Revised text is fixture output, not evidence of model compliance or provider transport support.' };
      } finally {
        unsubscribe();
      }
    },
  },
  {
    id: '16-flow/mermaid-roundtrip',
    title: 'Compile a declarative graph and serialize its contracts',
    features: ['flow', 'mermaid', 'serialization', 'auto-wiring'],
    modes: ['offline', 'live'],
    async run(ctx) {
      const workflow = flow<{ documentText: string }, { summaryText: string }>(`
flowchart TD
  %%ax summarize: documentText:string -> summaryText:string(max 300)
  summarize[Summarize document]
`);
      const serialized = String(workflow);
      assert.ok(serialized.includes('summaryText'));
      const restored = flow<{ documentText: string }, { summaryText: string }>(serialized);
      const ai = ctx.mode === 'live' ? ctx.ai : scriptedAI([reply('Summary Text: Checkout maintenance lasts five minutes.')]);
      const result = await restored.forward(ai, { documentText: 'Checkout will be unavailable for a five-minute maintenance window.' }, options(ctx));
      assert.ok(result.summaryText.length > 0 && result.summaryText.length <= 300);
      return { result, serialized, boundary: 'Diagram serialization is a graph contract, not a running-session checkpoint.' };
    },
  },
  {
    id: '16-flow/automatic-planning',
    title: 'Auto-parallel read dependencies with a per-node AI override and shared limiter',
    features: ['flow', 'auto-parallel', 'execution-plan', 'dynamic-ai-context', 'rate-limiter'],
    modes: ['offline', 'live'],
    async run(ctx) {
      let limitedCalls = 0;
      const topicModel = ctx.mode === 'live' ? ctx.ai : scriptedAI([reply('Topic: maintenance')]);
      const impactModel = ctx.mode === 'live' ? ctx.ai : scriptedAI([reply('Impact: Checkout is unavailable for five minutes.')]);
      const workflow = flow<{ releaseNote: string }, { topic: string; impact: string }>()
        .node('classifyTopic', 'releaseNote:string -> topic:class "maintenance, feature"')
        .node('describeImpact', 'releaseNote:string -> impact:string')
        .execute('classifyTopic', (state) => ({ releaseNote: state.releaseNote }))
        .execute('describeImpact', (state) => ({ releaseNote: state.releaseNote }), { ai: impactModel })
        .returns((state) => ({ topic: state.classifyTopicResult.topic, impact: state.describeImpactResult.impact }));
      const plan = workflow.getExecutionPlan();
      assert.equal(plan.autoParallelEnabled, true);
      assert.ok(plan.maxParallelism >= 2);
      const result = await workflow.forward(topicModel, { releaseNote: 'Maintenance: checkout will be unavailable for five minutes.' }, {
        ...options(ctx),
        rateLimiter: async (next) => { limitedCalls++; return next(); },
      });
      assert.equal(result.topic, 'maintenance');
      assert.ok(result.impact.length > 0);
      return { result, plan, limitedCalls, ownership: 'Host selects providers; metadata drives independent execution. This limiter counts calls, not token cost or semantic quality.' };
    },
  },
  {
    id: '16-flow/opentelemetry-lifecycle',
    title: 'Export completed Flow and AxGen spans with explicit parent context and bounded retention',
    features: ['flow', 'AxGen', 'tracer', 'traceContext', 'opentelemetry-export', 'trace-privacy', 'tracer-lifecycle'],
    modes: ['offline'],
    async run(ctx) {
      // Requires @opentelemetry/api 1.9.0 and sdk-trace-base 2.0.1.
      // This is the SDK's real in-memory exporter, not an external collector.
      const exporter = new InMemorySpanExporter();
      const provider = new BasicTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      const tracer = provider.getTracer('ax-flow-offline-example', '1.0.0');
      // Local injection avoids registering an OTel global or changing axGlobals.
      const parent = tracer.startSpan('fulfillment-request', {}, ROOT_CONTEXT);
      const privateRequest = 'PRIVATE-ORDER-104: approve shipment of three backup drives.';
      const privateRationale = 'PRIVATE-NOTE-104: sufficient verified inventory.';
      const decisionProgram = ax('requestText:string -> decision:class "approve, reject", rationale:string');
      const workflow = flow<{ requestText: string }>()
        .node('shipmentDecision', decisionProgram)
        .execute('shipmentDecision', (state) => ({ requestText: state.requestText }))
        .returns((state) => ({ ship: state.shipmentDecisionResult.decision === 'approve' }));
      let summary: { ship: boolean; spanNames: string[]; chatLogEntries: number } | undefined;
      try {
        let result;
        try {
          result = await workflow.forward(scriptedAI([
            reply(`Decision: approve\nRationale: ${privateRationale}`),
          ]), { requestText: privateRequest }, {
            ...options(ctx),
            tracer,
            traceContext: trace.setSpan(ROOT_CONTEXT, parent),
            excludeContentFromTrace: true,
          });
        } finally {
          parent.end();
          await provider.forceFlush();
        }
        assert.deepEqual(result, { ship: true });
        const spans = exporter.getFinishedSpans();
        const flowSpan = spans.find((span) => span.parentSpanContext?.spanId === parent.spanContext().spanId);
        assert.ok(flowSpan);
        const genSpan = spans.find((span) => span.parentSpanContext?.spanId === flowSpan.spanContext().spanId);
        const requestSpan = spans.find((span) => span.spanContext().spanId === parent.spanContext().spanId);
        assert.ok(flowSpan && genSpan && requestSpan);
        assert.ok(spans.every((span) => span.ended && span.spanContext().traceId === parent.spanContext().traceId));
        assert.equal(flowSpan.parentSpanContext?.spanId, parent.spanContext().spanId);
        assert.equal(genSpan.parentSpanContext?.spanId, flowSpan.spanContext().spanId);
        assert.ok(genSpan.events.length >= 2);
        assert.ok(genSpan.events.some((event) => event.attributes?.field_count === 1));
        const tracePayload = JSON.stringify(spans.map((span) => ({
          name: span.name, attributes: span.attributes, events: span.events, status: span.status,
        })));
        assert.ok(!tracePayload.includes('PRIVATE-ORDER-104') && !tracePayload.includes('PRIVATE-NOTE-104'));
        // Trace exclusion is NOT chat-log erasure. Do not export this log as telemetry.
        const chatLog = workflow.getChatLog();
        const retainedChat = JSON.stringify(chatLog);
        assert.ok(retainedChat.includes(privateRequest) && retainedChat.includes(privateRationale));
        summary = { ship: result.ship, spanNames: spans.map((span) => span.name), chatLogEntries: chatLog.length };
      } finally {
        // Ends the processor/exporter; this exporter also drops its retained spans.
        await provider.shutdown();
      }
      assert.equal(exporter.getFinishedSpans().length, 0);
      assert.ok(summary);
      return { ...summary, exporterRetainedAfterShutdown: 0, boundary: 'Successful-run trace metadata excludes these content sentinels; chat logs still retain content. This flag is not universal redaction of errors, custom attributes, debug logs or provider retention. No network collector or global tracer is installed.' };
    },
  },
  {
    id: '16-flow/runtime-hook-resolution',
    title: 'Resolve Flow hooks without changing child defaults; isolate telemetry failures from limiter failures',
    features: ['flow', 'runtime-hooks', 'precedence', 'global-snapshot', 'telemetry-fail-open', 'rateLimiter'],
    modes: ['offline'],
    async run(ctx) {
      const saved = { rateLimiter: axGlobals.rateLimiter, tracer: axGlobals.tracer, meter: axGlobals.meter };
      const calls: string[] = [];
      // Throwing external telemetry boundaries deliberately export nothing.
      // Ax, not these fixtures, must catch telemetry errors.
      const hooks = (label: string) => ({
        rateLimiter: (async (request) => {
          calls.push(`${label}:limiter`);
          return request();
        }) satisfies NonNullable<AxAIServiceOptions['rateLimiter']>,
        tracer: new Proxy(trace.getTracer(`flow-hooks-${label}`), {
          get(target, property, receiver) {
            if (property === 'startSpan' || property === 'startActiveSpan') return () => {
              calls.push(`${label}:tracer`);
              throw new Error(`Owned ${label} tracer unavailable`);
            };
            return Reflect.get(target, property, receiver);
          },
        }),
        meter: new Proxy(metrics.getMeter(`flow-hooks-${label}`), {
          get(target, property, receiver) {
            if (String(property).startsWith('create')) return () => {
              calls.push(`${label}:meter`);
              throw new Error(`Owned ${label} meter unavailable`);
            };
            return Reflect.get(target, property, receiver);
          },
        }),
      });
      const global = hooks('global');
      const service = hooks('service');
      const child = hooks('child');
      const factory = hooks('factory');
      const forward = hooks('forward');
      let httpCalls = 0;
      const transport = (defaults: Partial<AxAIServiceOptions> = {}) => new AxAIOpenAI({
        apiKey: 'offline-flow-hook-fixture',
        config: { model: AxAIOpenAIModel.GPT4OMini, stream: false },
        options: {
          ...defaults,
          fetch: async () => {
            httpCalls++;
            return Response.json({
              id: 'flow-hook-completion', object: 'chat.completion', created: 0, model: 'gpt-4o-mini',
              choices: [{ index: 0, message: { role: 'assistant', content: 'Answer: resolved' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            });
          },
        },
      });
      const childDefaults = { ...child };
      const reusableChild = ax('question:string -> answer:string', childDefaults);
      const makeFlow = (withChild: boolean, defaults = {}) => flow<{ question: string }>(defaults)
        .node('answer', withChild ? reusableChild : ax('question:string -> answer:string'))
        .execute('answer', (state) => ({ question: state.question }))
        .returns((state) => ({ answer: state.answerResult.answer }));
      const winners: string[] = [];
      try {
        Object.assign(axGlobals, global);
        const rows = [
          { winner: 'forward', program: makeFlow(true, factory), model: transport(service), overrides: forward },
          { winner: 'factory', program: makeFlow(true, factory), model: transport(service), overrides: {} },
          { winner: 'child', program: makeFlow(true), model: transport(service), overrides: {} },
          { winner: 'service', program: makeFlow(false), model: transport(service), overrides: {} },
          { winner: 'global', program: makeFlow(false), model: transport(), overrides: {} },
        ];
        for (const row of rows) {
          const before = calls.length;
          const result = await row.program.forward(row.model, { question: row.winner }, {
            ...options(ctx), stream: false, ...row.overrides,
          });
          assert.deepEqual(result, { answer: 'resolved' });
          const observed = calls.slice(before);
          assert.deepEqual(observed.filter((call) => call.endsWith(':limiter')), [`${row.winner}:limiter`]);
          assert.ok(observed.includes(`${row.winner}:tracer`));
          assert.ok(observed.includes(`${row.winner}:meter`));
          winners.push(row.winner);
        }
        assert.deepEqual(childDefaults, child, 'Flow propagation must not rewrite caller-owned child defaults');
        const beforeStandalone = calls.length;
        assert.deepEqual(await reusableChild.forward(transport(service), { question: 'Standalone child' }, {
          ...options(ctx), stream: false,
        }), { answer: 'resolved' });
        assert.deepEqual(calls.slice(beforeStandalone).filter((call) => call.endsWith(':limiter')), ['child:limiter']);

        const snapshot = hooks('snapshot');
        const replacement = hooks('replacement');
        Object.assign(axGlobals, snapshot);
        // A static-options service exposes the hooks Ax actually resolves at the
        // node boundary; it does not implement hook selection or a limiter.
        let snapshotNodes = 0;
        const boundary = new AxMockAIService<string>({
          features: { structuredOutputs: false },
          chatResponse: async (_request, resolved) => {
            snapshotNodes++;
            assert.equal(resolved?.rateLimiter, snapshot.rateLimiter);
            assert.equal(resolved?.tracer, snapshot.tracer);
            assert.equal(resolved?.meter, snapshot.meter);
            return reply('Answer: snapshot retained');
          },
        });
        const snapshotFlow = flow<{ question: string }>()
          .node('answer', 'question:string -> answer:string')
          .map((state) => { Object.assign(axGlobals, replacement); return state; })
          .execute('answer', (state) => ({ question: state.question }))
          .returns((state) => ({ answer: state.answerResult.answer }));
        const beforeSnapshot = calls.length;
        assert.deepEqual(await snapshotFlow.forward(boundary, { question: 'Snapshot before map' }, options(ctx)),
          { answer: 'snapshot retained' });
        assert.equal(snapshotNodes, 1);
        assert.ok(!calls.slice(beforeSnapshot).some((call) => call.startsWith('replacement:')));

        const denied = new Error('Owned limiter denied this request');
        const beforeDenied = httpCalls;
        await assert.rejects(makeFlow(false).forward(transport(service), { question: 'Must not reach transport' }, {
          ...options(ctx), stream: false,
          rateLimiter: async () => { throw denied; },
          tracer: forward.tracer, meter: forward.meter,
        }), (error: unknown) => error instanceof Error && error.message.includes(denied.message));
        assert.equal(httpCalls, beforeDenied, 'Limiter errors must propagate before model transport');
      } finally {
        Object.assign(axGlobals, saved);
      }
      assert.equal(axGlobals.rateLimiter, saved.rateLimiter);
      assert.equal(axGlobals.tracer, saved.tracer);
      assert.equal(axGlobals.meter, saved.meter);
      const recovered = await makeFlow(false, forward).forward(transport(service), { question: 'Subsequent isolated run' }, {
        ...options(ctx), stream: false,
      });
      assert.deepEqual(recovered, { answer: 'resolved' });
      return { winners, httpCalls, recovered,
        boundary: 'Real OpenAI adapter with owned fetch-only model I/O proves limiter execution and telemetry fail-open. Global snapshot identity is observed at a static-options model boundary; this does not promise freezing a custom service’s own live getOptions implementation.' };
    },
  },
  {
    id: '16-flow/event-continuation',
    title: 'Wake and resume a real Flow with signature-valid inputs and node-owned event correlation',
    features: ['flow', 'eventTarget', 'eventInput', 'eventContext', 'registerContinuation', 'wake', 'resume'],
    modes: ['offline'],
    async run(ctx) {
      const store = new AxInMemoryEventStore();
      const contexts: AxEventContext[] = [];
      const phases: string[] = [];
      const inspectOwner = fn('inspectOwner').description('Check owned event provenance and register a local wait')
        .arg('requestId', f.string()).arg('phase', f.string()).arg('tenant', f.string())
        .handler(async ({ requestId, phase, tenant }, extra) => {
          const context = extra?.eventContext;
          assert.ok(context, 'Real Flow must propagate eventContext through its Gen node to the owned tool');
          assert.equal(context.targetId, 'flow-approval');
          assert.equal(context.identity.tenantId, 'tenant-flow');
          assert.equal(context.identity.accountId, 'account-flow');
          assert.equal(context.trust, 'authenticated');
          assert.equal(tenant, context.identity.tenantId);
          assert.equal(requestId, 'approval-flow-16');
          assert.equal(context.ingress.event.id, phase === 'wake' ? 'flow-wake' : 'flow-resume');
          if (phase === 'wake') {
            assert.equal(context.continuation, undefined);
            context.registerContinuation({
              correlation: [{ kind: 'flow-approval', value: requestId }],
              metadata: { requestId }, expiresAt: Date.now() + 60_000,
            });
          } else {
            assert.equal(phase, 'resume');
            assert.ok(context.continuation);
            assert.deepEqual(context.continuation.correlation, [{ kind: 'flow-approval', value: requestId }]);
            assert.equal(context.continuation.metadata?.requestId, requestId);
          }
          contexts.push(context);
          phases.push(phase);
          return phase === 'wake' ? 'waiting for owned approval' : 'owned approval consumed';
        }).build();
      const workflow = flow<{ requestId: string; phase: string; tenant: string }>()
        .node('approval', ax('requestId:string, phase:string, tenant:string -> receiptText:string', { functions: [inspectOwner] }))
        .execute('approval', (state) => ({ requestId: state.requestId, phase: state.phase, tenant: state.tenant }))
        .returns((state) => ({ receiptText: state.approvalResult.receiptText }));
      assert.deepEqual(workflow.getSignature().getInputFields().map((field) => field.name).sort(),
        ['phase', 'requestId', 'tenant']);
      let modelCalls = 0;
      const model = scriptedAI((request, index) => {
        modelCalls++;
        assert.ok(index < 4, 'Only one wake and one resume may invoke the Flow node');
        const phase = index < 2 ? 'wake' : 'resume';
        if (index % 2 === 0) {
          const prompt = JSON.stringify(request.chatPrompt);
          assert.ok(prompt.includes('approval-flow-16') && prompt.includes('tenant-flow') && prompt.includes(phase));
          return { results: [{ index: 0, functionCalls: [{
            id: `flow-${phase}-owner`, type: 'function',
            function: { name: 'inspectOwner', params: { requestId: 'approval-flow-16', phase, tenant: 'tenant-flow' } },
          }], finishReason: 'function_call' }] };
        }
        assert.ok(request.chatPrompt.some((message) => message.role === 'function'
          && message.result.includes(phase === 'wake' ? 'waiting for owned approval' : 'owned approval consumed')));
        return reply(`Receipt Text: ${phase === 'wake' ? 'waiting' : 'approved'}`);
      });
      const target = eventTarget('flow-approval').program(workflow).ai(model).forwardOptions(options(ctx))
        .wakeInput(eventInput<{ requestId: string; phase: string; tenant: string }>()
          .field('requestId', eventPath.data('requestId')).field('phase', eventPath.constant('wake'))
          .field('tenant', eventPath.identity('tenantId')))
        .resumeInput(eventInput<{ requestId: string; phase: string; tenant: string }>()
          .field('requestId', eventPath.continuation('requestId')).field('phase', eventPath.constant('resume'))
          .field('tenant', eventPath.identity('tenantId'))).build();
      const runtime = eventRuntime({ store, workerConcurrency: 1, maxAttempts: 1, routes: [
        eventRoute('flow-start').types('flow.requested').authenticated().instanceKey(eventPath.subject()).wake(target).build(),
        eventRoute('flow-approved').types('flow.approved').authenticated()
          .correlate('flow-approval', eventPath.data('requestId')).resume(target).build(),
      ] });
      const ingress = (id: string, type: string): AxEventIngress => ({
        event: { specversion: '1.0', id, type, source: 'urn:example:flow-16', subject: 'approval-flow-16',
          data: { requestId: 'approval-flow-16' } },
        identity: { tenantId: 'tenant-flow', accountId: 'account-flow' }, trust: 'authenticated',
      });
      try {
        await runtime.start();
        const wake = await runtime.publish(ingress('flow-wake', 'flow.requested'), ctx.signal);
        await runtime.waitForIdle();
        const paused = await store.getDelivery(wake.deliveryIds[0]!);
        assert.equal(paused?.status, 'waiting_event');
        assert.ok(paused.runId);
        assert.equal(contexts[0]?.runId, paused.runId);
        const continuation = await store.findContinuation(paused.identityScope,
          { kind: 'flow-approval', value: 'approval-flow-16' }, Date.now());
        assert.ok(continuation);
        const completion = ingress('flow-resume', 'flow.approved');
        const resumed = await runtime.publish(completion, ctx.signal);
        await runtime.waitForIdle();
        const delivery = await store.getDelivery(resumed.deliveryIds[0]!);
        assert.equal(delivery?.status, 'succeeded');
        assert.ok(delivery.runId);
        const run = await runtime.getRun(delivery.runId);
        assert.equal(run?.instanceKey, continuation.instanceKey);
        assert.deepEqual(run?.output, { receiptText: 'approved' });
        assert.equal(contexts[1]?.runId, delivery.runId);
        assert.equal(contexts[1]?.continuation?.id, continuation.id);
        assert.equal((await runtime.publish(completion, ctx.signal)).duplicate, true);
        const replay = await runtime.publish(ingress('flow-replay', 'flow.approved'), ctx.signal);
        await runtime.waitForIdle();
        assert.equal((await store.getDelivery(replay.deliveryIds[0]!))?.status, 'dead_lettered');
        assert.deepEqual(phases, ['wake', 'resume']);
        assert.equal(modelCalls, 4);
        return { phases, modelCalls, output: run?.output,
          boundary: 'Real event runtime → Flow → Gen → owned host tool; volatile identity-scoped continuation consumption, not webhook authentication or crash-durable exactly-once delivery.' };
      } finally {
        await runtime.close({ drain: false });
      }
    },
  },
  {
    id: '16-flow/session-cancel-pending',
    title: 'Cancel two parallel controlled nodes while both owned background host tools are pending',
    features: ['flow', 'parallel', 'runControl', 'asyncTools', 'pending-tools', 'cancellation', 'session-cleanup'],
    modes: ['offline'],
    async run(ctx) {
      const control = runControl();
      const bothStarted = Promise.withResolvers<void>();
      const events: AxRunControlEvent[] = [];
      const unsubscribe = control.onEvent((event) => events.push(event));
      const records = ['root/left', 'root/right'].map((path) => ({
        path, started: 0, rejected: 0, accepted: 0, closed: 0, submissions: 0,
        barrier: Promise.withResolvers<string>(), closeBarrier: Promise.withResolvers<void>(),
      }));
      const hostWork: Promise<unknown>[] = [];
      let started = 0;
      let joins = 0;
      const waitOwned = fn('waitOwned').description('Wait on an owned cancellable read barrier')
        .arg('path', f.string()).execution('background')
        .handler(async ({ path }, extra) => {
          const record = records.find((entry) => entry.path === path);
          assert.ok(record);
          assert.ok(extra);
          assert.equal(extra.control, control);
          assert.equal(extra.executionPath, `${path}/waitOwned`);
          const signal = extra.abortSignal;
          assert.ok(signal);
          signal.throwIfAborted();
          const abort = () => record.barrier.reject(signal.reason);
          signal.addEventListener('abort', abort, { once: true });
          record.started++;
          const work = (async () => {
            try {
              const value = await record.barrier.promise;
              record.accepted++;
              return value;
            } catch (error) {
              record.rejected++;
              throw error;
            } finally {
              signal.removeEventListener('abort', abort);
            }
          })();
          hostWork.push(work);
          if (++started === 2) bothStarted.resolve();
          return work;
        }).build();
      class PendingSessionFixture extends AxMockAIService<string> {
        constructor() {
          super({ name: 'flow-pending-session-model-io', features: { functions: true },
            chatResponse: async () => { throw new Error('Controlled nodes must use actual SDK session orchestration'); } });
        }
        override getFeatures() { return { ...super.getFeatures(), asyncTools: true }; }
        async openChatSession(
          _request: Readonly<AxChatRequest<unknown>>, serviceOptions?: Readonly<AxAIServiceOptions>,
        ): Promise<AxChatSession> {
          const record = records.find((entry) => entry.path === serviceOptions?.executionPath);
          assert.ok(record);
          assert.equal(record.closed, 0);
          const call = { id: `${record.path}/pending`, type: 'function' as const,
            function: { name: 'waitOwned', params: { path: record.path } } };
          const response: AxChatResponse = { results: [{ index: 0, functionCalls: [call], finishReason: 'function_call' }] };
          return {
            model: 'owned-pending-model-io', signal: serviceOptions?.abortSignal,
            async *events(): AsyncIterable<AxChatSessionEvent> {
              yield { type: 'tool.call', responseId: record.path, call };
              yield { type: 'response.completed', responseId: record.path, response };
              throw new Error('A pending cancelled node must not request another model response');
            },
            async submitToolResults() { record.submissions++; throw new Error('Cancelled host results must not be accepted'); },
            async continue() { throw new Error('Cancelled node must not continue'); },
            async steer() { return 'next-response'; },
            async setThinkingTokenBudget() { return 'next-response'; },
            close() {
              if (record.closed) return;
              record.closed++;
              record.closeBarrier.resolve();
            },
          };
        }
      }
      const workflow = flow<{ question: string }>({ batchSize: 2 })
        .node('left', ax('question:string -> answer:string', { functions: [waitOwned] }))
        .node('right', ax('question:string -> answer:string', { functions: [waitOwned] }))
        .parallel([
          (sub) => sub.execute('left', (state) => ({ question: state.question })),
          (sub) => sub.execute('right', (state) => ({ question: state.question })),
        ])
        .merge('joined', () => { joins++; return 'Unexpected accepted node results'; })
        .returns((state) => ({ answer: state.joined }));
      let request: Promise<unknown> | undefined;
      const abortBarrier = () => bothStarted.reject(ctx.signal.reason);
      ctx.signal.addEventListener('abort', abortBarrier, { once: true });
      try {
        ctx.signal.throwIfAborted();
        request = workflow.forward(new PendingSessionFixture(), { question: 'Read both owned pending sources' }, {
          ...options(ctx), control,
        });
        // Observe rejection before cancellation; the race exposes early failure
        // instead of waiting forever for a start signal from a failed node.
        const rejected = assert.rejects(request, /aborted|abort/i);
        void rejected.catch(() => {}); // The start race below still exposes any early failure.
        await Promise.race([bothStarted.promise, request.then(
          () => { throw new Error('Flow accepted output before both host barriers were released'); },
          (error: unknown) => { throw error; },
        )]);
        assert.deepEqual(records.map(({ started, accepted }) => [started, accepted]), [[1, 0], [1, 0]]);
        control.abort();
        await rejected;
        await Promise.all(hostWork.map((work) => assert.rejects(work, /aborted|abort/i)));
        await Promise.all(records.map((record) => record.closeBarrier.promise));
        assert.equal(joins, 0);
        assert.deepEqual(records.map(({ rejected, accepted, submissions, closed }) =>
          [rejected, accepted, submissions, closed]), [[1, 0, 0, 1], [1, 0, 0, 1]]);
        assert.equal(events.filter((event) => event.type === 'completed'
          && (event.path === 'root/left' || event.path === 'root/right')).length, 0);
        assert.equal(events.filter((event) => event.type === 'aborted' && event.path === 'root').length, 1);
        return { sessions: records.map(({ path, started, rejected, accepted, submissions, closed }) =>
          ({ path, started, rejected, accepted, submissions, closed })), joins,
          boundary: 'SDK owns parallel node/session orchestration and abort propagation. Only model-session I/O and cooperative host read barriers are scripted; cancellation does not roll back external effects.' };
      } finally {
        control.abort();
        for (const record of records) if (record.started) record.barrier.reject(control.signal.reason);
        await Promise.allSettled([...(request ? [request] : []), ...hostWork]);
        await Promise.all(records.filter((record) => record.started).map((record) => record.closeBarrier.promise));
        ctx.signal.removeEventListener('abort', abortBarrier);
        unsubscribe();
      }
    },
  },
];

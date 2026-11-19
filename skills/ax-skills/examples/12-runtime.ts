import assert from 'node:assert/strict';
import { agent, AxJSRuntime, AxJSRuntimePermission, f, fn, type AxChatResponse } from '@ax-llm/ax';
import { options, scriptedAI, type Example } from './support.js';

// Scripted model code is a deterministic fixture, not a claim of model quality.
// Ax still parses responses, executes its real worker runtime, and owns stage/state transitions.
const code = (javascriptCode: string): AxChatResponse => ({ results: [{ index: 0, content: JSON.stringify({ javascriptCode }), finishReason: 'stop' }] });
const answer = (text: string): AxChatResponse => ({ results: [{ index: 0, content: `Answer: ${text}`, finishReason: 'stop' }] });

export const examples: readonly Example[] = [
  {
    id: '12-runtime/persistent-session',
    title: 'Keep computed variables in one worker session; close it explicitly',
    features: ['AxJSRuntime', 'createSession', 'execute', 'inspectGlobals', 'snapshotGlobals', 'patchGlobals', 'session lifetime'],
    modes: ['offline'],
    async run(ctx) {
      const runtime = new AxJSRuntime();
      const session = runtime.createSession({ rows: [4, 7, 11] });
      try {
        await session.execute('const subtotal = rows.reduce((a, b) => a + b, 0); console.log(subtotal)', { signal: ctx.signal });
        const reused = await session.execute('console.log(subtotal * 2)', { signal: ctx.signal });
        assert.match(String(reused), /44/);
        assert.ok(session.inspectGlobals && session.snapshotGlobals);
        const visible = await session.inspectGlobals({ signal: ctx.signal });
        assert.match(visible, /subtotal/);
        const snapshot = await session.snapshotGlobals({ signal: ctx.signal });
        assert.equal(snapshot.bindings.subtotal, 22);
        const restored = runtime.createSession();
        try {
          await restored.patchGlobals(snapshot.bindings, { signal: ctx.signal });
          assert.match(String(await restored.execute('console.log(subtotal + 1)', { signal: ctx.signal })), /23/);
        } finally { restored.close(); }
        return { subtotal: snapshot.bindings.subtotal, reused: String(reused), restored: 23, scope: 'one session; explicit serializable snapshot for another' };
      } finally { session.close(); }
    },
  },
  {
    id: '12-runtime/permission-and-test-boundaries',
    title: 'Use agent.test for deterministic code and least-privilege runtime inspection',
    features: ['agent.test', 'contextFields aliases', 'fresh test sessions', 'runtime permissions', 'TIMING', 'blocked network/import'],
    modes: ['offline'],
    async run(ctx) {
      const harness = agent('document:string, task:string -> answer:string', { contextFields: ['document'], runtime: new AxJSRuntime() });
      const result = await harness.test('const selected = inputs.document.split("\\n").filter(line => line.includes("paid")); console.log(selected)', { document: 'A paid 12\nB pending 8\nC paid 5' }, { abortSignal: ctx.signal });
      assert.equal(typeof result, 'string');
      assert.match(String(result), /A paid 12/);
      assert.doesNotMatch(String(result), /pending/);
      await assert.rejects(() => harness.test('console.log(selected)', { document: '' }, { abortSignal: ctx.signal }), /selected|defined/);
      const denied = await harness.test('console.log({ fetch: typeof fetch, process: typeof process, shadowRealm: typeof ShadowRealm })', { document: '' }, { abortSignal: ctx.signal });
      assert.match(String(denied), /undefined/);
      // Intentional module-loading boundary test: a host static import cannot exercise the sandbox's import gate.
      await assert.rejects(() => harness.test('await import("node:fs")', { document: '' }, { abortSignal: ctx.signal }), /import|blocked|allow/i);
      // Grant only the capability needed by this task; no network or filesystem side effects.
      const timed = agent('task:string -> answer:string', { runtime: new AxJSRuntime({ permissions: [AxJSRuntimePermission.TIMING] }) });
      assert.match(String(await timed.test('console.log(typeof performance.now() === "number")', undefined, { abortSignal: ctx.signal })), /true/);
      return { selected: String(result), denied: String(denied), timingEnabled: true, caveat: 'defense in depth, not a container; host callbacks remain privileged' };
    },
  },
  {
    id: '12-runtime/multi-turn-context',
    title: 'Filter runtime-only context once, reuse the value on later actor turns',
    features: ['normal forward', 'contextFields', 'keepInPromptChars', 'multi-turn persistence', 'autoUpgrade', 'field_auto_promoted'],
    modes: ['offline', 'live'],
    async run(ctx) {
      const events: string[] = [];
      const outputs: string[] = [];
      // Names are requirements of this pedagogical task, not a general agent API:
      // ordinary business tasks must not assume model-chosen runtime binding names.
      const executorRequest = 'Reuse the existing top-level paidRows array without reading or filtering the ledger again. Declare top-level const total by summing its amounts, console.log(total), and end that turn. On the following turn call final("Report paid ledger total", { total }). Keep both named bindings available for caller inspection.';
      const task = [
        'Report the numeric paid total AND demonstrate persistence using these required named runtime artifacts.',
        'Distiller: on your first turn declare top-level const paidRows by filtering inputs.ledger for lines starting with PAID, console.log(paidRows.length), and end the turn. Do not calculate the sum.',
        `Distiller: on your next turn hand off with final(${JSON.stringify(executorRequest)}, { paidRows }). The executor request must preserve these artifact and turn requirements.`,
        `Executor: ${executorRequest}`,
        'This exercise requires the exact top-level names paidRows and total so the caller can inspect the retained artifacts. Do not substitute other names, put them inside a block/function, recreate paidRows, or answer directly from the original ledger.',
      ].join('\n');
      const worker = agent('task:string, ledger:string, notes:string -> answer:string', {
        runtime: new AxJSRuntime(), maxTurns: 4, directResponse: 'off',
        contextFields: [{ field: 'ledger', keepInPromptChars: 35 }],
        contextPolicy: { preset: 'full' },
        onContextEvent: e => { if (e.kind === 'field_auto_promoted') events.push(e.fieldName); },
        // The top-level actor callback belongs to the executor, not the distiller.
        actorTurnCallback: t => { if (t.stage === 'executor') outputs.push(t.output); },
        contextOptions: { description: 'Read ledger from inputs. Create paidRows by filtering PAID lines and log its length. On the next turn call final with a self-contained request to sum the retained paidRows and evidence { paidRows }. Do not recreate paidRows.' },
        executorOptions: { description: 'Reuse the existing paidRows from the shared runtime. Compute total from paidRows and log it. On the next turn call final with the observed total for the responder.' },
      });
      const model = ctx.mode === 'live' ? ctx.ai : scriptedAI([
        code('const paidRows = inputs.ledger.split("\\n").filter(line => line.startsWith("PAID")); console.log(paidRows.length)'),
        code(`await final(${JSON.stringify(executorRequest)}, { paidRows })`),
        code('const total = paidRows.reduce((sum, line) => sum + Number(line.split(" ")[1]), 0); console.log(total)'),
        code('await final("Report paid ledger total", { total })'), answer('17'),
      ], { structuredOutputs: true });
      const result = await worker.forward(model, { task, ledger: `PAID 12\n${'PENDING 8\n'.repeat(50)}PAID 5`, notes: 'Unrelated archival note. '.repeat(500) }, options(ctx));
      assert.match(result.answer, /17/);
      assert.ok(events.includes('notes'));
      const state = worker.getState();
      assert.ok(state);
      assert.equal(state.runtimeBindings.total, 17);
      assert.deepEqual(state.runtimeBindings.paidRows, ['PAID 12', 'PAID 5']);
      assert.ok(outputs.some(out => out.includes('17')));
      return { answer: result.answer, retainedRows: state.runtimeBindings.paidRows, retainedTotal: state.runtimeBindings.total, autoPromoted: events, executorOutputs: outputs, proof: ctx.mode === 'offline' ? 'scripted decisions; real distiller-to-executor shared values, executor callback, promotion and state export; forward owns worker cleanup' : 'live model follows an explicit named-artifact persistence exercise; exported values and executor output are checked, not inferred from the answer' };
    },
  },
  {
    id: '12-runtime/threshold-context-selection',
    title: 'Keep a short document inline but read a longer document from runtime-only context',
    features: ['contextFields promptMaxChars', 'contextMetadata', 'runtime-only full input', 'concrete context selection'],
    modes: ['offline'],
    async run(ctx) {
      const results: { size: number; inline: boolean; answer: string }[] = [];
      for (const document of ['prefix:short-tail', `${'archival '.repeat(200)}long-tail`]) {
        let prompt = '';
        const worker = agent('task:string, document:string -> answer:string', {
          runtime: new AxJSRuntime(), maxTurns: 2,
          contextFields: [{ field: 'document', promptMaxChars: 40 }],
        });
        const responses = [
          code('await respond("Report the final document token", { tail: inputs.document.split(/[: ]/).at(-1) })'),
          answer(document.endsWith('short-tail') ? 'short-tail' : 'long-tail'),
        ];
        const model = scriptedAI((request, index) => {
          if (index === 0) prompt = JSON.stringify(request.chatPrompt);
          const response = responses[index]; assert.ok(response); return response;
        }, { structuredOutputs: true });
        const result = await worker.forward(model, { task: 'Read the final token from the document.', document }, options(ctx));
        const inline = prompt.includes(document);
        assert.equal(inline, document.length <= 40);
        assert.match(result.answer, /tail/);
        assert.match(prompt, /Context Metadata/);
        results.push({ size: document.length, inline, answer: result.answer });
      }
      return { results, selection: 'small document inline; large document runtime-only; threshold does not discard the original' };
    },
  },
  {
    id: '12-runtime/semantic-fanout-budget',
    title: 'Independent semantic batch, dependent merge, and a shared query budget',
    features: ['llmQuery string/object/batch', 'explicit narrowed context', 'maxSubAgentCalls', 'maxBatchedLlmQueryConcurrency', 'recursionOptions.ai', 'error boundary'],
    modes: ['offline'],
    async run(ctx) {
      const requests: string[] = [];
      const semantic = scriptedAI((request, index) => {
        requests.push(JSON.stringify(request.chatPrompt));
        const content = ['Urgent: customer login unavailable', 'Owner: identity team', 'Identity team should restore login urgently'][index];
        assert.ok(content, 'finite semantic fixture exhausted');
        return answer(content);
      });
      const harness = agent('task:string -> answer:string', {
        runtime: new AxJSRuntime(), maxSubAgentCalls: 3, maxBatchedLlmQueryConcurrency: 1,
        recursionOptions: { ai: semantic, modelConfig: { maxTokens: 100 }, maxRetries: 1 },
      });
      const result = await harness.test(`
const narrowed = { incident: 'Customer login unavailable', owner: 'identity team' };
const reviews = await llmQuery([
  { query: 'Assess urgency', context: { incident: narrowed.incident } },
  { query: 'Identify owner', context: { owner: narrowed.owner } }
]);
if (reviews.some(value => value.startsWith('[ERROR]'))) throw new Error(reviews.join(';'));
const merged = await llmQuery('Merge urgency and owner', { reviews });
if (merged.startsWith('[ERROR]')) throw new Error(merged);
const overBudget = await llmQuery({ query: 'This fourth call must not reach the model', context: {} });
console.log({ reviews, merged, overBudget });`, undefined, { ai: scriptedAI(() => { throw new Error('parent AI must not receive semantic requests'); }), abortSignal: ctx.signal });
      assert.equal(requests.length, 3);
      assert.match(String(result), /Identity team/);
      assert.match(String(result), /\[ERROR\].*(budget|limit|calls)/i);
      assert.doesNotMatch(requests[0] ?? '', /identity team/);
      assert.match(requests[2] ?? '', /Urgent: customer login unavailable/);
      return { calls: requests.length, output: String(result), capability: 'semantic AxGen only; no parent tools, discovery, inputs or runtime variables implicitly inherited' };
    },
  },
  {
    id: '12-runtime/regex-completion-boundaries',
    title: 'Recognize real completion after a regex without letting regex lookalikes bypass discovery policy',
    features: ['regex masking', 'normal forward', 'completion policy', 'discovery policy', 'host effect ledger', 'retained runtime state'],
    modes: ['offline'],
    async run(ctx) {
      const results: { scenario: string; answer: string; reads: number; errors: boolean[] }[] = [];
      for (const scenario of ['clean-label', 'fake-completion'] as const) {
        const reads: number[] = [], errors: boolean[] = [];
        const discoveries: string[] = [];
        const worker = agent('task:string -> answer:string', {
          runtime: new AxJSRuntime(), directResponse: 'off', maxTurns: 3,
          contextOptions: { model: 'fixture-distiller' },
          executorOptions: { model: 'fixture-executor' },
          responderOptions: { model: 'fixture-responder' },
          functions: [fn('read').namespace('billing').description('Read the in-memory invoice amount').returns(f.number()).handler(() => { reads.push(17); return 17; }).build()],
          onSkillsSearch: async queries => { discoveries.push(...queries); return []; },
          actorTurnCallback: turn => { errors.push(turn.isError); },
        });
        const expected = scenario === 'clean-label' ? 'INV42' : '17';
        const responses = scenario === 'clean-label' ? [
          code(`await final("Clean the invoice identifier", { label: "INV'\\\"/42" })`),
          code(String.raw`const cleanedId = inputs.distilledContext.label.replace(/['"\/]/g, ""); await final("Report the cleaned invoice identifier", { cleanedId })`),
          answer(expected),
        ] : [
          code('await final("Read the current invoice amount", {})'),
          code('const rejectedPattern = /final(x)/; await discover({ skills: ["invoice status"] }); await discover({ skills: ["invoice routing"] });'),
          code('const pattern = /final(x)/; const observedAmount = await billing.read({});'),
          code('await final("Report the observed invoice amount", { observedAmount })'),
          answer(expected),
        ];
        const stages = scenario === 'clean-label'
          ? ['fixture-distiller', 'fixture-executor', 'fixture-responder']
          : ['fixture-distiller', 'fixture-executor', 'fixture-executor', 'fixture-executor', 'fixture-responder'];
        let calls = 0;
        const model = scriptedAI((request, index) => {
          calls++;
          assert.equal(request.model, stages[index]);
          if (scenario === 'fake-completion' && index === 2) {
            assert.deepEqual(errors, [true], 'a regex lookalike must not hide repeated discovery from policy validation');
            assert.deepEqual(discoveries, [], 'policy rejection must happen before either discovery runs');
            assert.match(JSON.stringify(request.chatPrompt), /Batch tool\/skill discovery into one call/);
          }
          if (scenario === 'fake-completion' && index === 3) {
            assert.deepEqual(reads, [17], 'A non-final turn may read without console output');
            const prompt = JSON.stringify(request.chatPrompt);
            assert.match(prompt, /billing\.read: 17/);
            assert.match(prompt, /\[OBSERVATION\]/);
          }
          if (request.model === 'fixture-responder') assert.ok(JSON.stringify(request.chatPrompt).includes(expected), 'actual final evidence must reach synthesis');
          const response = responses[index]; assert.ok(response, 'finite regex fixture exhausted'); return response;
        }, { structuredOutputs: true });
        try {
          const result = await worker.forward(model, { task: scenario === 'clean-label' ? 'Remove quotes and slashes from the supplied invoice label.' : 'Read the current invoice amount.' }, options(ctx));
          assert.equal(result.answer, expected);
          assert.equal(calls, responses.length);
          const bindings = worker.getState()?.runtimeBindings;
          if (scenario === 'clean-label') {
            assert.equal(bindings?.cleanedId, 'INV42');
            assert.deepEqual(reads, []);
            assert.deepEqual(errors, [false]);
          } else {
            assert.equal(bindings?.observedAmount, 17);
            assert.deepEqual(reads, [17]);
            assert.deepEqual(errors, [true, false, false]);
          }
          results.push({ scenario, answer: result.answer, reads: reads.length, errors });
        } finally { worker.stop(); }
      }
      return { results, boundary: 'scripted decisions; regex lookalikes cannot exempt repeated discovery from policy, and an actual host observation is reusable without another read' };
    },
  },
  {
    id: '12-runtime/division-state-boundaries',
    title: 'Preserve invoice division and reuse the quotient on a later actor turn',
    features: ['division lexical boundaries', 'persistent runtime values', 'postfix update', 'property reads', 'normal forward'],
    modes: ['offline'],
    async run(ctx) {
      const rows = [
        { name: 'string', expression: '"24" / 3' },
        { name: 'template', expression: '`24` / 3' },
        { name: 'postfix', expression: 'units++ / 3' },
        { name: 'dot-keyword', expression: 'amounts.return / 3' },
        { name: 'optional-keyword', expression: 'amounts?.return / 3' },
      ];
      const results: { name: string; quotient: unknown; units: unknown; exportedUnits: unknown; exportMatchesLive: boolean }[] = [];
      for (const row of rows) {
        const errors: boolean[] = [];
        const worker = agent('task:string -> answer:string', {
          runtime: new AxJSRuntime(), directResponse: 'off', maxTurns: 3,
          contextOptions: { model: 'fixture-distiller' },
          executorOptions: { model: 'fixture-executor' },
          responderOptions: { model: 'fixture-responder' },
          actorTurnCallback: turn => { errors.push(turn.isError); },
        });
        const responses = [
          code('await final("Compute and retain the invoice quotient", { numerator: 24, divisor: 3 })'),
          code('const amounts = { return: inputs.distilledContext.numerator }; let units = amounts.return; console.log({ amounts, units })'),
          code(`const quotient = ${row.expression}; console.log(quotient)`),
          code('const reusedTotal = quotient * inputs.distilledContext.divisor; const observedUnits = units; await final("Report the invoice quotient", { quotient, reusedTotal, units: observedUnits })'),
          answer('8'),
        ];
        const stages = ['fixture-distiller', 'fixture-executor', 'fixture-executor', 'fixture-executor', 'fixture-responder'];
        let calls = 0;
        const model = scriptedAI((request, index) => {
          calls++; assert.equal(request.model, stages[index]);
          const response = responses[index]; assert.ok(response, 'finite division fixture exhausted'); return response;
        }, { structuredOutputs: true });
        try {
          const result = await worker.forward(model, { task: `Compute the invoice quotient with ${row.name} division and retain its reused total.` }, options(ctx));
          assert.equal(result.answer, '8'); assert.equal(calls, responses.length);
          assert.deepEqual(errors, [false, false, false]);
          const bindings = worker.getState()?.runtimeBindings;
          assert.deepEqual(bindings?.amounts, { return: 24 });
          assert.equal(bindings?.quotient, 8); assert.equal(bindings?.reusedTotal, 24);
          // A fresh binding captures the live worker value; the original mutable export can lag.
          const units = bindings?.observedUnits;
          assert.equal(units, row.name === 'postfix' ? 25 : 24);
          const exportedUnits = bindings?.units;
          results.push({ name: row.name, quotient: bindings?.quotient, units, exportedUnits, exportMatchesLive: exportedUnits === units });
        } finally { worker.stop(); }
      }
      return { results, boundary: 'bounded literal/update/property division fixtures, not arbitrary grammar support; fresh retained arithmetic is primary evidence, mutable exports are diagnostic only, not restoration proof' };
    },
  },
];

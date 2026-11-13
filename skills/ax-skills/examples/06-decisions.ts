import assert from 'node:assert/strict';
import {
  ai, ax, f, typesafe, openaiDecisions, googleGeminiDecisions, AxDecisionRefusalError,
  type AxAITypesafeQuestions,
  type AxAIOpenAIDecisionsRequest,
  type AxAIOpenAIDecisionsResponse,
  type AxAIGoogleGeminiDecisionsQuestions,
  type AxAIGoogleGeminiDecisionsRequest,
  type AxAIGoogleGeminiDecisionsResponse,
} from '@ax-llm/ax';
import { options, scriptedAI, type Example, type ExampleContext } from './support.js';

const ticket = 'Checkout fails for every customer; payments cannot complete.';
const levels = ['Minor inconvenience', 'Feature impaired', 'Core task blocked'] as const;

// Real SDK transport fixture: deterministic server answers, not measured Jev quality.
// The public options.fetch seam runs serialization, authentication, validation and decoding.
function decisionFixture(answers: Record<string, unknown>, inspect?: (body: string) => void) {
  let calls = 0;
  const model = ai({
    name: 'typesafe', apiKey: 'isolated-fixture-not-a-secret', trueThreshold: 0.9,
    options: {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        assert.equal(new URL(request.url).pathname, '/v1/systemone');
        assert.equal(request.headers.get('authorization'), 'Bearer isolated-fixture-not-a-secret');
        const body = await request.text();
        assert(!body.includes('trueThreshold')); // Local policy never goes on the wire.
        inspect?.(body);
        calls++;
        return Response.json({ model: 'jev-fixture', answers, usage: { input_tokens: 31, output_tokens: 7 } });
      },
    },
  });
  return { model, calls: () => calls };
}

// Generative controls (maxTokens etc.) are not supported by decision providers.
function decisionOptions(ctx: ExampleContext) {
  return { ...options(ctx), modelConfig: {} };
}

// Synthetic disagreement intentionally tests transport preservation, not live Jev semantics:
// TypeSafe documents Choice as argmax and Score as the probability-weighted rubric index.
const evidenceAnswers = {
  urgent: { type: 'noul', noul: 0.9 },
  team: {
    type: 'choice', choice: 'engineering',
    probabilities: { support: 0.6, billing: 0.1, engineering: 0.3 }, confidence: 0.62,
  },
  severity: {
    type: 'score', score: 1.8, probabilities: { '0': 0.1, '1': 0.4, '2': 0.5 },
    legend: { '0': levels[0], '1': levels[1], '2': levels[2] }, confidence: 0.75,
  },
};

export const examples: readonly Example[] = [
  {
    id: '06-decisions/threshold-ownership',
    title: 'Separate provider scalar conversion from field evidence thresholds',
    features: ['typesafe adapter', 'scalar boolean', 'boolean evidence', 'local thresholds', 'one batch'],
    modes: ['offline'],
    async run(ctx) {
      const fixture = decisionFixture({
        scalar: { type: 'noul', noul: 0.6 },
        defaultEvidence: { type: 'noul', noul: 0.6 },
        explicitEvidence: { type: 'noul', noul: 0.6 },
      }, (body) => {
        const request = JSON.parse(body) as { questions: Record<string, { type: string }> };
        assert(!Object.hasOwn(request, 'trueThreshold'));
        assert(Object.values(request.questions).every((question) => !Object.hasOwn(question, 'threshold')));
        assert.deepEqual(Object.keys(request.questions).sort(), ['defaultEvidence', 'explicitEvidence', 'scalar']);
        assert(Object.values(request.questions).every((question) => question.type === 'noul'));
      });
      const program = ax(f().input('ticket', f.string())
        .output('scalar', f.boolean('Core task blocked?'))
        .output('defaultEvidence', f.boolean('Core task blocked?').withEvidence())
        .output('explicitEvidence', f.boolean('Core task blocked?').withEvidence({ threshold: 0.9 }))
        .build());
      const result = await program.forward(fixture.model, { ticket }, decisionOptions(ctx));
      assert.equal(result.scalar, false); // Provider trueThreshold is 0.9.
      assert.equal(result.defaultEvidence.value, true);
      assert.equal(result.defaultEvidence.threshold, 0.5);
      assert.equal(result.explicitEvidence.value, false);
      assert.equal(result.explicitEvidence.threshold, 0.9);
      assert.equal(result.defaultEvidence.probability, 0.6);
      assert.equal(result.explicitEvidence.probability, 0.6);
      assert.equal(fixture.calls(), 1);
      return { result, batches: fixture.calls(),
        proof: 'Injected HTTP answers exercise real SDK conversion. Threshold ownership, not inference quality or calibration.' };
    },
  },
  {
    id: '06-decisions/applicability-gate',
    title: 'Gate a native Choice with a separate applicability judgment',
    features: ['native Choice', 'companion Noul', 'ordered host policy', 'uncertain review'],
    modes: ['offline'],
    async run(ctx) {
      const questions = {
        applicable: { type: 'noul', instructions: 'Does this message request a refund or report a duplicate charge?' },
        category: {
          type: 'choice', instructions: 'Which of refund or duplicate charge best fits this message?',
          criteria: { refund: 'A refund request', duplicate: 'A duplicate charge' },
        },
      } as const satisfies AxAITypesafeQuestions;
      const fixtures = [
        { name: 'no', probability: 0.02, selectedProbability: 0.96, expected: 'general' },
        { name: 'yes', probability: 0.98, selectedProbability: 0.96, expected: 'refund' },
        { name: 'uncertain', probability: 0.5, selectedProbability: 0.96, expected: 'review' },
        { name: 'applicable-but-ambiguous', probability: 0.98, selectedProbability: 0.55, expected: 'review' },
      ] as const;
      const outcomes = [];
      for (const fixture of fixtures) {
        let calls = 0;
        // Only HTTP I/O is injected; native request validation and decoding are real.
        const client = typesafe({ apiKey: 'isolated-fixture-not-a-secret', options: {
          fetch: async (input, init) => {
            const request = new Request(input, init);
            assert.equal(new URL(request.url).pathname, '/v1/systemone');
            const body = await request.json() as { questions: unknown };
            assert.deepEqual(body.questions, questions);
            calls++;
            return Response.json({ model: 'jev-fixture', answers: {
              applicable: { type: 'noul', noul: fixture.probability },
              category: { type: 'choice', choice: 'refund', probabilities: { refund: fixture.selectedProbability, duplicate: 1 - fixture.selectedProbability }, confidence: 2 * fixture.selectedProbability - 1 },
            }, usage: { input_tokens: 20, output_tokens: 4 } });
          },
        } });
        const result = await client.systemOne({ state: { message: `Declared ${fixture.name} transport fixture` }, questions }, { abortSignal: ctx.signal });
        const p = result.answers.applicable.noul;
        const selectedProbability = result.answers.category.probabilities[result.answers.category.choice];
        // Applicability dominates Choice; even high applicability does not establish the label.
        const route = p <= 0.1 ? 'general'
          : p < 0.9 || selectedProbability < 0.9 ? 'review' : result.answers.category.choice;
        assert.equal(result.answers.category.choice, 'refund');
        assert.equal(selectedProbability, fixture.selectedProbability);
        assert.equal(p, fixture.probability);
        assert.equal(route, fixture.expected);
        assert.equal(calls, 1);
        outcomes.push({ fixture: fixture.name, answers: result.answers, route, batches: calls });
      }
      return { outcomes,
        proof: 'Four finite injected HTTP fixtures; real SDK native decoding and separate host applicability/selected-label thresholds, not inference or calibration. Questions have no sibling-answer dependencies.' };
    },
  },
  {
    id: '06-decisions/adapter-values',
    title: 'Own boolean policy and class meanings in a typed decision signature',
    features: ['typesafe adapter', 'value descriptions', 'trueThreshold', 'scalar boolean/class'],
    modes: ['offline', 'live'],
    async run(ctx) {
      const fixture = decisionFixture({ urgent: evidenceAnswers.urgent, team: evidenceAnswers.team }, (body) => {
        assert(body.includes('Customers cannot complete a core task'));
        assert(body.includes('Individual invoice or charge disputes'));
      });
      const triage = ax(`ticket:string ->
        urgent:boolean(true "Customers cannot complete a core task", false "Routine request or minor inconvenience") "Does this need immediate attention?",
        team:class "support, billing, engineering"(support "Product usage questions", billing "Individual invoice or charge disputes", engineering "Broken functionality or service outages") "Which team should investigate?"`);
      const result = await triage.forward(ctx.mode === 'live' ? ctx.decisions : fixture.model, { ticket }, decisionOptions(ctx));
      assert.equal(typeof result.urgent, 'boolean');
      assert(['support', 'billing', 'engineering'].includes(result.team));
      if (ctx.mode === 'offline') {
        assert.equal(result.urgent, true); // Equality at 0.9 is included.
        assert.equal(result.team, 'engineering'); // Synthetic disagreement tests transport preservation, not live Jev argmax.
        assert.equal(fixture.calls(), 1);
      }
      return { result, policy: 'Offline adapter trueThreshold=0.9; live policy belongs to ctx.decisions. Class has no automatic confidence cutoff.', proof: 'Contract and local conversion, not correctness or calibration.' };
    },
  },
  {
    id: '06-decisions/adapter-evidence',
    title: 'Retain native probabilities, continuous rubric score and provenance',
    features: ['boolean evidence', 'class evidence', 'score evidence', 'threshold', 'native provenance', 'diagnostics'],
    modes: ['offline', 'live'],
    async run(ctx) {
      const program = ax(f()
        .input('ticket', f.string())
        .output('urgent', f.boolean('Core task blocked?').withEvidence({ threshold: 0.9 }).describeValues({ true: 'Core task blocked', false: 'Routine request' }))
        .output('team', f.class(['support', 'billing', 'engineering']).withEvidence())
        .output('severity', f.score(levels).withEvidence())
        .build());
      const fixture = decisionFixture(evidenceAnswers);
      const result = await program.forward(ctx.mode === 'live' ? ctx.decisions : fixture.model, { ticket }, decisionOptions(ctx));
      assert.equal(result.urgent.value, result.urgent.probability >= 0.9);
      assert.equal(result.urgent.threshold, 0.9);
      assert(result.severity.value >= 0 && result.severity.value <= 2);
      assert.equal(result.team.provenance.source, 'native');
      assert.deepEqual(Object.keys(result.team.probabilities).sort(), ['billing', 'engineering', 'support']);
      if (ctx.mode === 'offline') {
        assert.equal(result.team.value, 'engineering');
        assert.equal(result.team.confidence, 0.62);
        assert.equal(result.severity.value, 1.8); // Synthetic transport fixture, not live Jev weighted-score semantics.
        assert.deepEqual(result.severity.probabilities, [0.1, 0.4, 0.5]);
      }
      return { result, usage: program.getUsage(), chatEntries: program.getChatLog().length, proof: 'Native fields preserved; distributions and confidence are not guarantees of correctness.' };
    },
  },
  {
    id: '06-decisions/openai-decisions-wire',
    title: 'Exercise the dedicated OpenAI Decisions adapter with synthetic wire evidence',
    features: ['openai-decisions', '/v1/decisions', 'predicate', 'choice', 'rubric score', 'native evidence', 'unsupported box'],
    modes: ['offline'],
    async run(ctx) {
      // Wire contract: installed ai/openai-decisions/{types,api,validate}.ts
      // (embedded in index.js.map). This is not the Typesafe /systemone profile.
      const wireResponse = {
        model: 'gpt-6-luna',
        answers: [
          { name: 'urgent', type: 'predicate', probability: 0.9 },
          { name: 'team', type: 'choice', choice: 'engineering', confidence: 0.62, probabilities: [
            { value: 'support', probability: 0.6 },
            { value: 'billing', probability: 0.1 },
            { value: 'engineering', probability: 0.3 },
          ] },
          { name: 'severity', type: 'score', score: 1.8, confidence: 0.75, probabilities: [
            // Deliberately unordered: the adapter restores rubric-index order.
            { value: 2, label: levels[2], probability: 0.5 },
            { value: 0, label: levels[0], probability: 0.1 },
            { value: 1, label: levels[1], probability: 0.4 },
          ] },
        ],
        usage: {
          input_tokens: 31, output_tokens: 7, total_tokens: 38,
          input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      } satisfies AxAIOpenAIDecisionsResponse;
      let calls = 0;
      const model = ai({
        name: 'openai-decisions', apiKey: 'fixture-only', trueThreshold: 0.9,
        safetyIdentifier: 'offline-ticket-fixture',
        options: {
          abortSignal: ctx.signal, timeout: 1_000, retry: { maxRetries: 0 },
          fetch: async (input, init) => {
            assert.equal(++calls, 1, 'Dedicated Decisions transport budget exhausted');
            const request = new Request(input, init);
            assert.equal(request.url, 'https://api.openai.com/v1/decisions');
            assert.equal(request.method, 'POST');
            assert.equal(request.headers.get('authorization'), 'Bearer fixture-only');
            const body = await request.json() as AxAIOpenAIDecisionsRequest;
            assert.equal(body.model, 'gpt-6-luna');
            assert.equal(body.safety_identifier, 'offline-ticket-fixture');
            assert.deepEqual(body.questions.map(({ name, type }) => ({ name, type })), [
              { name: 'urgent', type: 'predicate' }, { name: 'team', type: 'choice' }, { name: 'severity', type: 'score' },
            ]);
            const scoreQuestion = body.questions.find(({ name }) => name === 'severity');
            assert(scoreQuestion?.type === 'score');
            assert.deepEqual(scoreQuestion.levels.map(({ label }) => label), levels);
            assert(Array.isArray(body.input));
            assert.equal(body.input.length, 1);
            assert.equal(body.input[0]!.role, 'user');
            const content = body.input[0]!.content;
            assert(Array.isArray(content));
            assert(content.every((part) => part.type === 'input_text'));
            assert(content.some((part) => part.type === 'input_text' && part.text.includes(ticket)));
            return Response.json(wireResponse);
          },
        },
      });
      const program = ax(f().input('ticket', f.string())
        .output('urgent', f.boolean('Core task blocked?').withEvidence({ threshold: 0.9 })
          .describeValues({ true: 'Core task blocked', false: 'Routine request' }))
        .output('team', f.class(['support', 'billing', 'engineering'], 'Investigation owner').withEvidence()
          .describeValues({ support: 'Product usage questions', billing: 'Invoice disputes', engineering: 'Broken functionality' }))
        .output('severity', f.score(levels, 'Customer impact').withEvidence())
        .build());
      const forwardOptions = { ...decisionOptions(ctx), maxSteps: 1, maxRetries: 0 };
      const result = await program.forward(model, { ticket }, forwardOptions);
      assert.equal(result.urgent.value, true);
      assert.equal(result.urgent.probability, 0.9);
      assert.equal(result.urgent.threshold, 0.9);
      assert(!('confidence' in result.urgent)); // Predicate wire answers have no confidence.
      assert.equal(result.team.value, 'engineering'); // Native selection, not probability argmax.
      assert.deepEqual(result.team.probabilities, { support: 0.6, billing: 0.1, engineering: 0.3 });
      assert.equal(result.team.confidence, 0.62);
      assert.equal(result.severity.value, 1.8); // Preserve native score, not weighted mean 1.4.
      assert.deepEqual(result.severity.levels, levels);
      assert.deepEqual(result.severity.probabilities, [0.1, 0.4, 0.5]);
      assert.equal(result.severity.confidence, 0.75);
      for (const evidence of [result.urgent, result.team, result.severity]) {
        assert.deepEqual(evidence.provenance, { source: 'native', provider: 'OpenAI Decisions', model: 'gpt-6-luna' });
      }
      // Unlike Typesafe, this distinct native profile cannot produce Box outputs.
      const locate = ax('ticket:string -> target:box(evidence)');
      await assert.rejects(() => locate.forward(model, { ticket }, forwardOptions));
      assert.equal(calls, 1); // The unsupported output fails before a second transport call.
      return {
        result, calls, endpoint: '/v1/decisions', unsupported: 'box outputs rejected before transport',
        proof: 'Synthetic HTTP answers exercise actual SDK serialization and native decoding; no live inference, correctness, or calibration measurement.',
        limits: 'Flat required scalar decisions only; evidence thresholds are local field policy. No tools, generation controls, or token streaming.',
      };
    },
  },
  {
    id: '06-decisions/openai-native-ordered', title: 'Use native ordered questions, typed choice values, inline images and per-question refusals',
    features: ['openaiDecisions', 'ordered questions', 'boolean choice values', 'inline images', 'native refusal'], modes: ['offline'],
    async run(ctx) {
      const questions = [
        { name: 'kind', type: 'choice', instructions: 'Choose the typed application result.',
          choices: [{ value: true, description: 'Approved' }, { value: 'true', description: 'Legacy string label' }, { value: false, description: 'Rejected' }] },
        { name: 'attachment', type: 'predicate', instructions: 'Does the attachment establish the requested fact?' },
      ] as const;
      const wire = {
        model: 'gpt-6-luna',
        answers: [
          { name: 'kind', type: 'choice', choice: true, confidence: 0.62,
            probabilities: [{ value: true, probability: 0.3 }, { value: 'true', probability: 0.6 }, { value: false, probability: 0.1 }] },
          { name: 'attachment', type: 'refusal' },
        ],
        usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15,
          input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
      } satisfies AxAIOpenAIDecisionsResponse<typeof questions>;
      let calls = 0;
      const client = openaiDecisions({ apiKey: 'fixture-only', options: {
        abortSignal: ctx.signal, retry: { maxRetries: 0 }, timeout: 1000,
        fetch: async (input, init) => {
          assert.equal(++calls, 1);
          const request = new Request(input, init);
          assert.equal(request.url, 'https://api.openai.com/v1/decisions');
          return Response.json(wire);
        },
      } });
      // A valid one-pixel PNG is transport data, not visual-quality evidence.
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGOoBwAAgQCA05RTSgAAAABJRU5ErkJggg==';
      const result = await client.create({ model: 'gpt-6-luna', questions, input: [{ role: 'user', content: [
        { type: 'input_text', text: 'Evaluate this synthetic application record and attachment.' },
        { type: 'input_image', image_url: `data:image/png;base64,${png}` },
      ] }] });
      const [choice, attachment] = result.answers;
      assert(choice.type === 'choice'); // Narrow native refusals before reading values.
      assert.equal(choice.choice, true);
      assert.equal(typeof choice.choice, 'boolean');
      assert.equal(choice.probabilities.find(({ value }) => value === 'true')?.probability, 0.6);
      assert.equal(attachment.type, 'refusal');
      assert.equal(result.usage.total_tokens, 15);
      return { choice: choice.choice, choiceType: typeof choice.choice, refused: attachment.name, calls,
        boundary: 'Real native request validation and decoding with synthetic HTTP answers. Boolean true differs from string true; preserve the selected value rather than taking argmax. A native batch retains per-question refusals instead of raising the signature adapter’s terminal refusal error. No image recognition or inference quality was measured.' };
    },
  },
  {
    id: '06-decisions/google-gemini-decisions-evidence',
    title: 'Decode Gemini scalar decisions and evidence with independent local thresholds',
    features: ['google-gemini-decisions', 'scalar/evidence', 'threshold ownership', 'confidence', 'native provenance'],
    modes: ['offline'],
    async run(ctx) {
      const wire = {
        answers: {
          scalar: { type: 'noul', noul: 0.6, confidence: 0.6 },
          boundary: { type: 'noul', noul: 0.9, confidence: 0.9 },
          defaultEvidence: { type: 'noul', noul: 0.6, confidence: 0.6 },
          explicitEvidence: { type: 'noul', noul: 0.6, confidence: 0.6 },
          owner: { type: 'choice', choice: 'engineering', probabilities: { support: 0.1, engineering: 0.9 }, confidence: 0.9 },
          ownerEvidence: { type: 'choice', choice: 'engineering', probabilities: { support: 0.1, engineering: 0.9 }, confidence: 0.9 },
          impact: { type: 'score', score: 1.4, probabilities: { '0': 0.1, '1': 0.4, '2': 0.5 },
            legend: { '0': levels[0], '1': levels[1], '2': levels[2] }, confidence: 0.5 },
          impactEvidence: { type: 'score', score: 1.4, probabilities: { '0': 0.1, '1': 0.4, '2': 0.5 },
            legend: { '0': levels[0], '1': levels[1], '2': levels[2] }, confidence: 0.5 },
        },
        usage: { total_input_tokens: 31, total_output_tokens: 0, total_tokens: 31 },
      } satisfies AxAIGoogleGeminiDecisionsResponse;
      let calls = 0;
      const model = ai({
        name: 'google-gemini-decisions', apiKey: 'fixture-only', trueThreshold: 0.9,
        config: { model: 'gemini-decision-1' },
        options: {
          abortSignal: ctx.signal, timeout: 1_000, retry: { maxRetries: 0 },
          fetch: async (input, init) => {
            assert.equal(++calls, 1, 'Gemini fixture transport budget exhausted');
            const request = new Request(input, init);
            assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/decisions');
            assert.equal(request.method, 'POST');
            assert.equal(request.headers.get('x-goog-api-key'), 'fixture-only');
            const body: AxAIGoogleGeminiDecisionsRequest = await request.json();
            assert.equal(body.model, 'gemini-decision-1');
            assert.deepEqual(Object.keys(body.questions).sort(), Object.keys(wire.answers).sort());
            assert(!Object.hasOwn(body, 'trueThreshold'));
            for (const question of Object.values(body.questions)) assert(!Object.hasOwn(question, 'threshold'));
            const boolean = body.questions.explicitEvidence;
            assert(boolean?.type === 'noul');
            assert.deepEqual(boolean.criteria, { true_description: 'Core task blocked', false_description: 'Routine request' });
            const choice = body.questions.ownerEvidence;
            assert(choice?.type === 'choice');
            assert.deepEqual(choice.criteria, { support: '', engineering: 'Broken functionality' });
            const score = body.questions.impactEvidence;
            assert(score?.type === 'score');
            assert.deepEqual(score.criteria, levels);
            const inputText = [body.input].flat()
              .map((part) => typeof part === 'string' ? part : part.type === 'text' ? part.text : '')
              .join('\n');
            assert(inputText.includes(ticket)); // Accept native text or text blocks without fixing the adapter's layout.
            return Response.json(wire);
          },
        },
      });
      const program = ax(f().input('ticket', f.string())
        .output('scalar', f.boolean('Core task blocked?'))
        .output('boundary', f.boolean('Core task blocked?'))
        .output('defaultEvidence', f.boolean('Core task blocked?').withEvidence())
        .output('explicitEvidence', f.boolean('Core task blocked?').withEvidence({ threshold: 0.9 })
          .describeValues({ true: 'Core task blocked', false: 'Routine request' }))
        .output('owner', f.class(['support', 'engineering']))
        .output('ownerEvidence', f.class(['support', 'engineering']).withEvidence()
          .describeValues({ engineering: 'Broken functionality' }))
        .output('impact', f.score(levels))
        .output('impactEvidence', f.score(levels).withEvidence())
        .build());
      const forwardOptions = { ...decisionOptions(ctx), maxSteps: 1, maxRetries: 0 };
      const result = await program.forward(model, { ticket }, forwardOptions);
      assert.equal(result.scalar, false); // Provider threshold, not field evidence policy.
      assert.equal(result.boundary, true); // Inclusive provider threshold.
      assert.equal(result.defaultEvidence.value, true);
      assert.equal(result.defaultEvidence.threshold, 0.5);
      assert.equal(result.explicitEvidence.value, false);
      assert.equal(result.explicitEvidence.threshold, 0.9);
      for (const evidence of [result.defaultEvidence, result.explicitEvidence]) {
        assert.equal(evidence.probability, 0.6);
        assert.equal(evidence.confidence, 0.6);
      }
      assert.equal(result.owner, 'engineering');
      assert.equal(result.ownerEvidence.value, 'engineering');
      assert.deepEqual(result.ownerEvidence.probabilities, wire.answers.ownerEvidence.probabilities);
      assert.equal(result.ownerEvidence.confidence, 0.9);
      assert.equal(result.impact, 1.4);
      assert.equal(result.impactEvidence.value, 1.4);
      assert.deepEqual(result.impactEvidence.levels, levels);
      assert.deepEqual(result.impactEvidence.probabilities, [0.1, 0.4, 0.5]);
      assert.equal(result.impactEvidence.confidence, 0.5);
      for (const evidence of [result.defaultEvidence, result.explicitEvidence, result.ownerEvidence, result.impactEvidence]) {
        assert.deepEqual(evidence.provenance, { source: 'native', provider: 'Google Gemini Decisions', model: 'gemini-decision-1' });
      }
      await assert.rejects(() => program.forward(model, { ticket }, {
        ...forwardOptions, modelConfig: { maxTokens: 32 },
      }), /generation control.*maxTokens/i);
      for (const signature of ['ticket:string -> target:box(evidence)', 'ticket:string -> urgent?:boolean', 'ticket:string -> reply:string'] as const) {
        await assert.rejects(() => ax(signature).forward(model, { ticket }, forwardOptions), /Google Gemini Decisions|flat|required|scalar/i);
      }
      assert.equal(calls, 1, 'Unsupported signatures must fail before transport');
      return { result, calls,
        proof: 'Injected HTTP answers exercise actual SDK scalar/evidence decoding, confidence and requested-model provenance. No live inference, accuracy or calibration claim.' };
    },
  },
  {
    id: '06-decisions/google-gemini-native-multimodal',
    title: 'Preserve Gemini named answers, multimodal input and per-modality usage',
    features: ['googleGeminiDecisions', 'named questions', 'multimodal blocks', 'native usage', 'native score bounds'],
    modes: ['offline'],
    async run(ctx) {
      const nativeLevels = ['Level 0', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5',
        'Level 6', 'Level 7', 'Level 8', 'Level 9', 'Level 10'] as const;
      const questions = {
        'attachment-present': { type: 'noul', instructions: [{ type: 'text', text: 'Is an attachment present?' }] },
        owner: { type: 'choice', instructions: 'Which team owns this record?', criteria: { support: '', engineering: 'Broken functionality' } },
        impact: { type: 'score', instructions: { type: 'text', text: 'Rate impact on the declared native rubric.' }, criteria: nativeLevels },
      } as const satisfies AxAIGoogleGeminiDecisionsQuestions;
      const payload = {
        model: 'gemini-decision-1',
        input: [
          { type: 'text', text: 'Synthetic transport record; attachments are not recognition evidence.' },
          { type: 'image', mime_type: 'image/png', resolution: 'low',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGOoBwAAgQCA05RTSgAAAABJRU5ErkJggg==' },
          { type: 'audio', mime_type: 'audio/wav', uri: 'https://example.invalid/fixture.wav' },
          { type: 'document', mime_type: 'application/pdf', uri: 'https://example.invalid/fixture.pdf' },
        ],
        questions,
      } as const satisfies AxAIGoogleGeminiDecisionsRequest<typeof questions>;
      const wire = {
        answers: {
          'attachment-present': { type: 'noul', noul: 0.99, confidence: 0.99 },
          owner: { type: 'choice', choice: 'engineering', probabilities: { support: 0.1, engineering: 0.9 }, confidence: 0.9 },
          impact: { type: 'score', score: 10,
            probabilities: Object.fromEntries(nativeLevels.map((_, index) => [String(index), index === 10 ? 1 : 0])),
            legend: Object.fromEntries(nativeLevels.map((label, index) => [String(index), label])), confidence: 1 },
        },
        usage: { total_input_tokens: 42, total_output_tokens: 0, total_tokens: 42,
          input_tokens_by_modality: [{ modality: 'text', tokens: 12 }, { modality: 'image', tokens: 20 }, { modality: 'audio', tokens: 10 }] },
      } satisfies AxAIGoogleGeminiDecisionsResponse<typeof questions>;
      let calls = 0;
      const client = googleGeminiDecisions({ apiKey: 'fixture-only', options: {
        abortSignal: ctx.signal, timeout: 1_000, retry: { maxRetries: 0 },
        fetch: async (input, init) => {
          assert.equal(++calls, 1);
          const request = new Request(input, init);
          assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/decisions');
          assert.equal(request.headers.get('x-goog-api-key'), 'fixture-only');
          const body: AxAIGoogleGeminiDecisionsRequest<typeof questions> = await request.json();
          assert.deepEqual(body, payload); // Inline bytes, HTTPS references and text instructions survive.
          return Response.json(wire);
        },
      } });
      const result = await client.create(payload);
      const owner: 'support' | 'engineering' = result.answers.owner.choice;
      assert.deepEqual(result.answers, wire.answers);
      assert.equal(result.answers['attachment-present'].noul, 0.99);
      assert.equal(owner, 'engineering');
      assert.equal(result.answers.impact.score, 10);
      assert.deepEqual(result.usage, wire.usage); // Includes native per-modality detail and zero output tokens.
      // Eleven levels are legal natively; the shared signature rubric remains bounded at ten.
      assert.throws(() => ax(f().input('ticket', f.string()).output('impact', f.score(nativeLevels)).build()), /10|ten|levels/i);
      await assert.rejects(() => client.create({
        input: ticket,
        questions: { 'invalid key': { type: 'noul', instructions: 'Is this applicable?' } },
      }), /question keys/i);
      await assert.rejects(() => client.create({
        input: { type: 'audio', mime_type: 'audio/wav', uri: 'gs://fixture/audio.wav' }, questions,
      }), /HTTPS/i);
      await assert.rejects(() => client.create({
        input: { type: 'image', mime_type: 'image/png', data: 'data:image/png;base64,YQ==' }, questions,
      }), /base64/i);
      assert.equal(calls, 1, 'Invalid question names must fail before transport');
      return { answers: result.answers, usage: result.usage, calls,
        proof: 'Actual SDK native validation/decoding with synthetic HTTP answers. Media bytes and references are preserved, never fetched by this fixture; no recognition, inference quality or provider-equivalence claim.' };
    },
  },
  {
    id: '06-decisions/google-gemini-native-validation',
    title: 'Reject malformed Gemini answers rather than manufacturing usable evidence',
    features: ['native decoding', 'required confidence', 'noul bounds', 'distribution/legend validation', 'zero output usage'],
    modes: ['offline'],
    async run(ctx) {
      const questions = {
        allowed: { type: 'noul', instructions: 'Is the record allowed?' },
        impact: { type: 'score', instructions: 'How much impact?', criteria: ['Low', 'High'] },
      } as const satisfies AxAIGoogleGeminiDecisionsQuestions;
      const valid = {
        answers: {
          allowed: { type: 'noul', noul: 0.6, confidence: 0.6 },
          impact: { type: 'score', score: 0.8, probabilities: { '0': 0.2, '1': 0.8 },
            legend: { '0': 'Low', '1': 'High' }, confidence: 0.8 },
        },
        usage: { total_input_tokens: 9, total_output_tokens: 0, total_tokens: 9 },
      } satisfies AxAIGoogleGeminiDecisionsResponse<typeof questions>;
      // Deliberately invalid wire payloads remain unknown; never cast them to valid SDK responses.
      const fixtures: readonly { name: string; wire: unknown; error: RegExp }[] = [
        { name: 'missing-confidence', wire: { ...valid, answers: { ...valid.answers, allowed: { type: 'noul', noul: 0.6 } } }, error: /confidence/i },
        { name: 'noul-outside-provider-range', wire: { ...valid, answers: { ...valid.answers, allowed: { ...valid.answers.allowed, noul: 1 } } }, error: /0.01.*0.99/i },
        { name: 'invalid-distribution', wire: { ...valid, answers: { ...valid.answers, impact: { ...valid.answers.impact, probabilities: { '0': 0.2, '1': 0.7 } } } }, error: /distribution/i },
        { name: 'mismatched-legend', wire: { ...valid, answers: { ...valid.answers, impact: { ...valid.answers.impact, legend: { '0': 'High', '1': 'Low' } } } }, error: /legend/i },
        { name: 'nonzero-output-usage', wire: { ...valid, usage: { ...valid.usage, total_output_tokens: 1, total_tokens: 10 } }, error: /zero output tokens/i },
      ];
      let calls = 0;
      let response: unknown;
      const client = googleGeminiDecisions({ apiKey: 'fixture-only', options: {
        abortSignal: ctx.signal, timeout: 1_000, retry: { maxRetries: 0 },
        fetch: async () => {
          assert(++calls <= fixtures.length, 'Validation fixture transport budget exhausted');
          return Response.json(response);
        },
      } });
      for (const fixture of fixtures) {
        response = fixture.wire;
        await assert.rejects(() => client.create({ input: ticket, questions }), fixture.error);
      }
      assert.equal(calls, fixtures.length);
      return { rejected: fixtures.map(({ name }) => name), calls,
        proof: 'Malformed synthetic responses fail actual SDK decoding after one injected fetch each. No inferred probabilities, confidence or usable decisions replace invalid provider data.' };
    },
  },
  {
    id: '06-decisions/native-structured',
    title: 'Batch native Noul/Choice/Score with structured criteria and discover models',
    features: ['typesafe()', 'systemOne', 'structured criteria', 'Noul', 'Choice', 'Score', 'listModels', 'fetch customization'],
    modes: ['offline', 'live'],
    async run(ctx) {
      const questions = {
        urgent: {
          type: 'noul', instructions: 'Does this ticket require immediate incident response?',
          criteria: { true: { description: 'Core task blocked', examples: ['Cannot pay'], allCustomers: true }, false: 'Routine request' },
        },
        team: {
          type: 'choice', instructions: { question: 'Which team owns the investigation?', chooseOne: true },
          criteria: { support: ['Product usage questions'], engineering: { description: 'Broken functionality or service outage' } },
        },
        severity: {
          type: 'score', instructions: 'How severe is customer impact?',
          criteria: [{ description: levels[0], impact: 0 }, { description: levels[1], impact: 1 }, { description: levels[2], impact: 2 }],
        },
      } as const satisfies AxAITypesafeQuestions;
      let inferenceCalls = 0;
      let discoveryCalls = 0;
      const fixture = typesafe({
        apiKey: 'isolated-fixture-not-a-secret',
        options: { fetch: async (input, init) => {
          const request = new Request(input, init);
          if (new URL(request.url).pathname === '/v1/models') {
            discoveryCalls++;
            assert.equal(request.method, 'GET');
            return Response.json({ models: [{ name: 'jev-fixture', description: 'Deterministic transport fixture', release_date: '2026-01-01' }] });
          }
          inferenceCalls++;
          assert.equal(request.method, 'POST');
          assert((await request.text()).includes('allCustomers'));
          return Response.json({ model: 'jev-fixture', answers: {
            urgent: { type: 'noul', noul: 0.9 },
            team: { type: 'choice', choice: 'engineering', probabilities: { support: 0.1, engineering: 0.9 }, confidence: 0.8 },
            severity: { ...evidenceAnswers.severity, legend: Object.fromEntries(questions.severity.criteria.map((criterion, index) => [String(index), criterion])) },
          }, usage: { input_tokens: 48, output_tokens: 9 } });
        } },
      });
      const client = ctx.mode === 'live' ? ctx.nativeDecisions : fixture;
      const result = await client.systemOne({ state: { ticket, recentEvents: [], tenant: { sandbox: true } }, questions }, { abortSignal: ctx.signal });
      const models = await client.listModels({ abortSignal: ctx.signal });
      const decision = { escalate: result.answers.urgent.noul >= 0.9, owner: result.answers.team.choice, severityOnTen: result.answers.severity.score / 2 * 10 };
      assert(['support', 'engineering'].includes(decision.owner));
      assert(decision.severityOnTen >= 0 && decision.severityOnTen <= 10);
      assert(models.every((model) => typeof model.name === 'string'));
      assert(!('confidence' in result.answers.urgent));
      if (ctx.mode === 'offline') {
        assert.deepEqual(decision, { escalate: true, owner: 'engineering', severityOnTen: 9 });
        assert.equal(inferenceCalls, 1); assert.equal(discoveryCalls, 1);
      }
      return { decision, answers: result.answers, model: result.model, usage: result.usage, models, proof: 'Caller owns threshold/scaling; same-request questions cannot depend on sibling answers. Offline severity deliberately disagrees with its weighted distribution to test transport preservation, not live Jev semantics.' };
    },
  },
  {
    id: '06-decisions/reranking',
    title: 'Rank query/document pairs while retaining application candidate IDs',
    features: ['reranking', 'rubric scores', 'evidence', 'candidate ownership'],
    modes: ['offline', 'live'],
    async run(ctx) {
      const candidates = [
        { id: 'invoice-guide', text: 'Download invoices from Billing > Invoices.' },
        { id: 'outage-runbook', text: 'For checkout outages page on-call engineering and enable the payment incident runbook.' },
      ];
      const query = 'Who handles a checkout outage?';
      const judge = ax('query:string, document:string -> relevance:score "Irrelevant, Related, Partial answer, Direct answer"(evidence)');
      const ranked = [];
      for (const [index, candidate] of candidates.entries()) {
        const score = index === 0 ? 0.2 : 2.8;
        const fixture = decisionFixture({ relevance: {
          type: 'score', score, probabilities: index === 0 ? { '0': 0.8, '1': 0.2, '2': 0, '3': 0 } : { '0': 0, '1': 0, '2': 0.2, '3': 0.8 },
          legend: { '0': 'Irrelevant', '1': 'Related', '2': 'Partial answer', '3': 'Direct answer' }, confidence: 0.7,
        } });
        const result = await judge.forward(ctx.mode === 'live' ? ctx.decisions : fixture.model, { query, document: candidate.text }, decisionOptions(ctx));
        ranked.push({ id: candidate.id, relevance: result.relevance });
      }
      ranked.sort((a, b) => b.relevance.value - a.relevance.value);
      assert.equal(new Set(ranked.map((item) => item.id)).size, candidates.length);
      assert(ranked[0]!.relevance.value >= ranked[1]!.relevance.value);
      if (ctx.mode === 'offline') assert.equal(ranked[0]!.id, 'outage-runbook');
      return { ranked, proof: 'One shared rubric/model permits ordering; fixture ranking does not establish retrieval quality.' };
    },
  },
  {
    id: '06-decisions/typed-generation-handoff',
    title: 'Make a typed decision first, then ask a generative model for prose',
    features: ['decision to generation', 'typed handoff', 'provider separation'],
    modes: ['offline', 'live'],
    async run(ctx) {
      const triage = ax('ticket:string -> urgent:boolean, team:class "support, engineering"');
      const fixture = decisionFixture({ urgent: evidenceAnswers.urgent, team: { type: 'choice', choice: 'engineering', probabilities: { support: 0.1, engineering: 0.9 }, confidence: 0.8 } });
      const decision = await triage.forward(ctx.mode === 'live' ? ctx.decisions : fixture.model, { ticket }, decisionOptions(ctx));
      const writer = ax('ticket:string, urgent:boolean, assignedTeam:string "The decision-selected owner: support or engineering" -> reply:string');
      const model = ctx.mode === 'live' ? ctx.ai : scriptedAI([{ results: [{ index: 0, content: 'Reply: Engineering is investigating the checkout outage. No restoration time is confirmed.' }] }]);
      const response = await writer.forward(model, { ticket, urgent: decision.urgent, assignedTeam: decision.team }, options(ctx));
      assert(response.reply.trim().length > 0);
      return { decision, response, delivery: 'Draft only; no email or external action.', proof: 'The decision provider never receives an unsupported freeform output.' };
    },
  },
  {
    id: '06-decisions/refusal-policy',
    title: 'Return or throw terminal decision refusals without inventing probabilities',
    features: ['refusal return', 'AxDecisionRefusalError', 'elicited evidence'],
    modes: ['offline'],
    async run(ctx) {
      const returnProgram = ax('reviewRequest:string -> allowed:boolean(evidence, refusal return)');
      const result = await returnProgram.forward(scriptedAI([{ results: [{ index: 0, content: '{"allowed":{"status":"refused"}}' }] }]), { reviewRequest: 'An intentionally refused safety decision fixture.' }, options(ctx));
      assert.equal(result.allowed.status, 'refused');
      assert(!('probability' in result.allowed));
      assert.equal(result.allowed.provenance.source, 'elicited');
      let calls = 0;
      const throwProgram = ax('reviewRequest:string -> allowed:boolean(evidence)');
      const refused = scriptedAI(() => { calls++; return { results: [{ index: 0, content: '{"allowed":{"status":"refused"}}' }] }; });
      await assert.rejects(() => throwProgram.forward(refused, { reviewRequest: 'Same refusal, default throw policy.' }, options(ctx)), (error: unknown) => {
        assert(error instanceof AxDecisionRefusalError);
        assert.equal(error.fieldPath, 'allowed');
        return true;
      });
      assert.equal(calls, 1); // Terminal refusal bypasses the normal correction budget.
      return { result, defaultPolicy: 'AxDecisionRefusalError', calls, proof: 'Deterministic refusal handling, not a claim that a live model will refuse this input.' };
    },
  },
  {
    id: '06-decisions/native-validation',
    title: 'Enforce native distributions and reject unsupported adapter shapes before transport',
    features: ['probability validation', 'inclusive distribution tolerance', 'no renormalization', 'adapter restrictions'],
    modes: ['offline'],
    async run(ctx) {
      const question = {
        owner: { type: 'choice', instructions: 'Who owns this ticket?', criteria: { support: null, engineering: 'Service outage' } },
      } as const satisfies AxAITypesafeQuestions;
      let total = 0.99;
      let calls = 0;
      const client = typesafe({ apiKey: 'isolated-fixture-not-a-secret', options: { fetch: async () => {
        calls++;
        return Response.json({
          model: 'jev-fixture',
          answers: { owner: { type: 'choice', choice: 'engineering', probabilities: { support: 0.1, engineering: total - 0.1 }, confidence: 0.7 } },
          usage: { input_tokens: 9, output_tokens: 3 },
        });
      } } });
      const preservedTotals = [];
      for (total of [0.99, 1.01]) {
        const result = await client.systemOne({ state: { ticket }, questions: question }, { abortSignal: ctx.signal });
        const sum = Object.values(result.answers.owner.probabilities).reduce((a, b) => a + b, 0);
        assert(Math.abs(sum - total) < 1e-12);
        preservedTotals.push(sum);
      }
      total = 0.98;
      await assert.rejects(() => client.systemOne({ state: { ticket }, questions: question }, { abortSignal: ctx.signal }), /distribution/i);
      assert.equal(calls, 3);
      let adapterCalls = 0;
      const unsupported = ai({ name: 'typesafe', apiKey: 'isolated-fixture-not-a-secret', options: { fetch: async () => {
        adapterCalls++; throw new Error('Unsupported signature unexpectedly reached transport');
      } } });
      const signatures = [
        'ticket:string -> reply:string',
        'ticket:string -> severity:number',
        'ticket:string -> urgent?:boolean',
        'ticket:string -> teams:class[] "support, engineering"',
      ] as const;
      for (const signature of signatures) {
        const program = ax(signature);
        await assert.rejects(() => program.forward(unsupported, { ticket }, { ...decisionOptions(ctx), maxRetries: 0 }), /Typesafe|flat|required|scalar|output/i);
      }
      assert.equal(adapterCalls, 0);
      return { preservedTotals, rejectedDistributionTotal: total, unsupportedSignatures: signatures, adapterCalls, proof: 'Native tolerance is inclusive and preserves probabilities; plain numbers are not scoring rubrics and decision providers do not generate prose.' };
    },
  },
];

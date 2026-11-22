import assert from 'node:assert/strict';
import { ai, ax, f, flow } from '@ax-llm/ax';
import { type Example, type ExampleContext, options, scriptedAI } from './support.ts';

// Synthetic transport only. All signatures, decoding and Flow execution use Ax.
// Every numeric acceptance boundary below is fixture-only, not calibrated policy.
function fixture(ctx: ExampleContext, replies: readonly (Record<string, unknown> | Error)[]) {
  const requests: string[] = [];
  const model = ai({
    name: 'typesafe',
    apiKey: 'isolated-fixture-not-a-secret',
    options: {
      abortSignal: ctx.signal,
      retry: { maxRetries: 0 },
      timeout: 1000,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        assert.equal(new URL(request.url).pathname, '/v1/systemone');
        requests.push(await request.text());
        const answer = replies[requests.length - 1];
        assert(answer, 'Fixture request budget exhausted');
        if (answer instanceof Error) throw answer;
        return Response.json({
          model: 'jev-fixture',
          answers: answer,
          usage: { input_tokens: 20, output_tokens: 4 },
        });
      },
    },
  });
  return { model, requests };
}
function decisionOptions(ctx: ExampleContext) {
  return { ...options(ctx), modelConfig: {}, maxSteps: 1, maxRetries: 0, abortSignal: ctx.signal };
}
const noul = (probability: number) => ({ type: 'noul', noul: probability });
const choice = (probability: number, selected = 'revised_date') => ({
  type: 'choice',
  choice: selected,
  probabilities: { original_date: 1 - probability, revised_date: probability },
  confidence: 0.37,
});
const limitation =
  'Synthetic I/O proves SDK composition only, not inference quality, calibration, cost or security. Thresholds are fixture-only. No external effects.';

export const examples: readonly Example[] = [
  {
    id: '39-decision-patterns/candidate-selection',
    title: 'Copy host candidates only after applicability and ambiguity gates',
    features: ['candidate selection', 'native evidence', 'absence', 'uncertainty', 'failure'],
    modes: ['offline'],
    async run(ctx) {
      const text = 'Source note: originally 2030-04-03; instead use 2030-04-09.';
      const dates = [...text.matchAll(/\d{4}-\d{2}-\d{2}/g)];
      const candidates = dates.map((match, index) => ({
        id: index ? 'revised_date' : 'original_date',
        source: 'Source note',
        span: match[0],
        normalized: match[0],
        offset: match.index,
      }));
      assert.equal(candidates.length, 2);
      const program = ax(
        f()
          .input('sourceText', f.string())
          .input('candidateDates', f.string())
          .output(
            'anythingFits',
            f
              .boolean(
                'Does any date in candidateDates express the date the writer proposes using in sourceText?',
              )
              .withEvidence(),
          )
          .output(
            'selected',
            f
              .class(
                ['original_date', 'revised_date'],
                'Which date in candidateDates best expresses the date the writer proposes using in sourceText?',
              )
              .describeValues({
                original_date: 'Originally stated date',
                revised_date: 'Proposed replacement date',
              })
              .withEvidence(),
          )
          .build(),
      );
      const outcomes = [];
      for (const [name, applicable, selected, expected] of [
        ['selected', 0.95, 0.9, 'selected'],
        ['absent-correct-candidate', 0.05, 0.99, 'none'],
        ['uncertain', 0.5, 0.99, 'hold'],
        ['ambiguous-label', 0.95, 0.55, 'hold'],
        ['negative-equality', 0.2, 0.99, 'none'],
        ['positive-equalities', 0.8, 0.8, 'selected'],
      ] as const) {
        const io = fixture(ctx, [{ anythingFits: noul(applicable), selected: choice(selected) }]);
        const suppliedText =
          name === 'absent-correct-candidate'
            ? 'Source note: use 2030-05-01, not either supplied date.'
            : text;
        const result = await program.forward(
          io.model,
          { sourceText: suppliedText, candidateDates: JSON.stringify(candidates) },
          decisionOptions(ctx),
        );
        const p = result.anythingFits.probability;
        const selectedProbability = result.selected.probabilities[result.selected.value];
        const outcome =
          p <= 0.2 ? 'none' : p < 0.8 || selectedProbability < 0.8 ? 'hold' : 'selected';
        const copied =
          outcome === 'selected'
            ? candidates.find(({ id }) => id === result.selected.value)
            : undefined;
        assert.equal(outcome, expected);
        if (outcome === 'selected') assert.strictEqual(copied, candidates[1]);
        else assert.equal(copied, undefined);
        assert.equal(result.selected.confidence, 0.37); // Native confidence is not recomputed from probabilities.
        assert.deepEqual(result.selected.provenance, {
          source: 'native',
          provider: 'Typesafe',
          model: 'jev-fixture',
        });
        assert.equal(io.requests.length, 1);
        const [request] = io.requests;
        assert(request !== undefined);
        const body = JSON.parse(request);
        assert.deepEqual(Object.keys(body.questions).sort(), ['anythingFits', 'selected']);
        assert(request.includes('Source note'));
        outcomes.push({ name, outcome, copied, evidence: result, requests: io.requests.length });
      }
      // Empty sets bypass the SDK; singleton sets ask applicability, not invented Choice confidence.
      const empty = fixture(ctx, []);
      const emptyPool = candidates.slice(0, 0);
      const emptyOutcome =
        emptyPool.length === 0
          ? 'none'
          : await program.forward(
              empty.model,
              { sourceText: text, candidateDates: JSON.stringify(emptyPool) },
              decisionOptions(ctx),
            );
      assert.equal(emptyOutcome, 'none');
      assert.equal(empty.requests.length, 0);
      const singletonProgram = ax(
        f()
          .input('sourceText', f.string())
          .input('candidateDate', f.string())
          .output(
            'anythingFits',
            f.boolean('Does candidateDate express the date proposed in sourceText?').withEvidence(),
          )
          .build(),
      );
      const singletonOutcomes = [];
      for (const [name, probability, sourceText, expected] of [
        ['applicable', 0.95, text, 'selected'],
        ['inapplicable', 0.05, 'Source note: use 2030-05-01 instead of 2030-04-09.', 'none'],
        [
          'uncertain',
          0.5,
          'Source note: perhaps use 2030-04-09; the proposed date is not settled.',
          'hold',
        ],
      ] as const) {
        const singleton = fixture(ctx, [{ anythingFits: noul(probability) }]);
        const single = await singletonProgram.forward(
          singleton.model,
          {
            sourceText,
            candidateDate: JSON.stringify(candidates[1]),
          },
          decisionOptions(ctx),
        );
        const outcome =
          single.anythingFits.probability <= 0.2
            ? 'none'
            : single.anythingFits.probability >= 0.8
              ? 'selected'
              : 'hold';
        const copied = outcome === 'selected' ? candidates[1] : undefined;
        assert.equal(outcome, expected);
        if (outcome === 'selected') assert.strictEqual(copied, candidates[1]);
        else assert.equal(copied, undefined);
        assert.equal(singleton.requests.length, 1);
        const [request] = singleton.requests;
        assert(request !== undefined);
        assert(request.includes(sourceText));
        assert.deepEqual(Object.keys(JSON.parse(request).questions), ['anythingFits']);
        singletonOutcomes.push({ name, outcome, copied, evidence: single, requests: 1 });
      }
      const malformed = fixture(ctx, [
        { anythingFits: noul(0.95), selected: choice(0.9, 'invented_date') },
      ]);
      await assert.rejects(() =>
        program.forward(
          malformed.model,
          { sourceText: text, candidateDates: JSON.stringify(candidates) },
          decisionOptions(ctx),
        ),
      );
      assert.equal(malformed.requests.length, 1);
      return {
        outcomes,
        empty: { outcome: 'none', requests: 0 },
        singletonOutcomes,
        malformed: { outcome: 'failed', requests: malformed.requests.length },
        limitation,
      };
    },
  },
  {
    id: '39-decision-patterns/speculative-truth-table',
    title: 'Apply ordered host rules to shared questions and stage real dependencies',
    features: ['truth table', 'speculative answers', 'precedence', 'two-stage dependency'],
    modes: ['offline'],
    async run(ctx) {
      const program = ax(
        f()
          .input('editSnapshot', f.string())
          .output(
            'replace',
            f
              .boolean('Does the edit request in editSnapshot ask to replace the passage?')
              .withEvidence(),
          )
          .output(
            'explain',
            f
              .boolean('Does the edit request in editSnapshot ask for an explanation?')
              .withEvidence(),
          )
          .output(
            'selected',
            f
              .class(
                ['original_date', 'revised_date'],
                'Which passage in editSnapshot best matches the requested replacement?',
              )
              .withEvidence(),
          )
          .build(),
      );
      const outcomes = [];
      for (const [name, replacement, explanation, selected, current, expected] of [
        ['overlap', 0.95, 0.95, 0.95, true, 'replacement'],
        ['explanation-ignores-selector', 0.05, 0.95, 0.5, true, 'explanation'],
        ['high-priority-uncertain', 0.5, 0.95, 0.95, true, 'hold'],
        ['none-ignores-selector', 0.05, 0.05, 0.5, true, 'none'],
        ['stale-facts', 0.95, 0.95, 0.95, false, 'hold'],
      ] as const) {
        const io = fixture(ctx, [
          { replace: noul(replacement), explain: noul(explanation), selected: choice(selected) },
        ]);
        let outcome = 'hold';
        let evidence: Awaited<ReturnType<typeof program.forward>> | undefined;
        if (current) {
          const requestText =
            name === 'none-ignores-selector'
              ? 'Keep the text unchanged; no explanation needed.'
              : name === 'explanation-ignores-selector'
                ? 'Explain the date; do not replace it.'
                : 'Use the revised date passage instead and explain the edit.';
          evidence = await program.forward(
            io.model,
            {
              editSnapshot: JSON.stringify({
                sourceName: 'Current revision 7',
                requestText,
                candidateAvailable: true,
                original_date: 'The date is 2030-04-03.',
                revised_date: 'The date is 2030-04-09.',
              }),
            },
            decisionOptions(ctx),
          );
          const p = evidence.replace.probability;
          outcome =
            p > 0.2 && p < 0.8
              ? 'hold'
              : p >= 0.8
                ? evidence.selected.probabilities[evidence.selected.value] >= 0.8
                  ? 'replacement'
                  : 'hold'
                : evidence.explain.probability >= 0.8
                  ? 'explanation'
                  : evidence.explain.probability <= 0.2
                    ? 'none'
                    : 'hold';
          const [request] = io.requests;
          assert(request !== undefined);
          const body = JSON.parse(request);
          assert.deepEqual(Object.keys(body.questions).sort(), ['explain', 'replace', 'selected']);
        }
        assert.equal(outcome, expected);
        assert.equal(io.requests.length, current ? 1 : 0);
        outcomes.push({ name, outcome, evidence, requests: io.requests.length, effects: 0 });
      }
      for (const reply of [new Error('transport unavailable'), { replace: noul(0.95) }]) {
        const io = fixture(ctx, [reply]);
        await assert.rejects(() =>
          program.forward(io.model, { editSnapshot: 'Current revision 7.' }, decisionOptions(ctx)),
        );
        assert.equal(io.requests.length, 1);
        outcomes.push({
          name: reply instanceof Error ? 'transport' : 'decode',
          outcome: 'failed',
          requests: 1,
          effects: 0,
        });
      }
      const dependency = fixture(ctx, [{ selected: choice(0.95) }, { supported: noul(0.95) }]);
      const select = ax(
        f()
          .input('passageOptions', f.string())
          .output(
            'selected',
            f
              .class(
                ['original_date', 'revised_date'],
                'Which named passage is requested in passageOptions?',
              )
              .withEvidence(),
          )
          .build(),
      );
      const passages = {
        original_date: 'Original passage: alpha.',
        revised_date: 'Selected evidence: beta.',
      };
      const first = await select.forward(
        dependency.model,
        {
          passageOptions: JSON.stringify({ requestText: 'Use the beta passage.', ...passages }),
        },
        decisionOptions(ctx),
      );
      assert(first.selected.probabilities[first.selected.value] >= 0.8);
      const selectedEvidence = passages[first.selected.value];
      const verify = ax(
        f()
          .input('selectedSource', f.string())
          .output(
            'supported',
            f.boolean('Does selectedSource explicitly contain beta?').withEvidence(),
          )
          .build(),
      );
      const second = await verify.forward(
        dependency.model,
        { selectedSource: selectedEvidence },
        decisionOptions(ctx),
      );
      assert(second.supported.probability >= 0.8);
      assert.equal(dependency.requests.length, 2);
      const [selectionRequest, verificationRequest] = dependency.requests;
      assert(selectionRequest !== undefined && verificationRequest !== undefined);
      assert(verificationRequest.includes(selectedEvidence));
      assert(!Object.hasOwn(JSON.parse(selectionRequest).questions, 'supported'));
      return {
        outcomes,
        dependency: { evidence: selectedEvidence, first, second, requests: 2 },
        limitation,
      };
    },
  },
  {
    id: '39-decision-patterns/rerank-and-reweight',
    title: 'Filter before scoring and reweight preserved independent rubrics in code',
    features: ['authorized retrieval', 'reranking', 'score evidence', 'reweight without requests'],
    modes: ['offline'],
    async run(ctx) {
      const relevance = ['Unrelated', 'Partly relevant', 'Directly relevant'] as const;
      const completeness = ['Missing detail', 'Some detail', 'Complete detail'] as const;
      const score = (
        value: number,
        levels: readonly string[],
        probabilities?: readonly number[],
      ) => {
        const position = Math.min(2, Math.max(0, value));
        const distribution = probabilities ?? [
          Math.max(0, 1 - position),
          1 - Math.abs(position - 1),
          Math.max(0, position - 1),
        ];
        return {
          type: 'score',
          score: value,
          probabilities: Object.fromEntries(distribution.map((p, i) => [String(i), p])),
          legend: Object.fromEntries(levels.map((level, i) => [String(i), level])),
          confidence: 0.43,
        };
      };
      const program = ax(
        f()
          .input('queryText', f.string())
          .input('documentText', f.string())
          .output(
            'relevance',
            f.score(relevance, 'How directly does documentText address queryText?').withEvidence(),
          )
          .output(
            'completeness',
            f.score(completeness, 'How complete is documentText for queryText?').withEvidence(),
          )
          .build(),
      );
      const retrieved = [
        {
          id: 'A',
          text: 'Short source about the requested topic.',
          authorized: true,
          current: true,
        },
        {
          id: 'B',
          text: 'Detailed source about the requested topic.',
          authorized: true,
          current: true,
        },
        { id: 'X', text: 'FORBIDDEN_UNAUTHORIZED_TEXT', authorized: false, current: true },
      ];
      const documents = retrieved.filter(({ authorized, current }) => authorized && current);
      assert.equal(documents.length, 2); // Fixed fixture concurrency bound after authorization/currentness filtering.
      const outcomes = [];
      for (const variant of [
        'normal',
        'fractional',
        'tie',
        'empty',
        'low-relevance',
        'two-peaked',
        'incomplete',
        'transport',
        'invalid',
      ] as const) {
        const pairs = variant === 'empty' ? [] : documents;
        // The fixed pool retains two documents: at most two independent requests in flight.
        // Each pair owns its fixture so response order cannot change document/evidence identity.
        const runs = pairs.map((document, index) => {
          const reply =
            variant === 'transport' && index === 1
              ? new Error('pair unavailable')
              : variant === 'incomplete' && index === 1
                ? { relevance: score(1, relevance) }
                : {
                    relevance: score(
                      variant === 'low-relevance'
                        ? 0.1
                        : variant === 'tie' || variant === 'two-peaked'
                          ? 1
                          : index
                            ? 1
                            : variant === 'fractional'
                              ? 1.9
                              : 2,
                      relevance,
                      variant === 'two-peaked' && index === 0
                        ? [0.5, 0, 0.5]
                        : variant === 'fractional' && index === 0
                          ? [0, 0.1, 0.9]
                          : undefined,
                    ),
                    completeness: score(
                      variant === 'invalid' && index === 1
                        ? 9
                        : variant === 'tie'
                          ? 1
                          : index
                            ? 2
                            : 0,
                      completeness,
                    ),
                  };
          return { document, io: fixture(ctx, [reply]) };
        });
        const attempts = await Promise.allSettled(
          runs.map(async ({ document, io }) => ({
            id: document.id,
            evidence: await program.forward(
              io.model,
              {
                queryText: 'Explain the requested topic',
                documentText: document.text,
              },
              decisionOptions(ctx),
            ),
          })),
        );
        const results = attempts.flatMap((attempt) =>
          attempt.status === 'fulfilled' ? [attempt.value] : [],
        );
        const failures = attempts.flatMap((attempt, index) =>
          attempt.status === 'rejected'
            ? [
                {
                  id: pairs[index]?.id,
                  error:
                    attempt.reason instanceof Error
                      ? attempt.reason.message
                      : String(attempt.reason),
                },
              ]
            : [],
        );
        const requestCount = () => runs.reduce((total, { io }) => total + io.requests.length, 0);
        assert.equal(requestCount(), pairs.length);
        assert(
          runs.every(({ io }) =>
            io.requests.every((request) => !request.includes('FORBIDDEN_UNAUTHORIZED_TEXT')),
          ),
        );
        const before = requestCount();
        const rank = (relevanceWeight: number) =>
          results
            .map(({ id, evidence }, order) => ({
              id,
              order,
              preference:
                (relevanceWeight * evidence.relevance.value) / 2 +
                ((1 - relevanceWeight) * evidence.completeness.value) / 2,
            }))
            .sort((a, b) => b.preference - a.preference || a.order - b.order);
        const relevanceFirst = rank(0.75);
        const completenessFirst = rank(0.25);
        assert.equal(requestCount(), before);
        const split = results.some(({ evidence }) => {
          const [low, , high] = evidence.relevance.probabilities;
          assert(low !== undefined && high !== undefined);
          return low >= 0.45 && high >= 0.45;
        });
        const outcome = !pairs.length
          ? 'none'
          : failures.length || results.length !== pairs.length
            ? 'incomplete'
            : split
              ? 'hold'
              : results.every(({ evidence }) => evidence.relevance.value < 0.5)
                ? 'none'
                : 'ranked';
        if (variant === 'normal' || variant === 'fractional') {
          assert.equal(outcome, 'ranked');
          assert.equal(relevanceFirst[0]?.id, 'A');
          assert.equal(completenessFirst[0]?.id, 'B');
          assert.equal(
            relevanceFirst[0]?.preference,
            variant === 'normal' ? 0.75 : (0.75 * 1.9) / 2,
          );
          assert.equal(relevanceFirst[1]?.preference, 0.625);
          assert.equal(completenessFirst[0]?.preference, 0.875);
          assert.equal(results[0]?.evidence.relevance.value, variant === 'normal' ? 2 : 1.9); // Retain the native value and distribution separately.
          assert.deepEqual(
            results[0]?.evidence.relevance.probabilities,
            variant === 'normal' ? [0, 0, 1] : [0, 0.1, 0.9],
          );
          assert.deepEqual(results[0]?.evidence.completeness.levels, completeness);
          assert.deepEqual(results[0]?.evidence.completeness.probabilities, [1, 0, 0]);
          assert.deepEqual(results[1]?.evidence.relevance.probabilities, [0, 1, 0]);
          assert.deepEqual(results[1]?.evidence.completeness.probabilities, [0, 0, 1]);
          assert.equal(results[0]?.evidence.relevance.confidence, 0.43);
          assert.deepEqual(results[0]?.evidence.relevance.provenance, {
            source: 'native',
            provider: 'Typesafe',
            model: 'jev-fixture',
          });
        } else if (variant === 'tie')
          assert.deepEqual(
            relevanceFirst.map(({ id }) => id),
            ['A', 'B'],
          );
        else
          assert.equal(
            outcome,
            variant === 'empty' || variant === 'low-relevance'
              ? 'none'
              : variant === 'two-peaked'
                ? 'hold'
                : 'incomplete',
          );
        outcomes.push({
          variant,
          outcome,
          results,
          failures,
          relevanceFirst,
          completenessFirst,
          requests: before,
          reweightRequests: 0,
        });
      }
      return { outcomes, limitation };
    },
  },
  {
    id: '39-decision-patterns/verify-escalate',
    title: 'Verify in Flow, generate separately and reverify before in-memory release',
    features: ['Flow verifier', 'separate generation', 'reverification', 'held failures'],
    modes: ['offline'],
    async run(ctx) {
      const verifier = ax(
        f()
          .input('candidateStatement', f.string())
          .input('sourceText', f.string())
          .output(
            'supported',
            f
              .boolean('Does sourceText explicitly support the complete candidateStatement?')
              .withEvidence(),
          )
          .build(),
      );
      const workflow = flow<{ candidateStatement: string; sourceText: string }>()
        .node('verify', verifier)
        .execute('verify', (state) => ({
          candidateStatement: state.candidateStatement,
          sourceText: state.sourceText,
        }))
        .returns((state) => ({ supported: state.verifyResult.supported }));
      const outcomes = [];
      for (const [name, first, second, expected, source] of [
        ['accepted', 0.95, 0.95, 'released', true],
        ['fallback-accepted', 0.05, 0.95, 'released', true],
        ['initial-uncertain', 0.5, 0.95, 'hold', true],
        ['fallback-negative', 0.05, 0.05, 'hold', true],
        ['fallback-uncertain', 0.05, 0.5, 'hold', true],
        ['missing-source', 0.95, 0.95, 'unavailable', false],
        ['initial-transport', -1, 0.95, 'failed', true],
        ['initial-decode', -2, 0.95, 'failed', true],
        ['fallback-transport', 0.05, -1, 'failed', true],
        ['fallback-decode', 0.05, -2, 'failed', true],
      ] as const) {
        const answer = (p: number) =>
          p === -1
            ? new Error('verifier transport unavailable')
            : p === -2
              ? {}
              : { supported: noul(p) };
        const io = fixture(ctx, [answer(first), answer(second)]);
        let generated = 0;
        let releases = 0;
        const fallback = scriptedAI(() => {
          generated++;
          return {
            results: [
              {
                index: 0,
                content: 'Candidate Statement: The marker has a blue color.',
                finishReason: 'stop',
              },
            ],
          };
        });
        let outcome = 'unavailable';
        let released: string | undefined;
        const evidence = [];
        const sourceText = source ? 'Named source: The marker is blue.' : '';
        if (sourceText) {
          try {
            let candidate = name === 'accepted' ? 'The marker is blue.' : 'The marker is green.';
            const initial = await workflow.forward(
              io.model,
              { candidateStatement: candidate, sourceText },
              decisionOptions(ctx),
            );
            evidence.push(initial);
            if (initial.supported.probability >= 0.8) {
              released = candidate;
              releases++;
              outcome = 'released';
            } else if (initial.supported.probability > 0.2) outcome = 'hold';
            else {
              const proposal = await ax('sourceText:string -> candidateStatement:string').forward(
                fallback,
                { sourceText },
                options(ctx),
              );
              candidate = proposal.candidateStatement;
              const checked = await workflow.forward(
                io.model,
                { candidateStatement: candidate, sourceText },
                decisionOptions(ctx),
              );
              evidence.push(checked);
              if (checked.supported.probability >= 0.8) {
                released = candidate;
                releases++;
                outcome = 'released';
              } else outcome = 'hold';
            }
          } catch {
            outcome = 'failed';
          }
        }
        assert.equal(outcome, expected);
        const fallbackPath = source && first <= 0.2 && first >= 0;
        assert.equal(generated, fallbackPath ? 1 : 0);
        assert.equal(io.requests.length, !source ? 0 : fallbackPath ? 2 : 1);
        assert.equal(releases, expected === 'released' ? 1 : 0);
        if (fallbackPath) {
          const [initialRequest, fallbackRequest] = io.requests;
          assert(initialRequest !== undefined && fallbackRequest !== undefined);
          assert(fallbackRequest.includes('The marker has a blue color.'));
          assert(initialRequest.includes('The marker is green.'));
          assert(!initialRequest.includes('The marker has a blue color.'));
          if (outcome === 'released') assert.equal(released, 'The marker has a blue color.');
        }
        outcomes.push({
          name,
          outcome,
          released,
          evidence,
          verifierRequests: io.requests.length,
          generationRequests: generated,
          releases,
          externalEffects: 0,
        });
      }
      return { outcomes, limitation };
    },
  },
];

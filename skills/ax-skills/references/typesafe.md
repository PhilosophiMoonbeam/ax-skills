# Typed decisions: Typesafe / Jev, OpenAI and Gemini

Use for TypeScript decision signatures, native questions, probabilities, rubric scores, evidence and explicit hybrid generation. Source API snapshot: 25.4.13. Jev-specific details include structured criteria and experimental images/Box. Select `name: 'typesafe'` for Jev (`jev-latest` by default); neither Jev nor the dedicated OpenAI/Gemini Decisions endpoints is a freeform generation or tool-use provider. Official Jev adapter/native clients also cover Python, Java, C++, Go and Rust; use each package's syntax and qualify target behavior rather than assuming universal parity.

Jev supplies observable semantic judgments → host facts/policy/effects, not direct decision authority. Compute exact arithmetic, counts, dates and lookups in code first; ask only questions whose answers feed an explicit host rule.

## Choose an interface

| Need | Interface | Result |
|---|---|---|
| Required booleans/fixed classes | `ai({ name: 'typesafe', ... })` plus `ax(...).forward()` | Ordinary signature-shaped values |
| PNG/JPEG images/localization (TypeScript) | `ax(...)` with `image` inputs and `box` outputs | Coordinates, optional evidence |
| Probabilities/confidence/rubric scores | `ax(...)` evidence fields | Typed evidence in normal results |
| Advanced structured criteria/state | Ax native client `typesafe(...).systemOne(...)` | Native request features |
| Decisions then prose/tools | Decision step then generative provider | Explicitly composed results |

`reply:string` requests unsupported freeform text. `team:class "support, billing"` returns either label. Numeric fields, even with `min`/`max`, do not define native scoring rubrics.

## Evidence, provenance, and reranking

Jev, OpenAI Decisions, Gemini Decisions, and generative providers support decision metadata through signature fields:

```text
query:string, document:string ->
  relevant:boolean(evidence, threshold 0.7),
  category:class "support, billing"(evidence),
  relevance:score "Irrelevant, Related, Partial answer, Direct answer"(evidence)
```

| Evidence | Fields |
|---|---|
| Boolean | `value`, `probability`, `threshold`, `provenance` |
| Class | `value`, complete label-to-probability map, `provenance` |
| Score | Continuous `value` from zero to final rubric index, ordered `levels`, ordered `probabilities`, `provenance` |

Native boolean/class/score results may also contain provider `confidence` when supplied (Jev Noul has none). Scores without `(evidence)` return only numeric values; existing scalar boolean/class behavior is unchanged.

Ax preserves transported native selected classes, continuous scores, probabilities, and confidence rather than recomputing them. TypeSafe documents live Choice as the highest-probability label and Score as the probability-weighted rubric index; Google and OpenAI likewise document top-choice/expected-index semantics. Synthetic fixtures deliberately supplying a different selection or score test SDK preservation, not expected inference semantics. For generative models Ax requests probabilities, derives boolean/class locally, and computes score as `sum(index * probability) / sum(probability)`. Stored probabilities remain unchanged; Ax never invents confidence.

Ax—not generated output—sets `provenance.source` (`native` or `elicited`), `provider`, and model identity. Jev/OpenAI use the response model; Gemini returns none, so Ax uses the requested model. Shared result shapes do not imply equally calibrated probabilities/confidence across providers/models. Evaluate thresholds/ranking on your data. Rubric scores are not probabilities of correctness.

For reranking, judge every query/document pair, retain application candidate IDs, and sort by `relevance.value` within one rubric/model. Processors, assertions, result selection, traces, and caches receive decoded results; streaming waits for complete evidence.

```typescript
const judge = ax(f().input('query', f.string()).input('document', f.string())
  .output('relevance', f.score(['Irrelevant', 'Related', 'Partial answer', 'Direct answer']).withEvidence())
  .build());
const result = await judge.forward(model, { query, document });
console.log(result.relevance.value, result.relevance.probabilities);
```

For a provider that returns decision refusals, `boolean(evidence, refusal return)` or another evidence field with `refusal return` returns `{status: "answered", ...evidence}` or `{status: "refused", provenance}`. Default evidence refusals raise terminal `AxDecisionRefusalError` without correction retries. OpenAI's native API has per-question refusals; its scalar adapter refusal throws an ordinary error. Jev declares no refusal variant, and Gemini HTTP safety errors cannot become a refused union through `refusal return`.

Generative providers allow nested/optional/array evidence fields. Native Jev, OpenAI Decisions and Gemini Decisions require flat required single-value outputs (only Jev includes Box); unsupported shapes fail before transport. Use direct native clients for advanced provider-specific features. Label-only examples are accepted without manufactured distributions; examples with actual evidence retain it while omitting runtime-owned result metadata from inference demonstrations.

## Boolean/class signatures and adapter restrictions

```typescript
import { ai, ax, f } from '@ax-llm/ax';

const apiKey = process.env.TYPESAFE_API_KEY ?? process.env.TYPESAFE_APIKEY;
if (!apiKey) throw new Error('Set a Typesafe API key.');
const model = ai({ name: 'typesafe', apiKey, trueThreshold: 0.9 });
const inspect = ax(`
  requestText:string ->
  replacementRequested:boolean(
    true "The writer explicitly asks to replace existing wording",
    false "The writer only quotes wording, asks for explanation, or requests no replacement"
  ) "Does the writer request replacement in requestText?",
  subject:class "wording, layout"(
    wording "Words or phrasing",
    layout "Spatial arrangement or formatting"
  ) "Which supplied subject best matches requestText?"
`);
const decision = await inspect.forward(model, {
  requestText: 'Please replace the final sentence with the shorter wording.',
});
// decision.replacementRequested: boolean; decision.subject: 'wording' | 'layout'
// These judgments do not perform or authorize an edit.
```

`trueThreshold` defaults to `0.5`, must be finite in `[0, 1]`, and converts scalar booleans on that provider instance using `noul >= trueThreshold` (equality included). Boolean evidence instead uses its field `threshold`, default `0.5`, independently of the provider threshold. These local policies are never sent to Typesafe; native Noul remains unthresholded. Choice returns its selected label without automatic confidence cutoff or abstention.

Field names/descriptions become question instructions. Boolean value descriptions map to `criteria.true`/`criteria.false`; class descriptions use exact label keys. Partial descriptions are allowed; undescribed class labels map to `null`. Duplicate/unknown keys and empty descriptions fail validation. Quote labels containing spaces/punctuation. Fluent equivalents: `f.boolean(...).describeValues({ true: '...', false: '...' })` and `f.class([...], ...).describeValues({ label: '...' })`.

Conventional providers render base descriptions plus `value: description` lines in prompt/JSON schema. Annotations survive serialization without changing inferred types/allowed values. Complete local syntax: [signatures](signature.md). Use `score` for ordered label rubrics. Structured JSON criteria/custom numeric rubric entries belong in native requests, not JSON encoded into quoted descriptions.

The adapter sends the normal Ax prompt as native state and batches outputs into one request. It supports required boolean/class/rubric score/box outputs; optional, array, nested, ordinary numeric, and freeform outputs fail before network access. PNG/JPEG image inputs are supported; audio, files, tools, multiple completion samples, and controls such as `temperature`/`maxTokens` are unsupported. No token streaming exists; `streamingForward()` can deliver a completed result. Program behavior: [Gen](gen.md); provider configuration: [AI](ai.md).

## Image inputs and Box outputs

```typescript
const vision = ai({
  name: 'typesafe', apiKey,
  config: { model: 'jev-1.14.0' },
});
const locate = ax(`
  photo:image ->
  visible:boolean "Is the red square visible in photo?",
  target:box(evidence) "The red square in photo"
`);
const result = await locate.forward(vision, {
  photo: { mimeType: 'image/png', data: imageBase64 },
});
// result.target.value: { top, bottom, left, right }, each in [0, 1]
// result.target.confidence: numeric native confidence for an accepted Jev response
// result.target.provenance.source: 'native'
```

`target:box` returns `AxBox`, just the four coordinates; `target:box(evidence)` returns `AxBoxEvidence`: `{ value: AxBox, confidence?: number, provenance }`. Fluent equivalents are `f.box(description)` / `f.box()` and `.withEvidence()`. Coordinates are normalized fractions from the image top-left: multiply left/right by width, top/bottom by height for pixels. Ax rejects non-finite/out-of-range coordinates, inverted boxes, and zero area: `top < bottom` and `left < right` are strict. It never clamps. A Box always returns a region, even if the target is absent; ask a presence boolean alongside it and use that to decide whether to consume the box. Generative providers support box arrays, optional/nested boxes, and box inputs; native Jev outputs must be flat, required, single boxes.

Jev images/Box are experimental. Ax sends `TypeSafe-Danger-Zone-Images: true` for image/Box requests. Box needs Jev 1.14 (`jev-1.14.0` or `jev-preview`); the ordinary default remains `jev-latest`.

Send still PNG/JPEG as raw base64 or matching image data URLs, never hosted URLs. Ax maps `image` and `image[]` inputs to referenced assets, retaining prompt order. Jev limits each side to 256–1568 pixels and total area to at least 78,400 pixels: 256×256 is too small. Limits also include 16 MiB per decoded image and 32 MiB per request. Prepare orientation and dimensions before calling; Ax does not resize.

Native assets use `assets: { [reference]: { type: 'image', format: 'png' | 'jpg' | 'jpeg', data_base64: string } }`. Include references in state, question instructions, or criteria. References match substrings in string values; use unique long references, preferably UUIDs. Box questions are `{ type: 'box', instructions: 'The target in photo' }`, with no criteria, returning `{ type: 'box', box: { top, bottom, left, right }, confidence }`. The client does not support multipart uploads.

**Pinned SDK versus current OpenAPI:** Ax 25.4.11 requires nonblank Box instructions, a referenced image asset, no Box criteria, and finite numeric confidence in `[0, 1]` on the native answer. The current provider OpenAPI requires only the Box question `type` and permits nullable answer confidence. Ax rejects null or missing native Box confidence even though the provider schema permits null. The generic `AxBoxEvidence.confidence?` shape does not relax this transport validation. This is a source-backed compatibility limitation, not a reproduced live failure; do not synthesize confidence or silently substitute a region. Compare the [released declarations](https://unpkg.com/@ax-llm/ax@25.4.11/index.d.ts), [released validation source map](https://unpkg.com/@ax-llm/ax@25.4.11/index.js.map), and [current OpenAPI](https://docs.typesafe.ai/api/system-one).

Generative vision providers use the same Box signature with validated JSON schema; evidence has `provenance.source: 'elicited'` and no invented confidence. Jev supplies native provenance and requires numeric native confidence in this SDK. OpenAI Decisions supports inline images for boolean/class/score questions, but has no documented native Box primitive: Ax rejects Box outputs before transport. Use a generative OpenAI vision model for Box.

**Generated-language source disagreement (25.4.10):** the Typesafe source says Image/Box signatures are available in TypeScript, Python, Java, C++, Go, and Rust, with runnable localization examples in each `src/examples/<language>/generation/` directory. The signature source instead says generated-language Box support remains in the AxIR backlog. Preserve these as conflicting claims, not universal support or universal lack of support; this tutorial establishes the TypeScript contract only. See [signature scope note](signature.md#bounding-boxes) and upstream [Images](https://docs.typesafe.ai/images) / [Box](https://docs.typesafe.ai/primitives/box) contracts.

## Native questions and application decisions

```typescript
import { typesafe, type AxAITypesafeQuestions } from '@ax-llm/ax';

const apiKey = process.env.TYPESAFE_API_KEY ?? process.env.TYPESAFE_APIKEY;
if (!apiKey) throw new Error('Set a Typesafe API key.');
const client = typesafe({ apiKey });
const candidates = {
  wording: 'Replace the final sentence with shorter wording.',
  layout: 'Move the final paragraph above the heading.',
} as const;
const questions = {
  applicable: {
    type: 'noul',
    instructions: 'Does either supplied candidate address the request in state.text?',
    criteria: {
      true: 'At least one candidate directly addresses the requested change.',
      false: 'Neither candidate addresses the requested change.',
    },
  },
  candidate: {
    type: 'choice',
    instructions: 'Which supplied candidate best addresses the request in state.text?',
    criteria: candidates,
  },
  wordingSupport: {
    type: 'score',
    instructions: 'How directly does state.text request the wording candidate?',
    criteria: ['No wording replacement requested', 'Related but not explicit', 'Explicit wording replacement requested'],
  },
} as const satisfies AxAITypesafeQuestions;
const result = await client.systemOne({
  state: { text: 'Please shorten the final sentence.' },
  questions,
});
const p = result.answers.applicable.noul;
const selected = result.answers.candidate;
// Illustrative host boundaries only, not measured recommendations.
const outcome = p <= 0.1 ? { status: 'none' as const }
  : p < 0.9 || selected.probabilities[selected.choice] < 0.9
    ? { status: 'review' as const }
    : { status: 'selected' as const, id: selected.choice, text: candidates[selected.choice] };
const support = result.answers.wordingSupport.score; // Fractional position, 0–2.
const supportOnTen = (support / 2) * 10; // Explicit host scale, not correctness.
const models = await client.listModels();
```

Keep questions inline or use `as const satisfies AxAITypesafeQuestions` for reusable definitions to preserve literal question keys/Choice labels.

- Noul returns `noul` in `[0, 1]`, with no separate confidence. Adapter `trueThreshold` does not apply to native clients.
- Choice returns `choice`, `probabilities`, `confidence`; Score returns `score`, `probabilities`, `legend`, `confidence`.
- Responses also include `model` and `usage.input_tokens`/`usage.output_tokens`.
- Choice/Score probabilities must be finite `[0, 1]` values matching criteria keys, summing to one within inclusive `0.01` tolerance. Totals `0.99` and `1.01` are accepted with floating-point summation allowance. Ax preserves probabilities without renormalizing.
- Ax 25.4.11 entries accept text, JSON objects, arrays, or `null`; nested JSON permits finite numbers/booleans, but bare numbers/booleans are invalid entries. Instructions are optional for Noul/Choice/Score; Box has the stricter requirements above. Question IDs identify answers, not instructions.
- **SDK/schema disagreement:** Ax accepts null state and null Score criteria entries; current OpenAPI excludes both, despite provider advanced prose permitting null criteria. Ax requires Score 2–10 ordered levels; current OpenAPI permits 1–10 while Score prose requires 2–10. Choice allows 1–255 in Ax and the schema. These are distinct contracts, not permission to relax SDK validation. Use concrete non-null state/levels for portable requests; do not invent singleton Choice confidence from a formula defined for multiple options.

State and question craft:
- Human test: could a person answer from this snapshot alone? Preserve attribution, relevant thread turns, corrections, negation and subject identity. Resolve known names/relationships in code. Missing, unreadable or underdetermined evidence needs a hold/clarification path, not forced certainty.
- Native state should use relevant named JSON fields, not double-serialized JSON. The Ax signature adapter instead renders its normal prompt into native state; named signature inputs do not promise raw structured-state pass-through. Empty lists convey absence and can affect answers; irrelevant fields/distractors can also change judgments. Minimize without deleting necessary context.
- Put shared context in state and question-specific context in that question. Name the subject, goal and exact source paths. Plain strings are sufficient; structured instruction content such as `description` or `examples` is application-defined JSON, not a special Ax schema.
- Ask one observable dimension per question, with true meaning yes and concrete true/false criteria that distinguish confusing cases. Avoid policy verdicts, prompt preambles and output-format chatter. Noul near `0.5` expresses uncertainty, not severity; low probability supports false and is not necessarily uncertainty. Overlapping properties need separate Nouls, not one exclusive Choice.
- Choice labels are visible to the model; native question IDs are not instructions. Give similar labels distinct descriptions. Cover plausible candidates or provide an application-valid catch-all/companion applicability Noul. Empty pools bypass inference; singleton pools still require applicability, not an invented confidence convention. A missing correct candidate cannot be recovered by Choice.
- Inspect `probabilities[choice]` independently of applicability. Jev Choice confidence transforms the maximum probability for a fixed option count; it is not corroboration or permission. For a level-specific Score rule inspect that level's probability: equal mean scores can conceal opposite distributions.
- Use one dimension per Score rubric; describe each level independently, not “more than the previous level.” Preserve fractional zero-based scores and distributions; choose normalization/rounding/weights in code.
- Each sibling question must be answerable from state and its own instructions, never another sibling answer. Scoring the chosen candidate requires a later request containing that candidate. Group only sufficient relevant shared context; split interfering contexts.
- Evaluate held-out representative inputs, adversarial/irrelevant state, negation, boundaries and option-order changes. Higher confidence after a rewrite does not prove higher accuracy; confidence describes a distribution, not correctness.

Provider guidance: [Noul](https://docs.typesafe.ai/primitives/noul), [Choice](https://docs.typesafe.ai/primitives/choice), [Score](https://docs.typesafe.ai/primitives/score), [official API types](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/types.ts).

## Atomic judgments and host policy

Jev supplies semantic judgments; code owns authoritative facts/calculations, ordered rules and effects. Keep Choice/Score and Ax decision APIs for their typed contracts, but do not bury an entire business policy in one Choice. Model-extracted values and customer claims are not system-of-record facts: verify eligibility, balances, amounts, identity and current status against authenticated records, and calculate exact comparisons in code.

- Send bounded, relevant structured context with explicit source/field paths; separate customer assertions from verified records. Batch narrow, answer-independent questions over that context. “Independent” means no answer dependencies, not statistical independence, invariance after edits or a calibration guarantee. Questions needing another answer require a later call.
- Retain raw Noul probabilities through native answers or boolean evidence. Define a host-owned three-valued policy: yes above an evaluated upper boundary, no below a lower boundary, uncertain between them, with explicit inclusive/exclusive boundaries. A scalar boolean alone cannot retain that uncertainty. Missing required facts also need an explicit unresolved outcome.
- Evaluate rules in priority order. An unresolved higher-priority condition holds before any lower-priority outcome; known false may permit the next branch. Define precedence for overlapping positives and cover every host outcome. Dispatch separately authorized effects only after policy selection, never from a judgment alone.
- Optional applicability gate: pair a forced Choice with a companion Noul asking whether any supplied option applies. Ignore the Choice when inapplicable; preserve review when applicability is uncertain. Independently gate the selected label's probability even when applicability is high: “some option applies” does not establish which one. Choice confidence alone establishes neither applicability nor correctness. Likewise, pair Box with a presence judgment and ignore its region unless presence passes policy.
- Optional speculative fan-out: ask answer-independent questions together even when only some branches will matter, then ignore irrelevant answers in code. Never let an irrelevant answer override a selected branch or authorize an effect.
- Optional composite scoring: use one Score rubric per dimension, normalize each by its own final rubric index, and apply explicit application weights in code. Preserve component scores/distributions. A weighted aggregate is an application score, not a joint-event probability; multiplying judgments does not establish one either.
- Keep privacy-aware traces with available model identity, question IDs/versions, raw probabilities, threshold/policy versions, evaluated rule IDs/order, selected/blocked outcome and fact source IDs/versions. Redact/minimize payloads and control access/retention; do not invent unavailable identities or log secrets to obtain observability.
- After changing wording, context, model, thresholds, rules or facts contracts, run targeted evaluation on representative labeled cases: uncertain boundaries, overlapping intents, missing/stale facts, inapplicable Choice, absent Box targets and effect denial. Re-evaluate affected judgments and end-to-end policy; no automatic correctness or calibration follows from decomposition.
- Keep refusal, semantic uncertainty, inapplicability, missing/stale authoritative facts and operational failure distinct. Transport/decode/validation errors are failures, never no, low confidence or inapplicability; do not zero-fill or select a fallback candidate on error. Jev declares no per-question refusal variant.

Read [Don’t Call It a Decision Model](https://typesafe.ai/blog/dont-call-it-a-decision-model), [how to build with System One](https://docs.typesafe.ai/concepts/how-to-build-with-system-one), [confidence](https://docs.typesafe.ai/confidence), and TypeSafe [patterns](https://docs.typesafe.ai/patterns) for [probability routing](https://docs.typesafe.ai/patterns/probability-routing), [speculative fan-out](https://docs.typesafe.ai/patterns/fan-out) and [composite scoring](https://docs.typesafe.ai/patterns/composite-scoring). Treat thresholds as workload-specific policies, not portable error-rate guarantees.

Selected examples: [26 architecture](../examples/26-architecture.ts), `26-architecture/evidence-aware-ticket`; [06 decisions](../examples/06-decisions.ts), `06-decisions/threshold-ownership` and `06-decisions/applicability-gate`. Read the architecture case for ordered host policy, then the decision cases for threshold ownership and applicability.

## General decision patterns

Start with the complete ordered host truth table: accepted, negative/inapplicable, unresolved/hold, and failed/unavailable. Include conflicting signals, missing evidence and equality at every evaluated boundary. Keep a separate failure path; no pattern below authorizes external effects.

| Pattern | Inputs → bounded host result | Negative, uncertain and error paths |
|---|---|---|
| Candidate selection/copy | Host-parsed, authorized values/spans plus request → applicability Noul and described Choice; resolve the returned label against the retained pool and copy only its original value | Empty pool → absence without inference; singleton still needs applicability. Negative applicability discards Choice; uncertain applicability or ambiguous selected-label probability holds. Invalid label/transport fails. Missing candidates remain missing. |
| Retrieve/filter/rerank | Deterministic retrieval, authorization and freshness filters → bounded query/document pairs; score each with one model/rubric, retain IDs and sort in code | Empty authorized pool → no match, zero calls. Top rank does not imply relevance. Apply evaluated acceptance criteria; stable ties are host policy. Incomplete/ambiguous ranking holds, failed pairs stay failed, never zero-filled. Judging cannot repair retrieval recall or authorize documents. |
| Speculative fan-out | One sufficient snapshot → multiple answer-independent fields in one Ax call; host truth table consumes only the selected branch | Ignore irrelevant speculative answers. Uncertain higher-priority conditions hold; overlapping positives follow precedence. Errors remain failures. If one answer determines new evidence/options, make a later request instead. |
| Score once/reweight/features | Fixed evidence snapshot → separate observable rubric dimensions with preserved scores/distributions; normalize by each declared range and combine in code | Missing/failed dimensions are not zero. Split distributions need explicit review policy; their midpoint is not proof of moderate intensity. Changed weights can reuse valid judgments; changed evidence/questions/rubrics/models require reassessment. A composite is a preference score, not a correctness or joint-event probability. |
| Verify/escalate/reverify | Host or generative candidate plus named supporting source → atomic support/contradiction judgments → accept, reject, hold or explicit handoff | Unsupported/contradicted candidates are rejected/handed off; missing evidence and uncertainty hold. Verification failure is operational failure. A fallback is another candidate: verify it in a later call before release; unresolved fallback stays unresolved. |
| Semantic indexing at ingest | Authorized source snapshot → bounded observable labels/rubric features stored with source, model and question versions; code indexes and queries those features | Preserve absent/uncertain/failed features, not invented negatives. Reindex affected records on source/contract changes. Query-time scope/freshness filtering and applicability still apply; ingest labels are not authoritative facts or a guarantee of recall. |
| Bounded event/UI judgment | A bounded, attributed event/window or visible UI snapshot plus explicit target → semantic flags feeding a host branch or in-memory proposal | Missing/stale snapshots hold; unrelated events are excluded. Uncertain target/presence holds; transport/decode fails separately. Exact event counts, timing and permissions stay in code. A UI label/Box never grants clicks, navigation or other effects. |

Use a separate semantic screen only before genuinely different work: larger retrieval, generation or human review. Clear no takes the defined negative path; uncertain holds; errors stay unavailable. Shared-state fan-out may avoid repeated state/round trips, but extra questions still consume work and can introduce distractors. Screening adds a serial stage for positives. Bound candidates, context and concurrency; compare observed total workload including review/errors and returned usage. Neither decomposition, indexing, caching nor screening guarantees numerical savings, latency, invoice reductions or `O(log N)` retrieval.

Offline composition cases in [`39-decision-patterns`](../examples/39-decision-patterns.ts):
- `39-decision-patterns/candidate-selection`: host-owned copy, applicability, ambiguity, empty pool and failure.
- `39-decision-patterns/speculative-truth-table`: precedence, ignored speculative answers and a true two-request dependency.
- `39-decision-patterns/rerank-and-reweight`: authorized candidates, preserved dimensions, reweighting and incomplete/split evidence.
- `39-decision-patterns/verify-escalate`: Flow verification, separate generative fallback and mandatory reverification.

These cases use synthetic injected I/O with real Ax composition, not measured model judgments.

## Ax composition and optimization

- [Flow](flow.md) orchestrates compatible required flat decision nodes and host gates; its general diagrams/signatures exceed Jev capabilities. Several output fields can share one request; several Flow branches need not. Keep generation separate. There is no `flow.optimize`; use documented top-level optimization only for compatible programs.
- [Gen caching/assertions](gen.md) receive decoded evidence. Response caching is not proof of server prompt caching, freshness, tenant isolation or automatic invalidation. Application reuse must account for evidence, questions/rubrics, model and policy/conversion semantics; do not assume every factor is in an SDK key. Reweighting stored evidence is host computation, not prompt caching.
- Assertions validate shape/hard complete-output invariants; correction loops do not verify semantics, calibrate probabilities or roll back effects. A valid middle-band result should remain unresolved, not become an assertion that forces confidence. Jev emits completed evidence, not token-time safety.
- [GEPA](gepa.md) can optimize compatible decision programs with deterministic outcome metrics and a compatible generative reflection teacher. A Jev student cannot produce freeform rationale. Keep train/tuning/held-out sets separate and evaluate host outcomes too. Optimization changes exposed program components, not host facts, policy, approval or Jev weights; it does not imply calibration or improvement.
- [Playbook](playbook.md) lessons are guidance, not authoritative facts/policy. Student signatures must be supported; reflection/curation requires generative capability. Online lessons change instructions and require explicit evaluation, not self-approval.
- [Refinement in Gen](gen.md) is complementary, not a Jev native multi-sampling recipe. Jev rejects multiple completions; AxGen `auto` selects native samples, so it is not a safe Jev default. Serial attempts are different and need evaluation. Generated advice requires compatible `feedbackAI` and exposed instruction components; advice application may otherwise be absent. Reward/early stopping is preference, not hard acceptance; account for feedback usage separately. Prefer selection when host candidates already exist.

### Feedback data flywheel

Decision models can participate in feedback-driven improvement without generating prose or changing their weights. Improve the decision program and its evidence separately from model training. A fixed Jev version may produce better application outcomes after these changes; neither Ax nor additional feedback guarantees improvement.

| Layer | Improvement path | Boundary |
|---|---|---|
| Evidence/state and candidate coverage | Repair attribution, retrieval, missing facts and candidate selection | Application data/code changes; instruction search cannot supply unavailable facts. |
| Instructions/descriptions | GEPA searches exposed optimizable string components of a compatible Ax program | Use a generative teacher; native criteria/request fields are not automatically optimization parameters. |
| Few-shot demonstrations | Curate labeled examples or use compatible bootstrap output | Inference context, not weight training; do not manufacture probabilities/confidence for label-only examples. |
| Reusable task guidance | Playbook reflection/curation proposes lessons from feedback | Lessons change context/instructions, not authoritative facts, permissions or policy. |
| Host interpretation | Evaluate thresholds, abstention, ranking weights and escalation rules | Application-owned tuning, not an automatic GEPA update or proof of calibrated probabilities. |
| Underlying Jev weights | Requires a separately supported model-training mechanism | Ax prompt/demo/playbook optimization does not retrain the hosted model. Do not assume provider fine-tuning exists. |

**Compatible optimizer path.** Use an Ax decision program as the GEPA student and an explicitly generative `teacherAI` for reflection/proposals. Failures can be scored from input, bounded prediction, reference label and verified feedback; no student rationale or chain-of-thought output is required. Keep Jev outputs supported and `sampleCount: 1`. A plain native `systemOne` request object is not itself an optimizable program. Check `getOptimizableComponents()` and the actual generated request: only exposed changes that reach inference can affect behavior. Confirm bootstrap demonstrations fit the signature, or disable bootstrap rather than adding unsupported freeform outputs. See [GEPA contracts and budgets](gepa.md).

**Recommended lifecycle:**

1. **Collect permissioned evidence.** Retain the input state and candidates available at decision time, question/rubric and program versions, requested/returned model identity where available, prediction/native distributions, host action and later feedback/outcome. Bound retention and access; minimize/redact before storage or transmission to a reflection teacher. Do not reconstruct historical inputs using facts learned afterward.
2. **Establish labels.** Distinguish verified semantic corrections, user preferences and downstream outcomes. An override, click, accepted suggestion or absence of complaint is not automatically ground truth. Scope preferences to the appropriate user/tenant; do not silently turn one user's feedback into a global rule. Treat feedback as untrusted data, not instructions that can change authority.
3. **Curate representative datasets.** Include negatives, abstentions, errors, disagreements and important slices. Reviewing only uncertain/rejected cases creates selection bias; audit some confident/accepted decisions too. Deduplicate related examples and isolate train, tuning/selection validation and final held-out sets, using entity/tenant/time separation where needed to prevent leakage. Record label provenance and unresolved ambiguity rather than forcing a label.
4. **Propose bounded changes.** Repair evidence or decomposition first when those caused failure; otherwise try instructions/demos, playbook lessons or separately owned policy tuning. Recurrent verified failure clusters can suggest new semantic attributes or features, but evaluate each new judgment as a new capability. Bound student, teacher, bootstrap and metric costs separately: `maxMetricCalls` is not a total model-call or monetary budget.
5. **Compare with the current baseline.** Evaluate semantic correctness and final host outcomes under comparable datasets/model/settings. Measure false positives/negatives, precision/coverage, abstention/review burden, important-slice regressions and observed cost/latency as relevant. If using probabilities, evaluate calibration separately. Set acceptance constraints from application failure costs; do not reward higher confidence, synthetic probabilities or aggregate accuracy alone. Tuning validation selects candidates; reserve final held-out data for a release check, not candidate selection.
6. **Approve, version and monitor.** Persist the selected Ax optimization/playbook artifact plus dataset, metric, model, state/question and policy versions; deploy an explicitly accepted version and retain rollback. Monitor drift and re-evaluate affected behavior after changes, including moving model aliases. Feedback or a teacher proposal does not approve itself; retain the current version when evaluation fails.

Start with periodic offline optimization and explicit artifact promotion. [Online playbook updates](playbook.md#online-feedback) are another adaptation mechanism, not an automatic held-out improvement gate: evaluate a candidate snapshot before applying it to the production program. Keep tenant scope, hard policy and effect authorization outside learned lessons. Ordinary inference does not make the hosted model learn from application users automatically.

### Evaluation and operating boundaries

Measure individual semantic labels and final host outcomes on held-out representative data, including negatives, absent candidates, overlap/precedence, missing/stale facts, paraphrase/negation, source mismatch, option reorder, empty lists, distractors, quoted instructions, adversarial content and split distributions. Separate tuning from final evaluation. Inspect calibration on the actual workload; choose thresholds by precision/coverage and action/review/error costs, not a universal default. Raising a threshold can change coverage without proving correctness; do not tune to synthetic fixture probabilities.

Debug in order: actual payload → state sufficiency/attribution → candidate coverage → decomposition → wording. Use deterministic code for arithmetic, dates, counts and exact lookups. Limit indirection and contradictory criteria. Untrusted state can contain adversarial instructions; structured output and decomposition do not establish a security boundary. Enforce authorization, tenant isolation and effect permissions in code; minimize/redact data and traces with explicit retention/access rules.

Version evaluated state/question/rubric/model/policy contracts and reassess affected judgments when they change. Preserve actual available model identity, native distributions and usage without inventing missing data. Offline fixtures prove protocol/composition only, not accuracy, calibration, privacy, security, price or latency. Any fresh live evaluation requires separate permission, disclosed data and credential use, and an explicit budget; this guide grants none.

## Models, transport, and diagnostics

| Setting | Signature provider | Native client |
|---|---|---|
| Default model override | `config: { model: 'jev-latest' }` | `model: 'jev-latest'` |
| Per-call model override | Third `forward()` argument `{ model }` | `systemOne({ state, questions, model })` |
| Endpoint | `apiURL`, default `https://api.typesafe.ai` | Same |
| Authentication | `apiKey` or `credentialProvider` | Same; optional static `headers` |
| Transport | `options.fetch`, `timeout`, `retry`, `abortSignal` | Same; methods take a second transport-options argument, or first for `listModels()` |

`listModels()` returns native cards (`name`, `description`, `release_date`), not changes to configured Ax model aliases. Renewable credential callbacks receive `{ profile, operation, method, url }` on each attempt; operation is `chat` for inference and `models` for discovery. Native instance/per-call cancellation signals both apply.

Context limits apply both to the complete request and to each question including shared state/instructions/criteria; consult current [models](https://docs.typesafe.ai/models), not a fixed budget copied into a prompt. Ax neither silently truncates nor claims exact local token counts. Aliases can move; pin evaluated model versions where supported and re-evaluate changes. Discovery need not enumerate every accepted versioned ID; returned model identity remains diagnostic. Token usage is returned; Ax assumes no model token prices. Read [model jaggedness](https://docs.typesafe.ai/model-jaggedness): contradictory criteria, irrelevant context, option order, indirection and adversarial input can affect judgments; more context or higher confidence is not automatically better.

Adapter diagnostics use `program.getUsage()`/`program.getChatLog()`. Logs retain `providerMetadata.typesafe.answers`; direct `.chat()` responses retain the same metadata. Native calls return usage/full answers directly. No generic metadata getter or alternate forward result is needed.

## Routing and hybrid workflows

Typesafe-only balancers preserve schema-required generation for scalar signatures. Mixed pools retain normal prompting; Typesafe is eligible only if the actual request already contains a supported output schema. Incompatible requests are excluded from selection/fallbacks even with degradation enabled. Bare chat without a supported schema fails.

For prose, call a second `ax()` with a generative provider and pass explicit inputs. Ax does not automatically split `urgent:boolean, reply:string`. The architecture case passes only ticket ID and selected outcome: its prose is an outcome acknowledgement, not a guaranteed factual rationale. An evidence-based explanation would need an explicit evidence/facts handoff and separate evaluation. Agents requiring tools/code generation use a generative actor and a separate decision step; see [Agent](agent.md).

## Runnable examples and live checks

Local offline contracts: [`06-decisions`](../examples/06-decisions.ts), cases `adapter-values`, `adapter-evidence`, `native-structured`, `native-validation`, `reranking`, `typed-generation-handoff`, and `refusal-policy`; image transport and presence gates: [`07-images`](../examples/07-images.ts), cases `native-localization`, `native-assets`, `generative-localization`, and `validation-and-absence`. Gemini contracts use `06-decisions/google-gemini-decisions-evidence`, `06-decisions/google-gemini-native-multimodal`, and `06-decisions/google-gemini-native-validation`. Injected HTTP answers establish SDK contracts, not inference quality or calibration.

The four general offline cases above extend these contracts; no fixture result establishes model quality. Fresh live tests need separate permission, disclosure of transmitted data/credential use and budget approval before execution; commands below are references, not authorization.

Run in the Ax repository root; `tsx` loads `.env`:

```bash
bun run tsx src/examples/typescript/generation/typesafe.ts
bun run tsx src/examples/typescript/generation/typesafe-native.ts
bun run tsx src/examples/typescript/generation/typesafe-hybrid.ts
bun run tsx src/examples/typescript/generation/value-descriptions.ts
```

First two require `TYPESAFE_API_KEY` or `TYPESAFE_APIKEY`; last two also require `OPENAI_API_KEY` or `OPENAI_APIKEY`. [Comparison](https://github.com/ax-llm/ax/blob/main/src/examples/typescript/generation/value-descriptions.ts) uses the same described signature across providers; [native](https://github.com/ax-llm/ax/blob/main/src/examples/typescript/generation/typesafe-native.ts) covers all primitives/model discovery; [hybrid](https://github.com/ax-llm/ax/blob/main/src/examples/typescript/generation/typesafe-hybrid.ts) composes two programs. Assert response contracts in live checks, never exact model probabilities.

## Provider differences

Shared evidence shapes do not equate native APIs, probability semantics, calibration or refusal behavior.

| Contract | Typesafe / Jev | OpenAI Decisions | Gemini Decisions |
|---|---|---|---|
| Endpoint / auth | `https://api.typesafe.ai/v1/systemone`; API key or renewable credentials | `https://api.openai.com/v1/decisions`; bearer key or renewable credentials | `https://generativelanguage.googleapis.com/v1beta/decisions`; `x-goog-api-key` or renewable credentials |
| Native input / questions | Structured `state`; named Noul/Choice/Score/Box map | Text/user inline-image messages in Ax 25.4.10; ordered predicate/choice/score array | Text or multimodal blocks; named Noul/Choice/Score map |
| Evidence / refusal | Native answers; Noul has no confidence; no declared refusal variant | Native answers and per-question refusal union | Native answers with required confidence, including Noul; safety blocks are HTTP errors |
| Media | Experimental PNG/JPEG and Box under limits above | Ax 25.4.10 client: inline images; no Box/audio/files | Image/audio plus PDF/image/audio/video files; no Box |
| Usage / limits | Input/output tokens; native Choice 1–255, Score 2–10 | Full usage; Choice 2–255, Score 2–10 | Per-modality input usage, zero output tokens; native Choice/Score 2–255, signature Score 2–10 |
| Execution limits | No prose/tools/token stream; see adapter restrictions | No prose/tools/token stream; [OpenAI contract](ai.md#openai-decisions) | Developer API only; no Vertex, prose/tools/token stream/cache/thinking/Flex/Priority |

## Google Gemini Decisions

Use the dedicated `google-gemini-decisions` profile, not ordinary `google-gemini`. The default model is `gemini-decision-1`. Ax posts to `/v1beta/decisions`, batches output questions and serializes conversation roles as text, not native role authority. Boolean value descriptions become `true_description`/`false_description`; classes become named criteria with empty descriptions when omitted; scores use ordered rubrics.

```typescript
import { ai, ax, googleGeminiDecisions } from '@ax-llm/ax';

const apiKey = process.env.GOOGLE_APIKEY;
if (!apiKey) throw new Error('Set GOOGLE_APIKEY.');
const model = ai({ name: 'google-gemini-decisions', apiKey, trueThreshold: 0.9 });
const check = ax('ticket:string -> urgent:boolean(evidence, threshold 0.9) "Is a core task blocked?"');
const result = await check.forward(model, { ticket: 'Checkout is unavailable.' });

const native = await googleGeminiDecisions({ apiKey }).create({
  input: 'Checkout is unavailable.',
  questions: {
    urgent: { type: 'noul', instructions: 'Is a core task blocked?' },
    team: {
      type: 'choice', instructions: 'Which team?',
      criteria: { support: 'Usage questions', engineering: 'Broken functionality' },
    },
  },
});
// native.answers.team.choice: 'support' | 'engineering'
```

Scalar booleans use `noul >= trueThreshold`, default `0.5`, with a finite threshold in `[0, 1]`. Evidence booleans instead use their field threshold, also default `0.5`; these are local conversion policies, not native request thresholds. Native Noul remains in `[0.01, 0.99]`, so thresholds above `0.99` cannot yield true. Evaluate thresholds on labeled traffic. Google requires finite `[0, 1]` confidence on every answer, including Noul, unlike Jev Noul. Google defines confidence as top-outcome probability (`max(p, 1-p)` for Noul); high confidence can describe a confident false answer, not certainty that an action is correct.

Native `input` accepts a string, one content block or an array of blocks. Text blocks use `{ type: 'text', text }`; media blocks use `type: 'image' | 'audio' | 'video' | 'document'`, `mime_type`, and exactly one of raw base64 `data` (not a data URL) or HTTPS `uri`. Documents require `application/pdf`; other MIME prefixes must match their media type. Instructions are required non-whitespace strings or text blocks/arrays; serialize structured JSON as text rather than borrowing Jev's structured state/criteria contract. Inline media is limited to 100 MiB decoded aggregate, including at most 50 MiB PDF. Image resolution accepts `low`, `medium`, `high`, `ultra_high`; video excludes `ultra_high`; audio/documents reject resolution.

Keep questions inline or use `as const satisfies AxAIGoogleGeminiDecisionsQuestions` to retain literal names/labels. Requests require 1–1000 questions; question keys match `[A-Za-z0-9_-]{1,64}`. Choice requires 2–255 options; option keys have 1–128 Unicode code points and at most 512 UTF-8 bytes, with no edge whitespace, control characters or non-ASCII whitespace. Native Score allows 2–255 nonempty levels, while signature rubrics retain 2–10 distinct nonempty labels. The API sorts Choice keys by UTF-8 byte order, also resolving ties. Ax preserves raw native responses without reordering or renormalizing; decoded score evidence orders probabilities by numeric rubric index. Distributions must be complete, finite `[0, 1]`, and total one within inclusive `0.01` tolerance plus floating-point allowance. Scores must lie in `[0, levelCount - 1]`; legends must match criteria. Ax does not enforce selection/argmax or score/weighted-mean equality.

The adapter supports image/audio inputs and PDF, audio, image and video files. Use file `fileUri` for HTTPS/Files API URLs or `data` for base64; matching data-URL prefixes are stripped by the adapter. Generic URL context, YouTube URLs, `gs://` URIs, Box, optional/nested/array outputs, ordinary numeric/freeform outputs, tools, caching, thinking, sampling/generation controls and Flex/Priority inference are unsupported. Multiple samples are rejected (`n` must be 1). There is no token streaming; `streamingForward()` emits completed results. Safety blocks surface as HTTP errors, not per-question refusal answers: `refusal return` does not convert them to refused objects.

Native answers and per-modality usage are preserved in `providerMetadata.googleGeminiDecisions.answers` / `.usage` and existing usage/chat-log APIs. Usage requires nonnegative safe integers, zero output tokens and total tokens equal to input tokens; the endpoint bills input tokens. Modality breakdown uses text/image/audio, with video frames/PDF page images counted as image. The response has no model, so provenance uses the requested model.

Native construction accepts `apiURL` including `/v1beta`, `model`, `headers`, `apiKey` or `credentialProvider`, and transport `options`. Native `.create(request, options?)` supports fetch, timeout, retry and cancellation; instance and call signals both apply. Renewable credentials use profile `google-gemini-decisions`, operation `chat`, and override static authentication/custom headers. Bundled capability format lists are narrower than direct transport acceptance; do not treat those lists as an exhaustive media allowlist or promise router eligibility without checking the actual request.

The official contract lists signature/native clients for TypeScript, Python, Java, C++, Go and Rust. Their factories are respectively `googleGeminiDecisions`, `google_gemini_decisions`, `Ax.googleGeminiDecisions`, `axllm::google_gemini_decisions`, `axllm.GoogleGeminiDecisions`, and `google_gemini_decisions`. Generated clients use native JSON maps; TypeScript additionally infers literal question names/Choice labels. This is bounded API availability, not universal behavior parity. See [Google's Decisions API](https://aistudio.google.com/docs/decisions-api) and upstream `src/examples/typescript/generation/google-gemini-decisions.ts` / `google-gemini-decisions-native.ts`.

# Typed decisions: Typesafe / Jev, OpenAI and Gemini

Use for TypeScript decision signatures, native questions, probabilities, rubric scores, evidence and explicit hybrid generation. Source API snapshot: 25.4.10. Jev-specific details include structured criteria and experimental images/Box. Select `name: 'typesafe'` for Jev (`jev-latest` by default); neither Jev nor the dedicated OpenAI/Gemini Decisions endpoints is a freeform generation or tool-use provider. Official Jev adapter/native clients also cover Python, Java, C++, Go and Rust; use each package's syntax and qualify target behavior rather than assuming universal parity.

## Choose an interface

| Need | Interface | Result |
|---|---|---|
| Required booleans/fixed classes | `ai({ name: 'typesafe', ... })` plus `ax(...).forward()` | Ordinary signature-shaped values |
| PNG/JPEG images/localization (TypeScript) | `ax(...)` with `image` inputs and `box` outputs | Coordinates, optional evidence |
| Probabilities/confidence/rubric scores | `ax(...)` evidence fields | Typed evidence in normal results |
| Advanced structured criteria/state | `typesafe(...).systemOne(...)` | Native request features |
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
const triage = ax(`
  ticket:string ->
  urgent:boolean(
    true "Customers cannot complete a core task",
    false "A routine request or minor inconvenience"
  ) "Does this need immediate attention?",
  team:class "support, billing, engineering"(
    support "Product usage questions",
    billing "Individual invoice or charge disputes",
    engineering "Broken functionality or service outages"
  ) "Which team should investigate?"
`);
const decision = await triage.forward(model, {
  ticket: 'Checkout fails for every customer. Payments cannot complete.',
});
// decision.urgent: boolean
// decision.team: 'support' | 'billing' | 'engineering'
```

`trueThreshold` defaults to `0.5`, must be finite in `[0, 1]`, and converts scalar booleans on that provider instance using `noul >= trueThreshold` (equality included). Boolean evidence instead uses its field `threshold`, default `0.5`, independently of the provider threshold. These local policies are never sent to Typesafe; native Noul remains unthresholded. Choice returns its selected label without automatic confidence cutoff or abstention.

Field names/descriptions become question instructions. Boolean value descriptions map to `criteria.true`/`criteria.false`; class descriptions use exact label keys. Partial descriptions are allowed; undescribed class labels map to `null`. Duplicate/unknown keys and empty descriptions fail validation. Quote labels containing spaces/punctuation. Fluent equivalents: `f.boolean(...).describeValues({ true: '...', false: '...' })` and `f.class([...], ...).describeValues({ label: '...' })`.

Conventional providers render base descriptions plus `value: description` lines in prompt/JSON schema. Annotations survive serialization without changing inferred types/allowed values. Complete local syntax: [signatures](references/signature.md); original [signature resource](https://github.com/ax-llm/ax/blob/main/src/ax/skills/ax-signature.md). Use `score` for ordered label rubrics. Structured JSON criteria/custom numeric rubric entries belong in native requests, not JSON encoded into quoted descriptions.

The adapter sends the normal Ax prompt as native state and batches outputs into one request. It supports required boolean/class/rubric score/box outputs; optional, array, nested, ordinary numeric, and freeform outputs fail before network access. PNG/JPEG image inputs are supported; audio, files, tools, multiple completion samples, and controls such as `temperature`/`maxTokens` are unsupported. No token streaming exists; `streamingForward()` can deliver a completed result. Program behavior: [Gen](references/gen.md); provider configuration: [AI](references/ai.md).

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
// result.target.confidence: native confidence, when supplied
// result.target.provenance.source: 'native'
```

`target:box` returns `AxBox`, just the four coordinates; `target:box(evidence)` returns `AxBoxEvidence`: `{ value: AxBox, confidence?: number, provenance }`. Fluent equivalents are `f.box(description)` / `f.box()` and `.withEvidence()`. Coordinates are normalized fractions from the image top-left: multiply left/right by width, top/bottom by height for pixels. Ax rejects non-finite/out-of-range coordinates, inverted boxes, and zero area: `top < bottom` and `left < right` are strict. It never clamps. A Box always returns a region, even if the target is absent; ask a presence boolean alongside it and use that to decide whether to consume the box. Generative providers support box arrays, optional/nested boxes, and box inputs; native Jev outputs must be flat, required, single boxes.

Jev images/Box are experimental. Ax sends `TypeSafe-Danger-Zone-Images: true` for image/Box requests. Box needs Jev 1.14 (`jev-1.14.0` or `jev-preview`); the ordinary default remains `jev-latest`.

Send still PNG/JPEG as raw base64 or matching image data URLs, never hosted URLs. Ax maps `image` and `image[]` inputs to referenced assets, retaining prompt order. Jev limits each side to 256–1568 pixels and total area to at least 78,400 pixels: 256×256 is too small. Limits also include 16 MiB per decoded image and 32 MiB per request. Prepare orientation and dimensions before calling; Ax does not resize.

Native assets use `assets: { [reference]: { type: 'image', format: 'png' | 'jpg' | 'jpeg', data_base64: string } }`. Include references in state, question instructions, or criteria. References match substrings in string values; use unique long references, preferably UUIDs. Box questions are `{ type: 'box', instructions: 'The target in photo' }`, with no criteria, returning `{ type: 'box', box: { top, bottom, left, right }, confidence }`. The client does not support multipart uploads.

Generative vision providers use the same Box signature with validated JSON schema; evidence has `provenance.source: 'elicited'` and no invented confidence. Jev supplies native provenance and confidence when supplied. OpenAI Decisions supports inline images for boolean/class/score questions, but has no documented native Box primitive: Ax rejects Box outputs before transport. Use a generative OpenAI vision model for Box.

**Generated-language source disagreement (25.4.10):** the Typesafe source says Image/Box signatures are available in TypeScript, Python, Java, C++, Go, and Rust, with runnable localization examples in each `src/examples/<language>/generation/` directory. The signature source instead says generated-language Box support remains in the AxIR backlog. Preserve these as conflicting claims, not universal support or universal lack of support; this tutorial establishes the TypeScript contract only. See [signature scope note](references/signature.md#bounding-boxes) and upstream [Images](https://docs.typesafe.ai/images) / [Box](https://docs.typesafe.ai/primitives/box) contracts.

## Native questions and application decisions

```typescript
import { typesafe } from '@ax-llm/ax';

const apiKey = process.env.TYPESAFE_API_KEY ?? process.env.TYPESAFE_APIKEY;
if (!apiKey) throw new Error('Set a Typesafe API key.');
const client = typesafe({ apiKey });
const result = await client.systemOne({
  state: { ticket: 'Checkout fails for every customer.', recentEvents: [] },
  questions: {
    urgent: {
      type: 'noul',
      instructions: 'Does this require immediate incident response?',
      criteria: {
        true: { description: 'Core task blocked', examples: ['Cannot pay'] },
        false: 'Routine request or minor inconvenience',
      },
    },
    team: {
      type: 'choice',
      instructions: 'Which team should investigate?',
      criteria: {
        support: 'Product usage questions',
        engineering: 'Broken functionality or service outages',
      },
    },
    severity: {
      type: 'score',
      instructions: 'How severe is the customer impact?',
      criteria: ['Minor inconvenience', 'Feature impaired', 'Core task blocked'],
    },
  },
});
const escalate = result.answers.urgent.noul >= 0.9;
const team = result.answers.team.choice; // 'support' | 'engineering'
const severity = result.answers.severity.score; // Fractional values allowed, 0–2.
const severityOnTen = (severity / 2) * 10; // Explicit application scale.
const models = await client.listModels();
```

Keep questions inline or use `as const satisfies AxAITypesafeQuestions` for reusable definitions to preserve literal question keys/Choice labels.

- Noul returns `noul` in `[0, 1]`, with no separate confidence. Adapter `trueThreshold` does not apply to native clients.
- Choice returns `choice`, `probabilities`, `confidence`; Score returns `score`, `probabilities`, `legend`, `confidence`.
- Responses also include `model` and `usage.input_tokens`/`usage.output_tokens`.
- Choice/Score probabilities must be finite `[0, 1]` values matching criteria keys, summing to one within inclusive `0.01` tolerance. Totals `0.99` and `1.01` are accepted with floating-point summation allowance. Ax preserves probabilities without renormalizing.
- State, instructions, and individual criteria accept text, JSON objects, arrays, or `null`. Nested JSON accepts finite numbers/booleans; bare numbers/booleans are invalid top-level entries. Instructions are optional in Ax/native types, but provide explicit questions: keys identify answers, not instructions. Choice permits 1–255 labels; Score requires 2–10 ordered levels. `null` leaves outcomes undescribed.

Question design:
- Noul asks one clear yes/no judgment; near `0.5` means uncertainty about that judgment, not degree/severity. Use Score for degree. Overlapping flags require separate Nouls composed in code; Choice selects one exclusive outcome.
- Give similar Choice labels distinct descriptions; use an application-valid catch-all or companion applicability gate when the options do not cover all inputs.
- For a selected-label action inspect `probabilities[choice]`. Jev Choice confidence transforms the maximum probability for a fixed option count; it is not independent evidence. For a level-specific Score action inspect that level's probability: equal mean scores can conceal different distributions.
- Use one dimension per Score rubric and describe each level independently, without relying on “more than the previous level.” Preserve fractional zero-based position; explicitly choose rounding, normalization, and weighting in code.
- All questions share state. Group by relevant context and identify source paths. Structured instruction fields are application-defined; simple strings remain the default. Same-request questions cannot consume another answer; dependencies require later calls.
- Evaluate held-out representative inputs plus adversarial/irrelevant state, negation, boundaries and option-order changes. Higher confidence after a rewrite does not prove greater accuracy; confidence describes a distribution, not correctness.

Provider guidance: [Noul](https://docs.typesafe.ai/primitives/noul), [Choice](https://docs.typesafe.ai/primitives/choice), [Score](https://docs.typesafe.ai/primitives/score), [official API types](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/types.ts).

## Atomic judgments and host policy

Jev supplies semantic judgments; code owns authoritative facts/calculations, ordered rules and effects. Keep Choice/Score and Ax decision APIs for their typed contracts, but do not bury an entire business policy in one Choice. Model-extracted values and customer claims are not system-of-record facts: verify eligibility, balances, amounts, identity and current status against authenticated records, and calculate exact comparisons in code.

- Send bounded, relevant structured context with explicit source/field paths; separate customer assertions from verified records. Batch narrow, answer-independent questions over that context. “Independent” means no answer dependencies, not statistical independence, invariance after edits or a calibration guarantee. Questions needing another answer require a later call.
- Retain raw Noul probabilities through native answers or boolean evidence. Define a host-owned three-valued policy: yes above an evaluated upper boundary, no below a lower boundary, uncertain between them, with explicit inclusive/exclusive boundaries. A scalar boolean alone cannot retain that uncertainty. Missing required facts also need an explicit unresolved outcome.
- Evaluate multi-intent rules in priority order. For example: unauthorized-charge report → human/legal request → eligible refund → retention → ordinary answer. An uncertain higher-priority rule must trigger review, clarification or a defined safe hold before any lower-priority outcome; do not silently treat uncertainty as false. Dispatch authorized effects only after policy selection, separately from judgments and explanations.
- Optional applicability gate: pair a forced Choice with a companion Noul asking whether any supplied option applies. Ignore the Choice when inapplicable; preserve review when applicability is uncertain. Independently gate the selected label's probability even when applicability is high: “some option applies” does not establish which one. Choice confidence alone establishes neither applicability nor correctness. Likewise, pair Box with a presence judgment and ignore its region unless presence passes policy.
- Optional speculative fan-out: ask answer-independent questions together even when only some branches will matter, then ignore irrelevant answers in code. Never let an irrelevant answer override a selected branch or authorize an effect.
- Optional composite scoring: use one Score rubric per dimension, normalize each by its own final rubric index, and apply explicit application weights in code. Preserve component scores/distributions. A weighted aggregate is an application score, not a joint-event probability; multiplying judgments does not establish one either.
- Keep privacy-aware traces with available model identity, question IDs/versions, raw probabilities, threshold/policy versions, evaluated rule IDs/order, selected/blocked outcome and fact source IDs/versions. Redact/minimize payloads and control access/retention; do not invent unavailable identities or log secrets to obtain observability.
- After changing wording, context, model, thresholds, rules or facts contracts, run targeted evaluation on representative labeled cases: uncertain boundaries, overlapping intents, missing/stale facts, inapplicable Choice, absent Box targets and effect denial. Re-evaluate affected judgments and end-to-end policy; no automatic correctness or calibration follows from decomposition.
- Keep refusal, semantic uncertainty, inapplicability and missing/stale authoritative facts as distinct states. A refused judgment is not a low probability; unavailable facts are not negative semantic answers. Route each through explicit host policy.

Read [Don’t Call It a Decision Model](https://typesafe.ai/blog/dont-call-it-a-decision-model), [how to build with System One](https://docs.typesafe.ai/concepts/how-to-build-with-system-one), [confidence](https://docs.typesafe.ai/confidence), and TypeSafe [patterns](https://docs.typesafe.ai/patterns) for [probability routing](https://docs.typesafe.ai/patterns/probability-routing), [speculative fan-out](https://docs.typesafe.ai/patterns/fan-out) and [composite scoring](https://docs.typesafe.ai/patterns/composite-scoring). Treat thresholds as workload-specific policies, not portable error-rate guarantees.

Selected examples: [26 architecture](examples/26-architecture.ts), `26-architecture/evidence-aware-ticket`; [06 decisions](examples/06-decisions.ts), `06-decisions/threshold-ownership` and `06-decisions/applicability-gate`. Read the architecture case for ordered host policy, then the decision cases for threshold ownership and applicability.

## Models, transport, and diagnostics

| Setting | Signature provider | Native client |
|---|---|---|
| Default model override | `config: { model: 'jev-latest' }` | `model: 'jev-latest'` |
| Per-call model override | Third `forward()` argument `{ model }` | `systemOne({ state, questions, model })` |
| Endpoint | `apiURL`, default `https://api.typesafe.ai` | Same |
| Authentication | `apiKey` or `credentialProvider` | Same; optional static `headers` |
| Transport | `options.fetch`, `timeout`, `retry`, `abortSignal` | Same; methods take a second transport-options argument, or first for `listModels()` |

`listModels()` returns native cards (`name`, `description`, `release_date`), not changes to configured Ax model aliases. Renewable credential callbacks receive `{ profile, operation, method, url }` on each attempt; operation is `chat` for inference and `models` for discovery. Native instance/per-call cancellation signals both apply.

Context limits cover combined state/instructions/criteria; consult [models](https://docs.typesafe.ai/models). Ax neither silently truncates nor claims exact local token counts. Token usage is returned; Ax assumes no model token prices.

Adapter diagnostics use `program.getUsage()`/`program.getChatLog()`. Logs retain `providerMetadata.typesafe.answers`; direct `.chat()` responses retain the same metadata. Native calls return usage/full answers directly. No generic metadata getter or alternate forward result is needed.

## Routing and hybrid workflows

Typesafe-only balancers preserve schema-required generation for scalar signatures. Mixed pools retain normal prompting; Typesafe is eligible only if the actual request already contains a supported output schema. Incompatible requests are excluded from selection/fallbacks even with degradation enabled. Bare chat without a supported schema fails.

For prose, call a second `ax()` with a generative provider and pass explicit inputs. Ax does not automatically split `urgent:boolean, reply:string`. The architecture case passes only ticket ID and selected outcome: its prose is an outcome acknowledgement, not a guaranteed factual rationale. An evidence-based explanation would need an explicit evidence/facts handoff and separate evaluation. Agents requiring tools/code generation use a generative actor and a separate decision step; see [Agent](references/agent.md).

## Runnable examples and live checks

Run in the Ax repository root; `tsx` loads `.env`:

```bash
npm run tsx src/examples/typescript/generation/typesafe.ts
npm run tsx src/examples/typescript/generation/typesafe-native.ts
npm run tsx src/examples/typescript/generation/typesafe-hybrid.ts
npm run tsx src/examples/typescript/generation/value-descriptions.ts
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
| Execution limits | No prose/tools/token stream; see adapter restrictions | No prose/tools/token stream; [OpenAI contract](references/ai.md#openai-decisions) | Developer API only; no Vertex, prose/tools/token stream/cache/thinking/Flex/Priority |

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

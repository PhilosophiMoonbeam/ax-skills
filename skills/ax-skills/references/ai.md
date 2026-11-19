# AI providers, models, and runtime configuration

Use for `ai()`, deployment profiles, model catalogs/presets, routing and balancing, embeddings, thinking, service tiers, caching, cancellation, and provider-specific request contracts. Prefer short copyable code, not tutorial prose unless requested. Source API snapshot: 25.4.13. Audio task-specific detail belongs in [audio](audio.md); signature design in [signatures](signature.md); agent/runtime design is outside this reference.

## Factory and deployment profiles

```typescript
import { ai } from '@ax-llm/ax';

const openai = ai({ name: 'openai', apiKey: 'sk-...' });
const claude = ai({ name: 'anthropic', apiKey: 'sk-ant-...' });
const gemini = ai({ name: 'google-gemini', apiKey: 'AIza...' });
const azure = ai({ name: 'azure-openai', apiKey: 'your-key', resourceName: 'your-resource', deploymentName: 'gpt-5-4-mini' });
const deepseek = ai({ name: 'deepseek', apiKey: 'sk-...' });
const mistral = ai({ name: 'mistral', apiKey: 'your-key' });
const cohere = ai({ name: 'cohere', apiKey: 'your-key' });
const custom = ai({
  name: 'openai-compatible',
  apiKey: process.env.PROVIDER_API_KEY,
  apiURL: 'https://example.com/v1',
  config: { model: 'provider/model-name' },
});
const reka = ai({ name: 'reka', apiKey: 'your-key' });
const grok = ai({ name: 'grok', apiKey: 'your-key' });
```

`name` selects a deployment profile; `config.model` selects a model inside that deployment. Never infer provider behavior from a model ID. For example, `name: 'together'` with a `deepseek-ai/...` model uses Together's profile rules, not DeepSeek's native request shape.

Use `axAIProfiles()` to discover the complete named catalog and `axGetAIProfile(name)` to inspect endpoint requirements, authentication, operations, capabilities, model rules, sources, and review dates. Use `name: 'openai-compatible'` plus `apiURL` for an unlisted custom endpoint; unknown names are errors.

Profile-only branded classes were removed in the major-version migration. Use `ai({ name: ... })` for Azure OpenAI, Cohere, DeepSeek, DeepSeek Responses, Mistral, Reka, and Grok. Retained low-level classes represent genuine transports/runtimes only; legacy model enum and catalog exports remain usable.

For Bedrock GPT deployments, choose the transport before selecting tools or structured output: the `amazon-bedrock` Chat Completions profile, OpenAI Responses routes, and native AWS `Converse` have different contracts. See [AWS Bedrock](#aws-bedrock) for verified model IDs, native schemas, reasoning/tool constraints, and service tiers.

Use `ai()` for standard providers, never `new AxAIOpenAI(...)` or hardcoded branded constructors. `axAIProfiles()` is authoritative for names: `openai`, `openai-compatible`, `openai-responses`, `anthropic`, `google-gemini`, `azure-openai`, `deepseek`, `meta`, `meta-chat`, `meta-messages`, `mistral`, `cohere`, `grok`, routers `together`, `openrouter`, `orcarouter`, hosted inference profiles, and configurable local runtimes. Azure requires both `resourceName` and `deploymentName`. Do not mix `thinkingTokenBudget` with explicit `temperature` on Anthropic thinking models: adaptive models omit `temperature`, `topP`, and `topK`; older thinking models ignore `temperature` and `topK`, and send `topP` only at >= 0.95. See the detailed sampling rules below for the source's explicit-value exceptions. Do not invent Meta image, file, model-listing, or response-lifecycle methods: Muse Image uses `chat()`, Voice uses `transcribe()` or realtime `chat()`, and inline data/URLs use normal chat content.

## Typesafe / Jev (TypeScript)

For focused semantic judgments rather than freeform generation, start with [Typesafe/Jev](typesafe.md); it covers question design, rich criteria, native scoring, transport settings and hybrid composition. Original resource: https://github.com/ax-llm/ax/blob/main/src/ax/skills/ax-typesafe.md. Choose the interface by output contract:

| Need | Interface |
|---|---|
| Required boolean/class/rubric score outputs through Ax signatures | `ai({ name: 'typesafe', apiKey, trueThreshold: 0.9 })` and `ax(...).forward()` |
| Explicit provider request shapes or structured state/criteria | `typesafe({ apiKey }).systemOne({ state, questions })` |

Use `.withEvidence()` on boolean/class fields or `f.score(levels).withEvidence()` to retain probabilities, native scores, and supplied confidence through normal AxGen outputs. String forms use `(evidence)`. See [decision evidence and reranking](typesafe.md#evidence-provenance-and-reranking) and the compact [provider differences](typesafe.md#provider-differences) matrix for Jev, OpenAI Decisions and Gemini Decisions; their native APIs and refusal/media contracts are not interchangeable.

Both default to `jev-latest`. Set the adapter's model with `config.model`; set native defaults with `model`. Native `listModels()` retrieves the provider's catalog without changing configured Ax model aliases.

Scalar boolean conversion uses `noul >= trueThreshold`; the default is `0.5`, and the finite threshold must be in `[0, 1]`. It applies to scalar booleans on that provider instance. Boolean evidence uses its field threshold, default `0.5`, independently of the provider threshold. Neither local policy is sent to the server; native Noul remains unthresholded. Choice preserves the selected label without an automatic confidence cutoff. For ordered rules and uncertainty handling, read [Atomic judgments and host policy](typesafe.md#atomic-judgments-and-host-policy).

Value descriptions from `boolean(true "...", false "...")` and `class "support, billing"(support "...", billing "...")` become native criteria. The same annotations render as readable descriptions for conventional providers. See [signatures](signature.md) for string and fluent `.describeValues(...)` forms. Original resource: https://github.com/ax-llm/ax/blob/main/src/ax/skills/ax-signature.md.

Numeric outputs, including bounded numbers, are unsupported; scoring uses explicit `score` rubrics in signatures. Required single `box` outputs and PNG/JPEG image inputs are supported in TypeScript; see [Typesafe image and Box contracts](typesafe.md) for exact model, image, and localization requirements. Freeform text, optional/array/nested outputs, audio, files, tools, and sampling controls remain unsupported. Ax sends its normal prompt as state. Use a separate generative program for prose or tools.

The dedicated Typesafe contract and exact implementation support this narrow image/Box exception despite the official provider summary's stale blanket media exclusion.

Typesafe-only balancers retain schema-required generation. Mixed pools select Typesafe only when the actual request already contains a supported schema. Incompatible requests are excluded from fallbacks even with degradation enabled. Usage and raw adapter answers remain in the existing usage and chat-log APIs. Python, Java, C++, Go, and Rust also implement these interfaces. Use each generated package's native API syntax.

## Renewable Credentials

Use `credentialProvider` for expiring bearer tokens. The callback runs for each request attempt and receives `{ profile, operation, method, url }`. Fresh headers override static authentication headers.

```typescript
const vertex = ai({
  name: 'vertex-ai',
  apiURL: process.env.VERTEX_AI_API_URL!,
  config: { model: 'google/gemma-4-26b-a4b-it-maas' },
  credentialProvider: async ({ operation, url }) => ({
    Authorization: `Bearer ${await tokenSource.fresh({ operation, url })}`,
  }),
});
```

- Authentication-required profiles accept `apiKey` or `credentialProvider`.
- The hook covers chat, stream, embeddings, Responses, transcription, speech,
  and retry attempts. A hook error stops before transport.
- Do not expect an automatic replay after a completed 401 or 403; generation
  requests are not safely idempotent.
- Keep ADC or cloud-SDK dependencies in the host. Ax core only owns the neutral
  callback contract.

Vertex capability rules are model-aware. Documented Gemini MaaS IDs prefer native schema. The exact `google/gemma-4-26b-a4b-it-maas` rule prefers `json_object`, excludes native schema, defaults thinking to `max`, writes `chat_template_kwargs.enable_thinking`, and extracts/replays `reasoning_content`. Unknown Vertex models remain conservative.

WebLLM is browser-only and requires a host-created WebLLM engine. The host loads or reloads models with WebLLM APIs such as `CreateMLCEngine(...)`; Ax only forwards chat requests to that loaded engine. Do not present WebLLM as a portable AxIR provider or a server-side default.

```typescript
import { ai, AxAIWebLLMModel } from '@ax-llm/ax';

const engine = await CreateMLCEngine(AxAIWebLLMModel.Llama32_3B_Instruct);
const llm = ai({
  name: 'webllm',
  engine,
  config: {
    model: AxAIWebLLMModel.Llama32_3B_Instruct,
    stream: false,
    supportsFunctions: false,
  },
});
```

### Chrome Built-in AI (TypeScript/JavaScript only)

The `chrome-ai` provider calls Chrome's browser `LanguageModel` API and runs Gemini Nano locally without an API key. It is available only to the TypeScript/JavaScript package inside Chrome, not to Node.js or the generated Python, Java, C++, Go, and Rust packages. It has a browser-only AxIR exemption; do not add it to portable provider catalogs or migration backlogs.

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({ name: 'chrome-ai' });
const program = ax('question -> answer');
// Call from a user interaction in a supported Chrome browser.
const result = await program.forward(llm, { question: 'What is 2+2?' });
```

The default uses Chrome's sampling settings. Chrome extensions can specify `temperature` and `topK` together; when only one is supplied, Ax obtains the other from `LanguageModel.params()`. An incomplete pair without defaults fails before session creation. Web pages do not support these legacy numeric settings. Streaming chunks contain successive text and are passed through unchanged. Ax releases each session on completion, cancellation, or failure. The adapter supports native JSON Schema output and text conversations, with no tools or embeddings. For a runnable browser demo, build Ax and open `src/examples/chrome-ai-chat.html` through a local web server.

The local [browser entry](../examples/browser/chrome-ai.html) uses the same public imports; [adapter fixtures](../examples/33-browser-ai.ts) separately verify wire conversion and session cleanup. Build with `bun run --no-env-file --cwd examples build:browser`, serve the browser directory over localhost, and check Chrome's current desktop/hardware/model prerequisites. Fixture success is not local-model inference.

## Model Presets

```typescript
import { ai, AxAIGoogleGeminiModel } from '@ax-llm/ax';

const gemini = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.Gemini38Flash },
  models: [
    { key: 'tiny', model: AxAIGoogleGeminiModel.Gemini35FlashLite, description: 'Fast + cheap', modelConfig: { maxTokens: 1024 } },
    { key: 'simple', model: AxAIGoogleGeminiModel.Gemini38Flash, description: 'Balanced' },
  ],
});

await gemini.chat({ model: 'tiny', chatPrompt: [{ role: 'user', content: 'Hi' }] });
```

`config.model` names the provider's default model. Use preset keys such as `'tiny'` or `'simple'` in per-call `model` overrides; preset settings belong in `modelConfig`.

## Model Catalog

```typescript
import { axGetSupportedAIModels } from '@ax-llm/ax';

const providers = axGetSupportedAIModels();
const openai = providers.find((provider) => provider.name === 'openai');
console.log(openai?.models[0]?.promptTokenCostPer1M);
console.log(openai?.capabilities.serviceTiers);

const reasoningModel = openai?.models.find(
  (model) => model.capabilities.thinkingLevels.includes('high')
);
console.log(reasoningModel?.capabilities.thinkingLevels);

const textProviders = axGetSupportedAIModels({ type: 'text' });
const embeddingProviders = axGetSupportedAIModels({ type: 'embeddings' });
```

Use `axGetSupportedAIModels()` to build provider/model selectors before creating an `ai(...)` instance. It returns bundled static metadata: provider names, display names, default models, raw `AxModelInfo` pricing/details, model type (`'text'`, `'embeddings'`, `'code'`, `'audio'`, or `'image'`), operation availability, provider-training data use, and normalized capabilities for thinking, thoughts, structured outputs, audio, image output, temperature, top-p, portable thinking levels, and verified service tiers. Provider capabilities describe the default deployment profile; each static model also carries its resolved `capabilities.thinkingLevels` and `capabilities.serviceTiers`. Portable thinking levels can collapse onto the same provider-native value. `serviceTiers` lists verified explicit tiers; `serviceTier: 'auto'` remains available as the provider-delegated policy.

Provider groups and models are sorted cheapest to most expensive based on bundled input + output token pricing; unpriced models sort last. Dynamic profiles remain useful even when `models` is empty because their provider-level capability metadata is still returned.

Filter with `{ type: 'all' | 'text' | 'embeddings' | 'code' | 'audio' | 'image' }` or an array of those values. The `'text'` filter includes code-capable models; use `'code'` to show only code-first models.

Dynamic providers such as Azure OpenAI deployments are marked with `isDynamic: true` and may have an empty or static-limited model list.

The same AxIR-backed catalog is public in every generated package: Python `get_supported_ai_models()`, Java `Ax.getSupportedAIModels()`, C++ `get_supported_ai_models()`, Go `GetSupportedAIModels(...)`, and Rust `get_supported_ai_models()` (with `get_supported_ai_models_with_options(...)` for filters). It includes the named OpenAI-compatible profiles accepted by `ai(...)`, including `azure-openai`, `openrouter`, `together`, `fireworks`, and the explicit `openai-compatible` fallback. These entries are usually dynamic, so inspect provider-level `capabilities` even when `models` is empty.

## Portable Inference Service Tiers

Use the shared `serviceTier` option with `auto`, `standard`, `flex`, or `priority`. Set it per call, as an instance option, or on a model-key preset; the narrower setting wins. `auto` delegates to the provider and is omitted when that provider has no explicit auto value. Ax rejects unsupported explicit tiers before transport.

```typescript
import { ai, AxAIGoogleGeminiModel } from '@ax-llm/ax';

const gemini = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.Gemini35Flash },
});

const response = await gemini.chat(
  { chatPrompt: [{ role: 'user', content: 'Run this when capacity is free.' }] },
  { serviceTier: 'flex' },
);
```

Inspect `ai.getFeatures(model).serviceTiers` for the verified tiers on a named profile or exact model. Named OpenAI, Gemini, Azure, Bedrock, Mistral, Groq, OpenRouter, DeepInfra, Cerebras, Grok, Databricks, and Fireworks profiles map the portable value to their provider dialect. Exact `modelInfo.supported` metadata can opt a conservative custom deployment into a tier.

The applied provider value is normalized into `response.modelUsage.tokens.serviceTier`; aliases such as `default`, `on_demand`, and `performance` become `standard` or `priority`. Add `serviceTierPricing.flex` or `.priority` to `AxModelInfo` when tier pricing differs, and cost estimates will use the tier that actually served the request. Gemini service tiers remain GenerateContent-only: Vertex AI and Gemini Live reject explicit tiers. Anthropic `speed: 'fast'` remains a separate API.

## Routing And Balancing

Choose the primitive by responsibility:

- `AxMultiServiceRouter` combines model lists and dispatches the model key the caller already selected. It does not select a model.
- `AxProviderRouter` selects a provider by request capability and may degrade unsupported media through configured processors. When the selected provider supports images natively, each image remains an image object with its payload, MIME type, detail level, cache and optimization hints, alt text, and ordering with surrounding text intact.
- `AxBalancer` without a strategy orders equivalent services once with a comparator, retries transient provider failures, and fails over in that order.
- `AxBalancer` with `strategy.type: 'adaptive'` selects among services exposing the same logical model aliases using learned provider reliability, successful latency, and estimated cost.

In TypeScript, `capabilities.requiresAudioOutput` or `modelConfig.audio.output.enabled` requires a service with `media.audio.output.supported`. Audio input and output are separate requirements. Balancer output formats come only from children that support output; compatibility reports count requested input and output independently.

Generated provider routers expose `get_compatibility_report` (Python, C++, Rust), `GetCompatibilityReport` (Go), and `getCompatibilityReport` (Java). Reports count requested audio input and output independently and include ranked provider names, scores, missing/supported capabilities, and a summary for request-compatible providers. These are capability-compatibility scores, not semantic-quality evaluations.

[PR #862](https://github.com/ax-llm/ax/pull/862) records historical generated-provider coverage for independent audio input/output routing, output-format unions restricted to output-capable children, and separate counts in native compatibility reports. It does not establish coverage for unrelated capabilities such as Jev image/Box.

Adaptive balancing is operational routing, not semantic prompt-to-model routing. Every provider model behind an alias must be an acceptable substitute for that application. Keep quality evaluation and content-aware model selection outside the balancer.

```typescript
import { AxBalancer, AxInMemoryBalancerStatsStore } from '@ax-llm/ax';

const statsStore = new AxInMemoryBalancerStatsStore();
const routeKeys = new Map<string, string>([
  [openai.getId(), 'openai-primary'],
  [anthropic.getId(), 'anthropic-primary'],
]);

const llm = AxBalancer.create([openai, anthropic] as const, {
  strategy: {
    type: 'adaptive',
    deadlineMs: 6_000,
    badOutcomeCost: 0.02,
    expectedTokens: { promptTokens: 1_200, completionTokens: 300 },
    namespace: 'support-v1',
    routeKey: (service) => {
      const key = routeKeys.get(service.getId());
      if (!key) throw new Error('Missing stable route key.');
      return key;
    },
    slice: ({ options }) =>
      options?.customLabels?.workflow ?? 'default-workflow',
    statsStore,
    onRoutingEvent: (event) => telemetry.emit('llm.route', event),
  },
});
```

The score is estimated request cost plus `badOutcomeCost` times the probability of provider failure or missing `deadlineMs`. `badOutcomeCost` and estimated cost must use the same currency or unit. By default, cost uses `expectedTokens`, the route's concrete model mapping, and `getEstimatedCost()`; missing catalog pricing contributes zero, while `estimateCost` can supply application pricing. Failures use an EWMA; successful latency is modeled in log space with a Normal-Inverse-Gamma posterior, and Thompson sampling supplies the deadline risk. Capability filtering still runs before ranking.

Rules:

- Reuse the in-memory store across balancers in one process. For multiple processes, implement `AxBalancerStatsStore` with Redis or an application database; its `observe()` operation must be atomic.
- A custom store requires stable, unique `routeKey` values. Stats are partitioned by `namespace`, `slice`, logical model, and route.
- `statsStore` is decision state. `onRoutingEvent` is best-effort telemetry and must not be used as the authoritative routing state.
- Routing events contain scores, route metadata, and sanitized failure categories, never prompts, responses, or raw provider errors.
- Adaptive mode attempts each candidate once. Provider-client retries remain controlled by `AxAIServiceOptions.retry`.
- Streaming can fail over before the first emitted chunk. A mid-stream transient failure is learned but cannot be replayed after partial output; caller cancellation is not recorded.
- Adaptive selection applies to chat. Embedding, transcription, and speech keep existing balancer behavior.

Do not infer batch `speak()` / `transcribe()` failover from chat routing. In the pinned [spoken-assistant control](../examples/26-architecture.ts), primary batch failures propagate; the application explicitly selects an alternate. This is separate from conversational chat fallback before output starts.

See the [adaptive balancer example](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/typescript/generation/adaptive-balancer.ts) for complete provider setup.

## Generated Runtime Cancellation

Generated Python, Java, C++, and Rust packages expose a reusable `AxCancellationToken`; Go keeps its idiomatic `context.Context` API. Pass the token/context to chat, streaming, embeddings, transcription, speech, or `AxGen`/`AxAgent`/`AxFlow` forwarding. The same cancellation propagates through provider routers, multi-service routing, balancers, retries, and cancellation-aware custom transports.

Cancellation is thread-safe, one-shot, and first-reason-wins. It stops before a new transport attempt, wakes retry backoff, and terminates an active stream at the next blocking-I/O boundary. The surfaced error is always the non-retryable `AxAIServiceAbortedError`, so routers and balancers must not retry or fail over. Existing methods remain available; use the added cancellation variants/options when cancellation is needed. Realtime WebSocket turns retain their separate lifecycle.

## Chat

```typescript
const res = await llm.chat({
  chatPrompt: [
    { role: 'system', content: 'You are concise.' },
    { role: 'user', content: 'Write a haiku about the ocean.' },
  ],
}, { stream: false });
if (!('results' in res)) throw new Error('Expected a non-streaming chat response');
console.log(res.results[0]?.content);
```

Raw `chat()` streams by default; choose the response mode explicitly before consuming it. The [raw chat example](../examples/04-providers.ts) drains the default stream and separately validates a completed response.

## Meta Muse

Use `meta` for the Responses API (the recommended default), `meta-chat` for Chat Completions, or `meta-messages` for Anthropic-compatible Messages. All three use `MODEL_API_KEY`; `muse-spark-1.3` is the default model.

```typescript
import { ai, AxAIMetaModel } from '@ax-llm/ax';

const muse = ai({
  name: 'meta',
  apiKey: process.env.MODEL_API_KEY!,
  config: { model: AxAIMetaModel.MuseSpark13 },
});

const result = await muse.chat({
  chatPrompt: [{ role: 'user', content: 'Summarize the attached brief.' }],
});
```

`thinkingTokenBudget: 'highest'` maps to Meta `xhigh`; `none` is rejected. Responses reasoning IDs, summaries, encrypted content, and message phases are retained in Ax chat memory so stateless multi-turn replay works. Streaming Ax programs also retain the final-answer phase. Responses failure events raise errors; token-limited streams are not accepted as completed program output. Generated Responses clients retain parallel tool calls and their provider call IDs, and completion events do not repeat text or arguments already streamed. Assistant turns containing only generated images or encrypted reasoning can be replayed without adding placeholder text.

All three Spark profiles support function-based structured output. When Ax selects its internal `__axOutput` tool, the profiles require that sole tool using the protocol's unnamed required choice. Explicit caller-named choices remain unsupported, including a caller naming `__axOutput` directly.

Use `muse-image-1.0` through the same `chat()` method. Text and reference images belong in normal chat content, and generated images arrive in `result.results[0].images`. Muse Image rejects ordinary function tools. Use `transcribe()` for Muse Voice batch audio and streaming `chat()` with PCM16 for realtime transcription; Ax adds no Meta-specific service methods.

The [generated-image case](../examples/04-providers.ts) consumes `AxChatImageOutput` with `stream: false` and retains its opaque provider image ID for stateless replay. Its valid PNG is an explicit transport fixture, not live image synthesis or localization evidence.

Muse Glimmer is self-hosted. Point Ax's `vllm`, `llama-cpp`, `ollama`, or `lm-studio` profile at the server you operate. Ax does not download, serve, or manage Glimmer weights.

## Batch audio

Use `ai.transcribe(...)` for batch speech-to-text and `ai.speak(...)` for batch text-to-speech. These are separate from conversational `.chat()` audio config.

```typescript
const transcript = await llm.transcribe({
  audio: { data: base64Wav, format: 'wav' },
  model: 'gpt-4o-mini-transcribe',
  language: 'en',
});

const speech = await llm.speak({
  text: transcript.text,
  model: 'gpt-4o-mini-tts',
  voice: 'alloy',
  format: 'mp3',
});

console.log(transcript.text);
console.log(speech.data);
```

Gemini's defaults are `gemini-3.8-flash-tts` for `speak()` and the dedicated `gemini-3.5-transcribe` model for `transcribe()`. Gemini takes no output format, so the returned mime type sets the label: 3.8 TTS returns WAV, while earlier TTS models return raw 24 kHz PCM, reported as `pcm16` with its `sampleRate` and `channels`.

```typescript
const gemini = ai({ name: 'google-gemini', apiKey: process.env.GOOGLE_APIKEY! });
const speech = await gemini.speak({ text: 'Hello from Ax.', voice: 'Kore' });
const heard = await gemini.transcribe({
  audio: { data: speech.data, format: speech.format },
});
```

Providers without the requested audio endpoint throw `AxMediaNotSupportedError`. Use `speech` forward options for signature audio artifacts and `modelConfig.audio` for conversational chat audio. See [audio](audio.md) for task-specific signature, voice, format, and realtime contracts.

## Common Options

- `stream` (boolean): enable SSE; true by default
- `thinkingTokenBudget`: `'minimal'` | `'low'` | `'medium'` | `'high'` | `'highest'` | `'none'`
- `showThoughts`: include thoughts in output
- `functionCallMode`: `'auto'` | `'native'` | `'prompt'`
- `debug`, `logger`, `tracer`, `rateLimiter`, `timeout`
- `timeout`, `fetch` and `corsProxy` given to one `chat()` or `embed()` call override the service's own
- `timeout` is in milliseconds and bounds the wait for the response headers: a request whose response has not started in time fails with `AxAIServiceTimeoutError`, and a stream that has started runs on

## Sampling Parameters

Each provider starts from its own defaults: `temperature: 0` for OpenAI Chat, Anthropic and Gemini, and `temperature: 0.7` with `topP: 1` for `openai-responses`. Model info lists the sampling parameters a model rejects (`notSupported`: `temperature`, `topP`, `topK`, `presencePenalty`, `frequencyPenalty`):

- A provider default for such a parameter is never sent.
- An explicit value is sent when the model accepts it for that request, and
  otherwise dropped with a one-time `console.warn` naming the setting and the
  model. Explicit values come from the AI's `config`, a model key's
  `modelConfig`, or the request's `modelConfig`.
- Models whose info sets `supported.temperatureOne` still take an explicit
  `temperature: 1`: every OpenAI model below, and the Anthropic models that
  deprecated sampling.
- GPT-5.1 to 5.4 take sampling while they don't reason, which is their
  default. GPT-5.5 and 5.6 take it only with reasoning effort `none`
  (`thinkingTokenBudget: 'none'`, or `reasoningEffort: 'none'` in the
  config). gpt-5, gpt-5-mini, gpt-5-nano and the o-series never take it; the
  o-series still get `maxTokens` and `n`.
- A profile without model info (`azure-openai`, `openai-compatible`, ...)
  uses OpenAI's info for an exact o-series model name.
- Anthropic: Opus 4.7 and later, Opus 5, Fable 5 and Sonnet 5 deprecated
  sampling, so they take only `temperature: 1` (no `topP` or `topK`). The
  other Claude models take every value with thinking off; while thinking,
  only `temperature: 1`, `topP` of 0.95 or above, and no `topK`. They reject
  `temperature` and `topP` together (`notSupported.temperatureWithTopP`): an
  explicit `topP` goes alone in place of the default temperature, and an
  explicit `temperature` wins over it with a warning. The default
  `temperature: 0` is sent only without thinking, as before. Claude on Vertex
  keeps that older rule for explicit values too, and warns about a drop.
- Gemini: the server-managed Flash models ignore `temperature`, `topP` and
  `topK`; the Gemini API rejects `presencePenalty` and `frequencyPenalty`.
  Gemini 3 returns one candidate, so `n` above 1 is dropped (AxGen then gets
  one sample), and Ax raises a temperature below 1 to 1, as Google recommends,
  with a one-time warning for an explicit value. Vertex keeps its request
  shape; `presencePenalty` is never sent to Gemini and is warned about.

```typescript
import { ai, AxAIOpenAIModel } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey, config: { model: AxAIOpenAIModel.GPT6Luna } });
// GPT-6 Luna takes temperature with reasoning off, so this one is sent.
await gen.forward(llm, values, {
  thinkingTokenBudget: 'none',
  modelConfig: { temperature: 0.2 },
});
```

A profile without a base URL of its own (`openai-compatible`, `databricks`, `amazon-bedrock`, `vertex-ai`, ...) needs `apiURL`: `ai(...)` throws `<Name> requires apiURL` without it.

## Global Runtime Defaults

Use `axGlobals` when the app wants one live default for AI requests, generator runs, flows, or metrics:

```typescript
import { ai, axGlobals, axCreateDefaultColorLogger } from '@ax-llm/ax';
import { metrics, trace } from '@opentelemetry/api';

axGlobals.rateLimiter = async (next, info) => next();
axGlobals.tracer = trace.getTracer('my-app');
axGlobals.meter = metrics.getMeter('my-app');
axGlobals.debug = true;
axGlobals.logger = axCreateDefaultColorLogger();
axGlobals.customLabels = { service: 'api' };
axGlobals.onUsage = (event) => usageQueue.enqueue(event);

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });
```

Rules:

- `axGlobals.rateLimiter`, `tracer`, `meter`, `logger`, `debug`, `abortSignal`, and `customLabels` are live runtime defaults; each operation snapshots them at its start, even if the AI instance already exists.
- Precedence is: per-call options, then explicit AI/service options, then current `axGlobals`, then built-in defaults.
- The limiter receives `next` plus operation, provider, model, streaming state, and previous service usage. It wraps chat and embedding provider execution, including streaming and retries; its errors propagate. It may delay, reject, skip, or invoke `next` multiple times.
- Tracer, meter, and usage-observer failures are fail-open. Limiter failures are fail-closed.
- Runtime-hook telemetry contains metadata and usage only, never prompts, outputs, tool arguments, or tool results.
- External meter instruments are independent of balancer-local `getMetrics()` snapshots. Adapt `AxMeter` to OpenTelemetry at the application boundary; generated packages do not require an OpenTelemetry dependency.
- `customLabels` merge from globals to service to call options; later sources override earlier keys.
- `abortSignal` values are merged, so either a global shutdown signal or a local request signal can cancel the request.
- `axGlobals.onUsage` receives one immutable normalized event for each completed chat or embedding call that reports token usage. A fully consumed stream emits once.
- Usage observers are best-effort and fail-open. Ax does not await them; synchronously enqueue events and persist or aggregate them out of band.

Clear process-wide hooks during shutdown or test teardown:

```typescript
axGlobals.rateLimiter = undefined;
axGlobals.tracer = undefined;
axGlobals.meter = undefined;
```

Use `usageContext` for multi-tenant and request attribution:

```typescript
const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  options: {
    usageContext: {
      tenantId: 'tenant-42',
      feature: 'support-chat',
      attributes: { environment: 'production' },
    },
  },
});

await llm.chat(request, {
  usageContext: {
    userId: user.id,
    requestId: requestId,
    runId: runId,
  },
});
```

Per-call context overrides service defaults, while `attributes` are shallow-merged. Events include normalized tokens, provider/model, available session and remote IDs, and a streaming flag. They do not estimate currency cost; calculate that downstream against a versioned pricing table.

## DeepSeek Notes

```typescript
import { ai, AxAIDeepSeekModel } from '@ax-llm/ax';

const deepseek = ai({
  name: 'deepseek',
  apiKey: process.env.DEEPSEEK_APIKEY!,
  config: { model: AxAIDeepSeekModel.DeepSeekFlash },
});
```

Both `deepseek` (native Chat, `/chat/completions`) and `deepseek-responses` (`/responses`) default to `deepseek-flash` (DeepSeek V4.1-Flash). For repeatable routing, select the intended deployment and model explicitly. `AxAIDeepSeekModel.DeepSeekV4Pro` (`deepseek-v4-pro`) remains a separate, text-input model. `DeepSeekV4Flash` (`deepseek-v4-flash`) is deprecated; the SDK cites DeepSeek's retirement and server-alias policy, not a verified live route. Deprecated `DeepSeekChat` (`deepseek-chat`), `DeepSeekCoder` (`deepseek-coder`), and `DeepSeekReasoner` (`deepseek-reasoner`) remain enum members for source compatibility; neither enum membership nor catalog aliases prove live availability or grant the current Flash model rules.

The current Flash catalog declares text/image input and text output, with a 1,048,576-token context window and 393,216 maximum output tokens. Native Chat still reports `getFeatures().media.images.supported === false`; generic Chat serialization can write base64 image content as an `image_url` data URL, but the injected transport case does not verify live image acceptance or understanding. For capability-gated image input, select an explicit model/deployment advertising image support rather than overriding Flash's features or adding a shim. The catalog limits are not request defaults: set `maxTokens` for the job, which Chat sends as `max_tokens` and Responses sends as `max_output_tokens`.

For native Chat's exact `deepseek-flash`, `deepseek-v4-flash`, and `deepseek-v4-pro` rules, logical `max` is the fallback only when neither `thinkingTokenBudget` nor `config.reasoningEffort` specifies an effort. It sends `thinking: { type: "enabled" }` and `reasoning_effort: "max"`. `thinkingTokenBudget: 'none'`, or `config.reasoningEffort: 'none'` on its own, sends disabled thinking and omits effort. Logical budgets `minimal`/`low` map to `low`, `medium` and `high` are preserved, and `highest`/`xhigh`/`max` map to `max`. Enabled thinking removes incompatible sampling parameters. `deepseek-reasoner` has a separate rule, not this V4 budget mapping. DeepSeek Responses has no per-model rules; its own dialect filters the `reasoning` object to `effort` and does not inherit the Chat thinking/default-max rules.

For raw `service.chat()` calls on those four IDs, the native Chat rules omit `functionCall: 'auto'` while retaining tool definitions. Caller `required` or named forced choices fail before transport, including a caller naming `__axOutput`; `functionCall: 'none'` removes tools and choice.

Those native Chat rules advertise **function-only** structured output. When structured handling is selected, use the advertised function rung (auto or `structuredOutputMode: 'function'`) and leave `functionCall` unset so AxGen can select its output tool. Without user tools, AxGen may replace a caller-supplied choice with its generated `__axOutput` choice; the Chat profile strips that generated choice but retains the tool definition. The published tool-free `json_object` claim for a singleton, including actor `javascriptCode`, does not hold for those rules. Ordinary non-complex signatures do not themselves select any structured rung. See [generation capability rungs](gen.md#structured-outputs-and-provider-capability-rungs) and the [offline Flash capability case](../examples/04-providers.ts).

DeepSeek Chat returns thinking traces as `reasoning_content`. During a tool loop, Ax preserves that field on the assistant tool-call message and sends it back on the following request together with non-null `content` and the original tool calls. This compatibility mode is declared by the DeepSeek deployment profile; the official OpenAI Chat adapter does not emit or expose `reasoning_content`.

The same logical default is declared independently for verified DeepSeek V4 rules in Together, Fireworks, and OpenRouter, then mapped to each deployment's own dialect: Together uses `reasoning_effort` without native `thinking`, OpenRouter uses nested `reasoning`, and Fireworks uses its own effort mapping. Keep hosted model IDs unchanged; native model names or server aliases do not confer hosted capabilities or pricing. A custom `openai-compatible` endpoint never inherits reasoning rules from a DeepSeek-looking model ID. The [deployment-reasoning-dialects case](../examples/04-providers.ts) checks the released native default, actual pre-transport rejection, and native/Together/custom wire distinctions with injected HTTP, not live provider quality or generated-language parity.

Other verified deployment rules follow the same policy. Grok 4.6 maps logical `max` to `xhigh`, while Grok 4.5 and 4.3 map it to `high`. Groq GPT-OSS and Cerebras GPT-OSS map it to `high`; Groq Qwen 3.6 maps it to its documented reasoning-enabled `default`; Cerebras Gemma 4 and DeepInfra DeepSeek R1 map it to `high`. An explicit `none` is sent only for model/deployment combinations that document disabling reasoning. Grok 4.6/4.5 and GPT-OSS on Groq or Cerebras reject `none` before network I/O because those APIs do not support disabling reasoning for those models.

Hugging Face Router remains conservative: routing policies such as `:fastest` may choose a different inference provider without changing the base model ID, so Ax does not attach one provider's reasoning contract to that dynamic route.

## Extended Thinking

```typescript
import { ai, AxAIAnthropicModel } from '@ax-llm/ax';

const claude = ai({
  name: 'anthropic',
  apiKey: process.env.ANTHROPIC_APIKEY!,
  config: { model: AxAIAnthropicModel.Claude55Opus },
});

const res = await claude.chat(
  { chatPrompt: [{ role: 'user', content: 'Solve step by step...' }] },
  { stream: false, thinkingTokenBudget: 'medium', showThoughts: true },
);
if (!('results' in res)) throw new Error('Expected a non-streaming chat response');
console.log(res.results[0]?.thought);
console.log(res.results[0]?.content);
```

### Gemini 4 Hydrogen

Select `AxAIGoogleGeminiModel.Gemini4Hydrogen` (`gemini-4-hydrogen`) with `name: 'google-gemini'`. It supports native JSON Schema, tools, streaming, and multimodal input. Logical thinking levels map `none` / `minimal` / `low` → `low`, `medium` → `medium`, `high` → `high`, and `highest` → `xhigh`. `none` also hides thoughts; omitting a level leaves Google's `high` default untouched. Native `config.thinking.thinkingLevel: 'xhigh'` works too; Gemini 3 clamps `xhigh` to `high`. Explicit `thinkingLevelMapping` overrides the logical mapping after resolving a model preset.

Hydrogen accepts `maxTokens` with a thinking level, unlike Gemini 3, which rejects an explicit cap with `thinkingLevel`. A response segment is limited to 65,536 output tokens; larger caps fail locally because automatic continuation is not implemented. Its 1,048,576-token context includes input and output. Numeric thinking budgets and explicit `contextCache` fail locally. Sampling, penalties, and multiple candidates are omitted on both native Gemini and its Vertex mode; implicit provider caching still applies.

The [Hydrogen cases](../examples/04-providers.ts) inspect real SDK request adaptation, schema/tool support, streaming, and rejection before injected transport. [PR #892](https://github.com/ax-llm/ax/pull/892) also adds Hydrogen and generation examples to Python, Java, C++, Go, and Rust through shared Core, including Java/Go streaming option forwarding. This is source evidence, not locally executed generated-language acceptance.

### Anthropic document citations

Send a `document` chat part, or the same value without `type` as an AxGen `file` / `f.file()` input:

```typescript
import { ai, type AxDocumentInput } from '@ax-llm/ax';

const source: AxDocumentInput = {
  source: { type: 'text', data: 'Returns are accepted within 30 days.' },
  title: 'Returns policy',
  context: 'Use this policy as the supplied evidence.',
  citations: { enabled: true },
  cache: true,
};
const claude = ai({ name: 'anthropic', apiKey });
const response = await claude.chat({
  chatPrompt: [{ role: 'user', content: [
    { type: 'document', ...source },
    { type: 'text', text: 'State the return window and cite the policy.' },
  ] }],
}, { stream: false });
if (!('results' in response)) throw new Error('Expected a completed response');
console.log(response.results[0]?.textBlocks);
```

`AxDocumentSource` accepts all five forms:

| Source | Value |
|---|---|
| Plain text | `{ type: 'text', data: 'plain UTF-8 text' }` |
| Inline PDF | `{ type: 'base64', mediaType: 'application/pdf', data: base64Pdf }` |
| Hosted document | `{ type: 'url', url: 'https://example.com/source.pdf' }` |
| Uploaded document | `{ type: 'file', fileId: 'file_...' }` (first-party Files API only, not Vertex) |
| Custom citable blocks | `{ type: 'content', content: [{ type: 'text', text: 'one citable block' }] }` |

Text, file IDs, PDF data, and every custom text block must be nonempty; URLs must use HTTP(S). `title` / `context` must be strings, and `citations.enabled` a boolean. These are local shape checks, not PDF decoding, remote-file validation, or evidence-quality checks. Existing PDF `file` parts (`data` or `fileUri`) also accept `title`, `context`, `citations`, and `cache`; non-PDF file citations fail locally.

Enable citations on **every document across the whole request**, including earlier user messages and legacy PDF files, or on none. Native JSON Schema (`responseFormat.type: 'json_schema'`, mapped to `output_config.format`) is incompatible with enabled citations and fails before transport, including AxGen `.useStructured()`. Use a text signature with a citation instruction in its output description; Ax does not silently weaken an explicit JSON contract.

`results[i].textBlocks` preserves each output passage as `{ index, text, citations? }`. A streaming block update is a **complete snapshot**: replace by `(result.index, block.index)`, never append its `text`. Ordinary `result.content` remains a text delta. Later citation-only updates can add associations without adding display text; earlier snapshots remain unchanged.

Document citations have no `url`. Inspect `type`, `documentIndex`, `documentTitle`, optional `fileId`, and `snippet`, plus the matching range: `startCharIndex` / `endCharIndex`, `startPageNumber` / `endPageNumber`, or `startBlockIndex` / `endBlockIndex`. End positions are exclusive; pages start at 1 and content blocks at 0. These ranges locate **input evidence**, not output text. URL/web-search citations still use `url`.

After either generation mode, [per-round-trip chat-log blocks](gen.md#normalized-chat-logs-and-usage) retain passage associations and `resultIndex`. `getUsage()[i].citations` is a flat source list, not a passage map. Document indices are request-local, never global source IDs: keep the corresponding request's document order. Routers preserve native documents and cited PDFs and exclude incompatible providers even with media degradation enabled; do not strip citations to force fallback.

The [document examples](../examples/37-document-citations.ts) use the actual SDK with finite scripted HTTP/SSE responses, not inference. [PR #894](https://github.com/ax-llm/ax/pull/894) retains URL-less locations; [#895](https://github.com/ax-llm/ax/pull/895) adds sources and passage associations. [#896](https://github.com/ax-llm/ax/pull/896) ports document sources/validation to Python, Java, C++, Go, and Rust. Their results/logs use `text_blocks`, logs add `result_index`, and flat usage uses `citations`; location fields retain camelCase. Log access is `get_chat_log()` in Python/C++/Rust, `getChatLog()` in Java, and `ChatLog` in Go. These generated contracts are documented source scope, not executed acceptance here.

### Budget Levels

| Level | Anthropic (tokens) | Gemini 2.5 (tokens) | Gemini 3 level |
|---|---|---|---|
| `'none'` | disabled; lowest effort where thinking is always on | 0 on Flash/Lite; minimum on Pro | lowest supported, thoughts hidden |
| `'minimal'` | 1,024 | 200 | `minimal`, or `low` when `minimal` is unsupported |
| `'low'` | 5,000 | 800 | `low` |
| `'medium'` | 10,000 | 5,000 | `medium`, or the nearest image/legacy level |
| `'high'` | 20,000 | 10,000 | `high` |
| `'highest'` | 32,000 | 24,500 | `high` |

Gemini 3 uses `thinkingLevel`; Gemini 2.5 and older models use numeric `thinkingBudget`. Ax selects the wire field after resolving a named model preset to its real model. Gemini 3.8 Flash, Gemini 3.7 Flash, and Gemini 3.1 Pro clamp `minimal` to `low`; image and legacy Gemini 3 models clamp to their documented two-level sets. Numeric Gemini 3 budgets fail locally. `none` always hides returned thoughts, even when the model must still perform its minimum amount of thinking. Gemini 3.8 Live accepts no thinking settings, so Ax sends none. Gemini 3.8 Live Extended Thinking requires a level: Ax sends `medium` when none is requested and clamps `minimal` to `low`.

The native `google-gemini` deployment profile and its aliases use these Gemini rules, including when configured for Vertex with `projectId` and `region`. The separate OpenAI-compatible `vertex-ai` profile keeps its own request rules and does not inherit native Gemini fields from a Gemini-looking model ID.

For GPT-5.6 and GPT-6 (Astra, Sol, Luna, GPT-6.1 Sol), these map to `none`, `low`, `low`, `medium`, `high`, and a top rung that depends on the API surface: `xhigh` on Chat Completions, which rejects `max`, and `max` on the Responses API, which is the only place it is served. These models default an omitted effort to `medium`, so `none` is sent explicitly; GPT-6 Astra and GPT-6.1 Sol refuse `none` and Ax throws. Earlier OpenAI models retain their existing mapping.

### Anthropic Model-Specific Behavior

- Opus 5.5, Fable 5.1, Fable 5, Opus 5, Opus 4.8, 4.7, and 4.6 plus Sonnet 5, Sonnet 5.5, and Haiku 5.5:
  adaptive thinking, no manual `budget_tokens`, and no `temperature` / `topP` /
  `topK`. When thoughts are requested, Ax asks Anthropic for summarized
  display; when they are hidden, Ax explicitly requests `display: 'omitted'`.
- Opus 5.5, Fable 5.1, and Fable 5 always think, so `thinkingTokenBudget:
  'none'` sends the lowest effort with thoughts hidden instead of disabling it.
- Opus 5 and Sonnet 5 think by default, so `'none'` sends
  `thinking: { type: 'disabled' }`. Opus 5 only allows that at effort `'high'`
  or below, so Ax rejects `'none'` combined with `'xhigh'` or `'max'`.
- Sonnet 5.5 uses `thinking: { type: 'between_tools' }` for `'none'`,
  allowed at effort `'high'` or below. Its signed between-tool updates are
  retained in `thoughtBlocks` for replay even when display thoughts are hidden.
  Streaming and non-streaming responses preserve both thinking and redacted
  blocks; `showThoughts: false` suppresses the display `thought` field.
  The generated Python, Go, Java, C++, and Rust clients share these rules,
  including effort validation, native structured output, and signed replay.
- Opus 5.5, Sonnet 5.5, and Fable 5.1 refuse forced tool choice: Ax throws for
  `functionCall: 'required'` or a named function, and structured output uses
  the native `output_config.format` path.
- Haiku 5.5 (`AxAIAnthropicModel.Claude55Haiku`, also on Vertex):
  adaptive thinking defaults to medium effort. `'none'` sends
  `thinking: { type: 'disabled' }`; combining it with `'xhigh'` or `'max'`
  fails locally. Other thinking levels use adaptive thinking with effort.
  Forced tool choice is supported, as are native JSON Schema and function-based
  structured outputs. Empty signed thinking blocks remain available for replay;
  keep history append-only, including later system messages on both APIs.
  The context window is 1M tokens and the output limit is 128K. Per million
  tokens, input/output pricing is $0.10/$0.50 through 100K input tokens and
  $0.50/$2.50 above 100K, counting cached input toward the threshold. Cache
  reads and 5-minute writes use the corresponding tier. These semantics are
  shared with the generated Python, Go, Java, C++, and Rust packages.
- Opus 4.8, Opus 5, Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5, and Fable 5.1 keep a later system
  message in place on the first-party API; other models hoist it into the
  system prompt. Sonnet 5.5 and Haiku 5.5 preserve later system messages on Vertex,
  keeping the prefix before signed thinking unchanged.
- Opus 4.5: budget_tokens + effort levels (capped at `'high'`)
- Other thinking models: budget tokens only

For assistant replay, empty visible text (`content: ''`) adds no synthetic text block. Cache markers attach only to text or tool-use blocks, never to signed or redacted thinking.

Anthropic `modelConfig.effort` can be set directly on a request. Fast mode and task budgets are Anthropic-only opt-ins; `taskBudget.total` must be at least 20,000 tokens.

```typescript
const res = await claude.chat({
  chatPrompt: [{ role: 'user', content: 'Review this migration plan.' }],
  modelConfig: {
    effort: 'xhigh',
    speed: 'fast',
    taskBudget: { type: 'tokens', total: 64_000 },
  },
});
```

### Custom Thinking Levels

```typescript
const claude = ai({
  name: 'anthropic',
  apiKey: '...',
  config: {
    model: AxAIAnthropicModel.Claude48Opus,
    thinkingTokenBudgetLevels: {
      minimal: 2048,
      low: 8000,
      medium: 16000,
      high: 25000,
      highest: 40000,
    },
    effortLevelMapping: {
      minimal: 'low',
      low: 'medium',
      medium: 'high',
      high: 'high',
      highest: 'max',
    },
  },
});
```

The [custom thinking-level case](../examples/04-providers.ts) contrasts a legacy numeric budget with an adaptive model using the same custom effort map. Adaptive thinking does not consume the numeric budget ladder; hidden display thoughts do not disable thinking.

## Embeddings

```typescript
const { embeddings } = await llm.embed({
  texts: ['hello', 'world'],
  embedModel: 'text-embedding-005',
});
```

## Vertex AI Locations

When `projectId` and `region` are set for Google Gemini or Anthropic on Vertex AI, Ax selects the service hostname from the location automatically:

- `global` uses `aiplatform.googleapis.com`
- `us` and `eu` use the multi-region `.rep.googleapis.com` endpoints
- regional locations such as `us-central1` use
  `{region}-aiplatform.googleapis.com`

Pass the canonical lower-case Vertex location ID. Ax preserves the supplied value and does not normalize or validate it.

`gemini-embedding-2` is the exception: Vertex serves it only at `global` through `:embedContent`, so Ax sends its embeddings there whatever `region` is set. Each request embeds exactly one text (pass several and `embed()` throws, because Vertex would fuse them into one vector), and no task type is sent even when `embedType` is configured, since Vertex ignores one for this model. Put task instructions in the text itself, e.g. `task: search result | query: {content}`. Other embedding models keep the regional `:predict` endpoint.

The generated Python, Java, C++, Go, and Rust clients accept the same `projectId` / `project_id`, `region`, and optional `endpointId` / `endpoint_id` options. In generated clients, `apiKey` / `api_key` is a caller-supplied bearer access token (or `GOOGLE_VERTEX_ACCESS_TOKEN`); ADC discovery and automatic token refresh remain host-owned. An explicit `baseUrl` / `base_url` always wins.

## Context Caching

```typescript
const result = await gen.forward(llm, { code, language }, {
  mem,
  sessionId: 'code-review-session',
  contextCache: {
    ttlSeconds: 3600,
    cacheBreakpoint: 'after-examples',
  },
});
```

Breakpoint values: `'system'` | `'after-functions'` | `'after-examples'`

Provider behavior:

- Google Gemini: explicit caching with cache resource ID and auto TTL refresh;
  failed refreshes recreate or fall back uncached, and rejected Ax-managed
  caches retry once without the cache
- Anthropic: implicit via `cache_control` markers
- Meta Responses and Chat Completions cache automatically and accept an optional
  `promptCacheKey`; Responses also accepts `promptCacheRetention: 'in_memory' |
  '24h'`. Meta Messages has no cache marker or cache-key field, so Ax strips
  generic `cache_control` annotations on that profile.
- OpenAI: explicit `prompt_cache_breakpoint` markers, **GPT-5.6+ only**; GPT-6
  also gets `ttl: '30m'` in `prompt_cache_options`. Earlier families cache
  automatically and predate the parameters, so nothing is sent to them. Only the `openai` provider opts in — Azure OpenAI shares the request
  builder and the same model enum, so a `gpt-5.6-*` deployment sends nothing,
  and `openai-responses` sends breakpoints for GPT-6 only (it does report
  `cacheCreationTokens`, which is provider-wide)

### Gemini system instructions and cache migration

Gemini cache creation retains every system message in order, including messages after the content breakpoint; their contents are joined with a space, matching ordinary requests. [PR #851](https://github.com/ax-llm/ax/pull/851) records the fix for the TypeScript path, which previously overwrote earlier system instructions with the last one. Existing pre-fix caches must expire or be recreated to receive the complete instructions; upgrading the SDK alone does not repair cached content.

[PR #862](https://github.com/ax-llm/ax/pull/862) records historical regression verification that the generated Gemini mapper also retained all ordered system messages, including those after the content breakpoint. That coverage required no further mapper runtime change. This guide did not execute the generated packages.

### OpenAI prompt cache keys

GPT-5.6+ needs a key that is stable per conversation to match reliably; it routes the request to the shard the cache lives on. Set `promptCacheKey`, or let it fall back to `sessionId`. Keep it under roughly 15 requests/minute per key.

Every OpenAI Responses request sends `prompt_cache_key`, with or without caching: the `promptCacheKey`, else the `sessionId`, the call's before the service's. Chat Completions sends it only with GPT-5.6+ caching.

```typescript
const result = await gen.forward(llm, values, {
  mem,
  promptCacheKey: `review:${pullRequestId}`,
  contextCache: {},
});
```

AxGen forwards these provider options after merging program defaults with the per-call options. Generated language packages preserve the same `promptCacheKey` / `sessionId` / `contextCache` forwarding contract.

**Markers must not move.** A breakpoint marker is part of its content block, so marking only "the newest stable message" each turn un-marks what the previous turn marked, changing the prefix and voiding the entry that turn wrote. Ax marks by absolute index from the front, which is stable for an append-only conversation. Anything that rewrites the front of the history — dynamically added functions changing the system prompt, or `mem.rewindToTag` — costs a cache miss.

**Keep caching on for the whole conversation.** The provider marks all or nothing, so a turn that omits `contextCache` sends the prompt unmarked and the next turn rewrites the cache from scratch.

### External Registry (serverless)

```typescript
const accountId = getRequiredAccountId();
const registry: AxContextCacheRegistry = {
  get: async (key) => {
    const value = await redis.get(`context-cache:${accountId}:${key}`);
    return value ? JSON.parse(value) : undefined;
  },
  set: async (key, entry) => {
    const ttl = Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000));
    await redis.set(
      `context-cache:${accountId}:${key}`,
      JSON.stringify(entry),
      { ex: ttl }
    );
  },
};
```

Ax registry keys are content-based and are not account-scoped. Require a stable tenant/account namespace when cross-account cache sharing is unsafe; do not silently fall back to a global namespace.

## AWS Bedrock

Use the `amazon-bedrock` profile for Bedrock's OpenAI Chat Completions deployment, including Mantle. Supply the account/region-specific OpenAI base URL and a Bedrock API key explicitly:

```typescript
const bedrock = ai({
  name: 'amazon-bedrock',
  apiURL: process.env.BEDROCK_OPENAI_BASE_URL!,
  apiKey: process.env.BEDROCK_API_KEY!,
  config: { model: process.env.BEDROCK_MODEL_ID! },
});
```

This profile supports native JSON Schema and maps `thinkingTokenBudget` for these Bedrock IDs, including geographic prefixes such as `us.` and `global.`:

| Models / IDs | Reasoning and function tools on `amazon-bedrock` |
| --- | --- |
| GPT-6 Sol (`openai.gpt-6-sol`), Luna (`openai.gpt-6-luna`), GPT-5.6 Sol (`openai.gpt-5.6-sol`) | Function tools require explicit `thinkingTokenBudget: 'none'` or `config.reasoningEffort: 'none'`; an omitted or enabled effort is rejected locally when tools are present. |
| GPT-6 Astra (`openai.gpt-6-astra`), GPT-6.1 Sol (`openai.gpt-6.1-sol`) | Reasoning is required: disabling it is rejected locally. Function tools are rejected on this profile, without function emulation. |

For these models, the public `thinkingTokenBudget` levels map as follows: `minimal` → `low`; `low`, `medium`, and `high` retain their names; `highest` → `xhigh`; `none` disables reasoning only where permitted above. Requests omit `temperature`, `top_p`, and `stop`. Standard service tier is accepted; unsupported Flex/Priority requests fail locally before transport. GPT-OSS and unknown-model defaults are unchanged; do not extend these verified rules to every Bedrock ID.

For complex signatures, AxGen defaults to native schema output (`response_format: json_schema`), not a function tool. Schema-only output therefore does not require disabling reasoning, including on Astra and GPT-6.1 Sol. For reasoning **and function tools**, use `name: 'openai-responses'` with the same Bedrock base URL instead. These are deployment-profile rules, not native AWS `Converse` rules. See [PR #866](https://github.com/ax-llm/ax/pull/866) for the original profile change.

To reach OpenAI's GPT models on those endpoints through the `openai` or `openai-responses` provider, name them with Bedrock's IDs: `openai.gpt-6-sol` on bedrock-mantle, or a cross-Region inference profile such as `us.openai.gpt-6-sol` or `global.openai.gpt-6-astra` on bedrock-runtime. Ax applies the named model's contracts: its built-in model info (so `temperature` and `top_p` are not sent), the GPT-5.6 and GPT-6 effort ladders, the reasoning rules of Astra and GPT-6.1 Sol, and, on `openai`, routing the GPT-6 family to `<apiURL>/responses`. It leaves off what Bedrock does not serve: prompt-cache breakpoints on Chat Completions (Bedrock caches these models on the Responses API only) and Astra chat sessions, since async tools, steering, and reasoning updates are not available there.

```typescript
const gpt = ai({
  name: 'openai',
  apiURL: 'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1',
  apiKey: process.env.BEDROCK_API_KEY!,
  config: { model: 'us.openai.gpt-6-astra' as AxAIOpenAIModel },
});
```

The separate AWS package remains available when native AWS SDK authentication, regional fallback, or non-Mantle Bedrock behavior is required:

```typescript
import { AxAIBedrock, AxAIBedrockModel } from '@ax-llm/ax-ai-aws-bedrock';

const bedrock = new AxAIBedrock({
  region: 'us-east-2',
  fallbackRegions: ['us-west-2'],
  config: { model: AxAIBedrockModel.ClaudeSonnet5 },
});
```

The native client uses Bedrock `Converse` and `ConverseStream`. Claude models advertise native functions, streaming, image/document input, prompt-cache breakpoints, and their verified thinking modes. GPT-6 Sol, Luna, Astra, and GPT-6.1 Sol (`AxAIBedrockModel.Gpt6Sol`, `Gpt6Luna`, `Gpt6Astra`, `Gpt61Sol`) advertise native functions, streaming, image input, and reasoning effort. Structured-output and service-tier support remain model-specific; query `bedrock.getFeatures(model)` instead of assuming every Bedrock model has the same capabilities. The AWS SDK remains a dependency of `@ax-llm/ax-ai-aws-bedrock` only and is not pulled into `@ax-llm/ax`.

In the separate AWS package, `AxAIBedrockModel.ClaudeHaiku55` is `us.anthropic.claude-haiku-5-5`. Haiku 5.5 uses adaptive thinking by default but permits `thinkingTokenBudget: 'none'`. It omits `temperature` and `topP` even with thinking disabled, and advertises both native and function structured-output modes (`['native', 'function']`). This applies to the native AWS client, not to generated packages or other profiles. See [PR #865](https://github.com/ax-llm/ax/pull/865) for the original model addition.

Use `contextCache.ttlSeconds` for a 5-minute or supported 1-hour cache point, and `thinkingTokenBudget` for legacy budget thinking or the corresponding adaptive-thinking effort on current Claude models:

```typescript
const response = await bedrock.chat(
  {
    chatPrompt: [
      { role: 'system', content: 'Use the supplied policy.', cache: true },
      { role: 'user', content: 'Summarize the policy.' },
    ],
  },
  {
    stream: true,
    contextCache: { ttlSeconds: 3600 },
    thinkingTokenBudget: 'medium',
  }
);
```

On the native Bedrock client, Claude Sonnet 5 and Opus 5.5 always use adaptive thinking and reject `thinkingTokenBudget: 'none'`; Claude Opus 5 permits disabling it. On GPT-6, `thinkingTokenBudget` sets the reasoning effort (`minimal` → `low`, `highest` → `max`, `none` turns reasoning off), except that Astra and GPT-6.1 Sol reject `'none'` before sending. GPT-6 requests omit `temperature` and `topP`, which these models do not accept.

## Vercel AI SDK Integration

```typescript
import { generateText } from 'ai';
import { ai } from '@ax-llm/ax';
import { AxAIProvider } from '@ax-llm/ax-ai-sdk-provider';

const axAI = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY ?? '',
});
const model = new AxAIProvider(axAI);

const result = await generateText({
  model,
  prompt: 'Hello!',
});
```

The package for the [integration examples](../examples/34-vercel.ts) pins `@ax-llm/ax-ai-sdk-provider@25.4.13` with `ai@7.0.2` on Node ≥22.18. Keep their shared provider types coherent; the example package pins `@ai-sdk/provider@4.0.0` and `@ai-sdk/provider-utils@5.0.0` through overrides.

This adapter's `createChatRequest` drops `abortSignal`, `providerOptions` and `responseFormat`; sampling fields are not forwarded through Ax's `modelConfig`. Vercel typed-output validation is client-side, not native schema enforcement. Do not assume transport cancellation or provider-option forwarding from the higher-level call. See the [pinned adapter implementation](https://unpkg.com/@ax-llm/ax-ai-sdk-provider@25.4.13/index.js). The examples use actual adapter/SDK algorithms with explicitly scripted model I/O, not live cross-provider qualification.

## MCP transport and event ingestion

```typescript
import { AxMCPClient } from '@ax-llm/ax';
import { axCreateMCPStdioTransport } from '@ax-llm/ax-tools';

const transport = axCreateMCPStdioTransport({
  command: 'bunx',
  args: ['@modelcontextprotocol/server-memory'],
});
const client = new AxMCPClient(transport);
```

For MCP integration detail see [MCP](mcp.md); for wake/resume and signed ingestion see [event runtime](event-runtime.md). For server notifications, call `client.startListening({ signal, onError })` or attach the client through `AxMCPEventSource`. The event adapter is preferred for autonomous work because protocol callbacks only enqueue; explicit routes decide whether to observe, invalidate, resume, or wake.

For signed UCP lifecycle requests, mount `AxUCPWebhookEventSource.ingest(request)` in application-owned HTTP hosting. Signature, profile, digest, freshness, and replay verification completes before the event runtime sees the request.

## External working examples

Fetch these for full working code:

- [Embeddings](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/embed.ts) — embedding generation
- [Anthropic Thinking](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/anthropic-thinking-function.ts) — extended thinking with functions
- [Anthropic Thinking Separation](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/anthropic-thinking-separation.ts) — thinking separation
- [Anthropic Web Search](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/anthropic-web-search.ts) — Anthropic web search
- [OpenAI Web Search](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/openai-web-search.ts) — OpenAI web search
- [OpenAI Responses](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/openai-responses.ts) — OpenAI responses API
- [o3 Reasoning](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/reasoning-o3-example.ts) — o3 reasoning
- [Gemini Context Cache](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/gemini-context-cache.ts) — Gemini context caching
- [Gemini Files](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/gemini-file-support.ts) — Gemini file handling
- [Grok Live Search](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/grok-live-search.ts) — Grok live search
- [OpenAI-Compatible](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/openai-compatible.ts) — custom OpenAI-compatible base URL
- [Meta Muse](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/meta-muse.ts) — Muse Spark and Muse Image through `chat()`
- [Meta Voice](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/meta-voice-transcribe.ts) — Muse Voice batch transcription
- [Vertex AI Auth](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/vertex-auth-example.ts) — Vertex AI authentication
- [MCP Stdio](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/mcp-client-memory.ts) — MCP stdio transport
- [MCP HTTP](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/mcp-client-pipedream.ts) — MCP HTTP transport
- [Telemetry](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/telemetry.ts) — OpenTelemetry tracing
- [Multi-Modal](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/multi-modal.ts) — image handling

## GPT-6 Astra and automatic sessions (TypeScript)

Select `ai({ name: 'openai', config: { model: AxAIOpenAIModel.GPT6Astra }, apiKey })`. Import `ai` and `AxAIOpenAIModel` from `@ax-llm/ax`. Ax automatically routes Astra through Responses. Existing defaults are unchanged. Use `thinkingTokenBudget: 'low'` and `serviceTier: 'standard'`. Astra requires reasoning; `minimal` maps to `low` and `none` throws. Unsupported sampling and log-probability options are removed. EU residency does not support priority processing.

GPT-6 Sol (`AxAIOpenAIModel.GPT6Sol`) and Luna (`AxAIOpenAIModel.GPT6Luna`) also route through Responses, since Chat Completions refuses their function tools while they reason. Unlike Astra they accept `thinkingTokenBudget: 'none'`, and chat sessions and `configuration_update` remain Astra-only. OpenAI reports a GPT-6 priority request's served tier as `fast`; Ax records it as `priority`.

GPT-6.1 Sol (`AxAIOpenAIModel.GPT61Sol`) is a GPT-6 family member: it routes through Responses, caches at breakpoints with `ttl: '30m'`, and drops sampling and log-probability options while reasoning. Like Astra it cannot disable reasoning, so `thinkingTokenBudget: 'none'` throws and Chat Completions refuses its function tools at every effort. Ax does not yet expose chat sessions or `configuration_update` for this model.

Its Standard input/cache-read/cache-write/output rates per million tokens are $2/$0.10/$2.50/$10, rising to $4/$0.20/$5/$15 above 272K total input tokens. Priority costs 2x Standard and Flex costs 0.5x, including cache tokens and the long-context rates. A served `fast` tier is recorded as `priority` for cost accounting. On profiles without model metadata, fixed Bedrock OpenAI IDs use the corresponding OpenAI sampling restrictions; unknown IDs remain unchanged.

Keep calling `forward()` and `streamingForward()`. Declare independent tools with `fn('lookup').description('...').execution('background').handler(...).build()`. Ordinary tools default to blocking. JavaScript promises and MCP annotations do not opt a tool into background execution. Set `asyncMode: 'off'` to use the ordinary tool loop. Providers without session support retain that loop.

Use `const control = runControl()` and pass `{ control }` in forward options. Call `control.steer(text)`, `control.setThinkingTokenBudget('high')`, or `control.abort()`. `control.onEvent(listener)` observes queued/applied updates, run lifecycle, tool activity, and model output activity. A run emits `started`, then `completed` or `failed` (with its `error`). `control.abort()` emits `aborted` at once, and the run then ends as `failed` with the abort error. A consumer that stops a `streamingForward` early (for example with `break`) ends the run as `aborted` instead. Untargeted updates apply to the root and future descendants. `{ target: 'root/nodeName' }` restricts an update to a flow node and its descendants. Completed nodes are not rerun. Controller-attached runs bypass result caching; provider prompt caching remains enabled.

HTTP streaming needs no WebSocket dependency. With a configured host `options.webSocket`, steering can apply natively during generation; otherwise it applies at the next response boundary. Observe the applied event's `timing`. An update queued while a request is in flight applies when the next step starts. If that request gave the final answer, the run takes one more step to apply it, and the answer comes from that step; a steer stays in the conversation for the steps after it. Reasoning updates use continuation input items, retaining the original prefix. Steering that awaits tool input is continued even when its pending notification arrives after completion. Duplicate acknowledgements do not apply an update twice.

Ax owns tool execution and result submission. Only completed calls execute; pending results are incorporated before successful final output. Streaming clients reset accumulated output when `version` changes; provisional answers never count as successful completion. Sessions pin the selected provider and model and do not reconnect or replay calls after a failure. Cancellation requests tool cancellation; it does not undo external work. The native Responses wire client is internal. Custom providers may implement the optional normalized `openChatSession` contract; existing `.chat()` services work. Session adapters should expose their transport abort signal so pending host work does not prevent cancellation or disconnection from ending the run. Sessions preserve provider defaults and model-alias settings; explicit request settings win.

Runnable examples: `typescript/generation/astra.ts`, `astra-async-tools.ts`, `astra-steering.ts`, `astra-reasoning-update.ts`, `astra-session-lifecycle.ts`, and `typescript/short-agents/astra-background.ts`. Generated-language session support is partially implemented in Python, Go, Java, C++, and Rust. Their language galleries include provider-backed examples, but full parity remains open in the AxIR backlog. Generated flow groups now dispatch owned workers, with a traced serial fallback for custom implementations without worker factories. Remaining MCP invocation and session acceptance evidence is tracked in the backlog. See `docs/COMPILER.md` for the implementation status.

### Files through provider routing

Provider routing preserves native file items when the selected provider and model support files, including filename, MIME type, cache flags, and extraction metadata. Supplying extracted text does not replace a file that the provider can consume natively. For unsupported providers, extracted text or a configured file-to-text callback supplies text; fallback policy can degrade, skip, or reject the file. The original conversation retains the file for later turns. Generated Python, Go, Java, C++, and Rust routers apply this policy in shared Core after selection.

## Google Gemini Decisions

Use `ai({ name: 'google-gemini-decisions', apiKey })` for required flat boolean/class/rubric score signatures, defaulting to `gemini-decision-1`, or `googleGeminiDecisions({ apiKey }).create({ input, questions })` for native named questions and multimodal blocks. This separate Developer API profile posts to `/v1beta/decisions` with `x-goog-api-key`; it is not ordinary Gemini GenerateContent or Vertex AI.

Evidence includes native probabilities and required confidence, including boolean confidence. Scalar booleans use provider `trueThreshold`; evidence uses its field threshold, both defaulting to `0.5`. Usage is input-only with zero output tokens. Safety blocks are HTTP errors, not per-question refusal unions. There is no token stream, Box, prose, tools, caching, thinking or Flex/Priority inference. Native Score supports 2–255 levels, but signature rubrics remain 2–10. Read [Gemini's exact input, key, threshold and evidence contracts](typesafe.md#google-gemini-decisions) before implementation; do not infer parity from the shared signature surface.

## OpenAI Decisions

Use `ai({ name: 'openai-decisions', apiKey })` for required boolean, class, and rubric score outputs through the dedicated `/v1/decisions` endpoint. The default model is `gpt-6-luna`. This is a separate provider profile from OpenAI Chat and Responses.

```typescript
import { ai, ax } from '@ax-llm/ax';
const model = ai({ name: 'openai-decisions', apiKey, trueThreshold: 0.9 });
const triage = ax('ticket:string -> urgent:boolean, team:class "support, billing"');
const values = await triage.forward(model, { ticket: 'I was charged twice.' });

const judge = ax(
  'query:string, document:string -> relevant:boolean(evidence, threshold 0.7), relevance:score "Irrelevant, Related, Partial answer, Direct answer"(evidence)'
);
const result = await judge.forward(model, {
  query: 'How do I request a refund?',
  document: 'Request a refund through your account billing page.',
});
console.log(result.relevant.probability, result.relevance.value);
```

The signature adapter maps booleans to predicates, classes to choices, and ordered `score` labels to native score levels. Boolean value descriptions become question instruction lines; class value descriptions become each choice's `description`. `trueThreshold` defaults to `0.5`, must be finite in `[0, 1]`, and converts probabilities with an inclusive comparison. It is local conversion policy. Raw native answers remain in `program.getChatLog().at(-1)?.providerMetadata?.openaiDecisions?.answers`. Evidence-bearing fields retain probabilities, provider-selected classes, continuous scores, and native confidence in normal program outputs. Boolean evidence uses its field threshold, defaulting to `0.5`; scalar fields retain `trueThreshold`. Ax attaches provenance, and a generative model uses the same signature with `source: 'elicited'`, values derived from probabilities, and no native confidence. These shared shapes do not imply comparable calibration across providers.

Usage uses existing `getUsage()` APIs. Evidence refusals raise terminal `AxDecisionRefusalError` by default; `(evidence, refusal return)` gives an answered/refused union without correction retries. Optional, numeric, array, nested, and freeform outputs, tools, and generation controls are rejected before transport. A completed result can be delivered through `streamingForward()`; the endpoint has no token stream.

For custom native question/request shapes and provider-specific input, use `openaiDecisions({ apiKey, model?, apiURL?, credentialProvider?, headers?, options? }).create(request, options?)`. Questions are an ordered array of `predicate`, `choice`, and `score` objects. Each has string `instructions` and an optional unique `name`. Choices use `choices: [{ value: string | boolean, description?: string }]`; boolean values and strings with the same spelling stay distinct. Choice requires 2–255 options. Scores require 2–10 levels and use `levels: [{ label, description? }, ...]`. The score is a fractional native level index starting at zero. Ax does not infer rubrics from numeric bounds.

The response preserves answer order, model, full usage, and per-question `{ type: 'refusal', name }` outcomes. Narrow refusals before accessing values. Predicates return `probability`; choices return `choice`, `confidence`, and `probabilities: [{ value, probability }]`; scores return `score`, `confidence`, and `probabilities: [{ value, label, probability }]`. Ax validates the response against the questions and preserves probabilities without normalization (an inclusive `0.01` sum tolerance accommodates rounding). Question dependencies require separate requests.

The standalone [OpenAI Decisions wire case](../examples/06-decisions.ts) uses the real adapter with synthetic HTTP answers. It preserves native selection, fractional score and ordered evidence; it does not measure inference quality or calibration.

**Native Ax client limitations:** `openaiDecisions().create()` accepts `input` as text or an array of user messages. Each message contains a string or an array of text and/or inline image parts: `{ role: 'user', content: [{ type: 'input_text', text }, { type: 'input_image', image_url: 'data:image/png;base64,...', detail: 'auto' }] }`. There are at most 128 images per request; hosted image URLs, file IDs, audio, non-user roles, and tool items are unsupported by the [Ax client](https://unpkg.com/@ax-llm/ax@25.4.13/index.d.ts) and its [request validator](https://unpkg.com/@ax-llm/ax@25.4.13/index.js.map) (`ai/openai-decisions/validate.ts`). The signature adapter preserves Ax's text prompt/history as role-labelled evidence in a user message and passes inline images through without giving the labels native role authority. The [OpenAI endpoint documentation](https://developers.openai.com/api/docs/guides/decisions) describes a broader API; do not assume the Ax Decisions client accepts all of its inputs or shares the ordinary `openai-responses` client's contract.

Both interfaces accept `apiURL` including `/v1` (default `https://api.openai.com/v1`) and renewable credentials. Native and adapter transport options support fetch, timeout, retry, and cancellation. Both instance and per-call cancellation apply to native requests. Credential-provider headers override static credentials and native custom headers regardless of header-name capitalization. Native requests can include `safety_identifier`; adapter instances accept `safetyIdentifier`. Unsupported requests are excluded from router/balancer selection and fallbacks.

In an Ax source checkout, run the upstream examples from its repository root:

```bash
bun run tsx src/examples/typescript/generation/decision-evidence.ts
bun run tsx src/examples/typescript/generation/openai-decisions.ts
bun run tsx src/examples/typescript/generation/openai-decisions-native.ts
bun run tsx src/examples/typescript/generation/openai-decisions-image.ts
```

They use `OPENAI_API_KEY` or `OPENAI_APIKEY`. Python, Java, C++, Go, and Rust also support the signature adapter and native ordered questions. Their native factories are `openai_decisions`, `Ax.openaiDecisions`, `axllm::openai_decisions`, `axllm.OpenAIDecisions`, and `openai_decisions`, respectively. Native requests and responses use the language JSON map/value representation and preserve refusals and all usage fields. Runnable examples are under each language generation directory as `openai-decisions` and `openai-decisions-native` (Java uses `OpenAIDecisionsExample` and `OpenAIDecisionsNativeExample`). See the [Decisions guide](https://developers.openai.com/api/docs/guides/decisions) for the current provider contract and availability.

## Streaming Usage And Incomplete Responses

OpenAI Responses reports a token-limit stop as `length` and a content-filter stop as `content_filter`. The terminal response status takes precedence even when no message was produced or an earlier message completed. Incomplete streams retain their token usage and the served service tier. Reusing a client keeps each stream's usage separate; consume the terminal event for final totals.

Anthropic `message_delta` counts are cumulative. Present input and cache counts replace earlier counts, including explicit zero; omitted or null fields retain previous values. Successive deltas retain the latest input, cache, and speed metadata while updating output tokens.

# Core AxAgent Construction and Runtime Contracts

Use for `agent(...)`, ordinary tool-using assistants, identity, child delegation, namespaced functions, discovery, `bubbleErrors`, host-side completion, clarification, and public run/state APIs. Generate the smallest correct factory-based shape and copyable code; do not add tutorial prose unless requested. Source API snapshot: `@ax-llm/ax` 25.4.13.

## Choose the Agent Shape

| Need | Shape or companion reference |
| --- | --- |
| Use tools and answer | Plain `agent(...)` with local functions; minimal configuration, no extra observability |
| Delegate distinct specialist responsibilities | Child agents in `functions: [...]`; set each child's `agentIdentity.namespace` for call sites such as `team.writer(...)` |
| Discover unstable callable names or schemas | Enable discovery; generate discovery-first actor code |
| Let selected fatal errors escape the loop | `bubbleErrors` with Error classes; propagation covers function handlers, actor code, and `llmQuery(...)` sub-queries |
| Inspect large context with code, long-running execution, RLM, or `llmQuery(...)` | [RLM](agent-rlm.md); split at decisions that require new evidence, not at every computation |
| Callbacks, debugging, logs, traces, progress, tool/chat logs, or usage | [Agent observability](agent-observability.md) |
| Recall, dynamic memory/skill guides, `discover({ skills })`, loaded/used tracking | [Memory and runtime skills](agent-memory-skills.md) |
| `agent.optimize(...)`, tuning, evaluation, judge setup, datasets, saved artifacts | [Agent optimization](agent-optimize.md) |
| MCP clients, native modules, transports, authentication, catalogs, subscriptions, tasks, Apps, server handlers, recording/replay, or event-driven wake/resume | [MCP](mcp.md); [event runtime](event-runtime.md) covers wake/resume orchestration |

For Typesafe/Jev decisions, keep a generative model for the actor's tools, code, and prose; invoke Typesafe as a separate decision step. Jev cannot supply a general tool-using actor's output contract. See [Typesafe](typesafe.md) for supported signatures/native questions. Original remote guidance remains at [ax-typesafe.md](https://github.com/ax-llm/ax/blob/main/src/ax/skills/ax-typesafe.md); local guidance is the companion reference, not a separately required skill.

## Defaults and Execution Constraints

- Use `agent(...)`, not `new AxAgent(...)`, for new code.
- Prefer string signatures or `f()` signatures to hand-written signature objects, and `fn(...)` host functions to hand-written JSON Schema.
- `ai` supplies instance defaults; delegated child calls receive the caller's runtime AI. For a distinct child model, set `contextOptions: { ai: childAI }`, `executorOptions: { ai: childAI }`, and `responderOptions: { ai: childAI }`. Use `judgeAI` for the default judge/teacher and `agentIdentity` for child metadata.
- Prefer namespaced functions, e.g. `utils.search(...)` and `kb.find(...)`.
- Delegate through explicit child agents in `functions`, not recursive `llmQuery(...)`.
- Actor responses must contain one executable program. Multiple fenced code blocks reject the entire turn without executing any block; the runtime asks for one program. This applies to text and structured JSON responses, with LF or CRLF line endings.
- JavaScript actor code uses the `javascriptCode` wire key; other runtimes derive their own code field. Structured handling uses `json_schema` where supported, or a validated `json_object` for a compatible singleton string/code field when the selected model advertises that mode. The 25.4.13 native DeepSeek rules for `deepseek-flash` (V4.1 Flash), `deepseek-v4-pro` and legacy `deepseek-v4-flash` advertise function-only structured output, not a tool-free JSON-object actor path. See [DeepSeek Notes](ai.md#deepseek-notes) and the [25.4.13 source map](https://unpkg.com/@ax-llm/ax@25.4.13/index.js.map), `../ai/provider_profiles.generated.ts:739–781`.
- Keep same-turn actor [cutoff recovery](agent-rlm.md#actor-output-cutoff-versus-runtime-replay-truncation) separate from runtime execution, generic generation retries and `maxTurns`. For generated ports, see [generated-runtime scope](agent-rlm.md#generated-runtime-scope).
- Use sufficiently fresh evidence, not a console-per-turn rule. Continue deterministically when evidence is sufficient; read new inspection or discovery feedback before guarded actions. Obtain needed evidence through available, authorized capabilities before asking for clarification. See [RLM actor rules](agent-rlm.md#rlm-actor-code-rules).
- Preserve original task instructions and conditions; enrich only contextual facts, not requirements. The [bundled stage prompts](agent-rlm.md#mental-model) now say so. This is prompt policy, not semantic validation or permission: host authorization still determines allowed effects.

### Direct-response default

`directResponse` defaults to `'auto'`. When no executor authority is needed, a distiller `respond(task, evidence)` skips the executor: zero executor model calls. With no functions, child agents, or native MCP/UCP operations, the distiller prompt offers only `respond` for successful completion. With that authority present, use `respond` only for work answerable from supplied evidence without live state, side effects, or a listed function/module's domain. This is not an authorization check or a fixed route for every reply. Set `directResponse: 'off'` to disable the shortcut. See [Direct respond](agent-rlm.md#direct-respond-executor-skip); the host-function `final(...)` protocol is separate.

## Canonical Pattern

```typescript
import { agent, ai, f } from '@ax-llm/ax';

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
});
const assistant = agent(
  f().input('query', f.string()).output('answer', f.string()).build(),
  {
    agentIdentity: { name: 'Assistant', description: 'Answers user questions' },
    contextFields: [],
  }
);
const result = await assistant.forward(llm, { query: 'What is TypeScript?' });
console.log(result.answer);
```

## Audio Inputs and Speech Outputs

Audio input fields are transcribed before planner/executor/responder stages; internal stages receive text transcripts, not base64 audio. After selection of the final structured response, `:audio` output fields are synthesized as scripted speech artifacts.

```typescript
const voiceAgent = agent(
  'recording:audio, question:string -> speech:audio, summary:string',
  {
    agentIdentity: { name: 'Voice Assistant', description: 'Answers spoken requests' },
    contextFields: [],
  }
);
const result = await voiceAgent.forward(
  llm,
  {
    recording: { data: base64Wav, format: 'wav' },
    question: 'What should I do next?',
  },
  {
    speech: {
      transcribe: { model: 'gpt-4o-mini-transcribe' },
      speak: { voice: 'alloy', format: 'mp3' },
    },
  }
);
console.log(result.summary);
console.log(result.speech.data);
```

Use direct `ax(...)` or `.chat()` for native model audio instead of the transcript-first agent pipeline. See [audio](audio.md) for speech details and [generators](gen.md) for direct `ax(...)` use.

## Child Agents, Identity, and Namespaces

Pass children directly in the parent's `functions` array, alongside `fn(...)` tools. There is no separate `agents` option for new code. A child's `agentIdentity.namespace` determines its runtime module; the default is `utils`, not `agents.*`.

```typescript
const writer = agent('draft:string -> revision:string', {
  agentIdentity: {
    name: 'Writer',
    description: 'Polishes drafts',
    namespace: 'team',
  },
  contextFields: [],
});
const coordinator = agent('query:string -> answer:string', {
  functions: [writer],
  contextFields: [],
});
```

With `AxJSRuntime`, actor calls are:

```javascript
const result = await team.writer({ draft: '...' });
```

Without the child's namespace override:

```javascript
const result = await utils.writer({ draft: '...' });
```

`onFunctionCall` observers report `kind: 'internal'` for agent-derived calls and `kind: 'external'` for user-registered tools; see [observability](agent-observability.md).

### Reserved namespace names

Neither `agentIdentity.namespace` nor agent-function namespaces may use these injected runtime globals:

```text
inputs
llmQuery
batch
final
askClarification
reportSuccess
reportFailure
inspectRuntime
mcp
ucp
discover
recall
```

Choose another lowercase identifier, such as `utils`, `kb`, `tools`, `team`, or `db`.

### Explicit parent-field threading

Children receive only actor-passed arguments, not automatic parent inputs. Declare required parent fields in the child signature and pass `inputs.<field>` explicitly:

```typescript
const writingCoach = agent('draft:string, audience:string -> revision:string', {
  agentIdentity: {
    name: 'Writing Coach',
    description: 'Polishes summaries for a target audience',
    namespace: 'team',
  },
  contextFields: [],
});
const analyst = agent('context:string, audience:string, query:string -> answer:string', {
  functions: [writingCoach],
  contextFields: ['context'],
});
```

Actor call:

```javascript
const polished = await team.writingCoach({
  draft: summary,
  audience: inputs.audience,
});
```

If many children need the same value on every call, use `inputUpdateCallback` to inject it before each executor turn; do not assume automatic propagation.

## Tool Functions and Schemas

```typescript
import { agent, f, fn } from '@ax-llm/ax';

const findSnippets = fn('findSnippets')
  .description('Find handbook snippets by topic')
  .namespace('kb')
  .arg('topic', f.string('Topic keyword'))
  .returns(f.string('Matching snippet').array())
  .example({
    title: 'Find severity guidance',
    code: 'await kb.findSnippets({ topic: "severity" });',
  })
  .handler(async ({ topic }) => [])
  .build();
const analyst = agent('query:string -> answer:string', {
  functions: [findSnippets],
  contextFields: [],
});
```

Actor call:

```javascript
const snippets = await kb.findSnippets({ topic: 'severity' });
```

- Default namespace is `utils`; prefer an explicit meaningful namespace.
- `AxJSRuntime` calls use `await <namespace>.<name>({...})`. Custom runtimes should expose equivalent namespaced calls through their own `formatCallable()` guidance.
- `.arg()` and `.returns()` accept Ax field helpers or any Standard Schema v1 validator directly.
- Registered tools and child agents default to inspection. The actor saves the result; a bounded preview appears automatically on the next model turn, before another guarded tool, semantic query, or actor completion can proceed. No `console.log(...)` is required.
- Set `.resultPolicy('data')` (or `AxFunction.resultPolicy: 'data'` on a plain function definition) only when the documented successful return value can be consumed deterministically without interpreting fresh prose, caveats, or instructions. Describe argument constraints and return fields/allowed values in the schema and descriptions; inline and discovered docs carry those details. Successful `data` calls can chain or finish in one turn. Failures still produce evidence; this option does not relax handler validation, authorize effects, or change AxGen's native tool loop.
- For independently known arguments to non-native executor tools, use the [executor `batch(...)` primitive](agent-rlm.md#executor-batches), not concurrent generated calls that bypass the normal observation sequence. Exclude active native background tools and use their results from the native loop.

See the [25.4.13 declarations](https://unpkg.com/@ax-llm/ax@25.4.13/index.d.ts) (`AxFunction`, `AxFunctionBuilder`) and [source map](https://unpkg.com/@ax-llm/ax@25.4.13/index.js.map), `../agent/runtimeDiscovery.ts:498–510,589–603` and `../agent/agentInternal/runtimeGlobals.ts:156–270`.

## Grouped Function Modules

Use `AxAgentFunctionGroup` in discovery mode to establish namespace trees such as `kb.find(...)` or `metrics.score(...)` without a namespace on every `fn(...)`:

```typescript
const parent = agent('query:string -> answer:string', {
  functions: [
    {
      namespace: 'kb',
      title: 'Knowledge Base',
      selectionCriteria: 'Use for handbook and documentation lookups.',
      description: 'Knowledge base lookups',
      functions: [findSnippetsFn, searchPagesFn],
    },
    {
      namespace: 'workflow',
      title: 'Workflow Controls',
      description: 'Small control functions the actor should always see',
      alwaysInclude: true,
      functions: [completeFn],
    },
  ],
  functionDiscovery: true,
  contextFields: [],
});
```

- Group shape: `{ namespace, title, description, functions: [...] }`, with optional `selectionCriteria` and `alwaysInclude`.
- `selectionCriteria` tells the actor when to choose the module. Namespace, title, selection criteria, and description appear in discovery module docs.
- `alwaysInclude: true` keeps the group's full callable definitions inline even with discovery enabled.
- Keep `functions` entirely flat or entirely grouped; runtime validation rejects mixed plain entries and groups.
- Flat lists accept `fn(...)` tools and child agents directly. Groups contain callable entries; expose a child using `childAgent.getFunction()`.
- `relevanceRanking` is on by default; set `false` to opt out. A deterministic local ranker adds an advisory `### Likely Relevant` shortlist to the executor turn as a dynamic, non-cached field, leaving cached prompts byte-stable. Upstream reports successful small/frontier-model evaluations and generated-language parity; neither is a TypeScript runtime guarantee. See [memory and skills](agent-memory-skills.md) for details and [observability](agent-observability.md) for the `relevance_ranking` context event.

## Native MCP/UCP Attachment and Inheritance

Attach clients through the native execution context, not `functions`. Ax initializes them once, exposes `mcp.<namespace>` / `ucp.<namespace>` modules, and propagates them through actor stages, `llmQuery`, RLM, and children. Native `mcp` attachment preserves tasks, resources, subscriptions, elicitation, sampling, authorization, cancellation, and protocol metadata. Use [MCP](mcp.md) for client construction, transport/authentication, server handlers, subscription policies, task continuations, and recording/replay.

```typescript
const parent = agent('query:string -> answer:string', {
  mcp: [memoryClient, searchClient],
  mcpInheritance: 'all',
  functionDiscovery: true,
  contextFields: [],
});
// Restrict clients passed to children, not the parent's own stages.
await parent.forward(llm, { query }, { mcpInheritance: ['memory'] });
```

- The parent's distiller and executor retain attached clients. Apply `mcpInheritance` on child delegation, not between stages of one agent.
- A child's explicitly configured clients take precedence over inherited clients.
- `none` and an empty namespace list pass no parent clients.
- Resource wake-ups use `AxMCPEventSource` and an explicit authenticated `wake` route. MCP sessions are not tenant identity; obtain identity from the application's authenticated token mapping.
- An endpoint does not imply a resource URI. Inspect `client.inspectCatalog()` and choose `resourceSubscriptions` explicitly: omission selects none; `'all'` selects all discovered concrete resources; selectors can match names, descriptions, MIME types, URIs, and annotations. Templates are not expanded.
- Map events with a signature-aware `.wakeInput(...)` plan or reuse `eventInput()`. Callback `mapInput` remains signature-validated and cannot inject undeclared Agent fields.
- Multiple matching routes wake multiple Agents with independent state, authorization, retries, and runs.
- UCP lifecycle webhooks use `AxUCPWebhookEventSource`. Verify the request, then map verified profile/account state to Ax tenant identity; never derive tenant identity from the order payload.

See [event runtime](event-runtime.md) for routing and continuations.

## Host-Side Completion and Unified Final Signal

Use namespaced host functions when their handlers must decide to end the actor turn:

```typescript
import { f, fn } from '@ax-llm/ax';

const finishReply = fn('finishReply')
  .description('Complete the actor turn with the final reply text')
  .namespace('workflow')
  .arg('reply', f.string('Final reply text'))
  .returns(f.string('Final reply text'))
  .handler(async ({ reply }, extra) => {
    extra?.protocol?.final(reply);
    return reply;
  })
  .build();
const askForOrderId = fn('askForOrderId')
  .description('Complete the actor turn by requesting clarification')
  .namespace('workflow')
  .arg('question', f.string('Clarification question'))
  .returns(f.string('Clarification question'))
  .handler(async ({ question }, extra) => {
    extra?.protocol?.askClarification(question);
    return question;
  })
  .build();
```

- `extra.protocol` exists only for function calls from an active AxAgent actor runtime session.
- `extra.protocol.final(...)`, `.askClarification(...)`, and `.guideAgent(...)` are host-handler-only APIs. Actor-authored code uses runtime globals `final(...)` and `askClarification(...)` with the active runtime's syntax.
- Handler-only `extra.protocol.guideAgent(...)` stops the current actor turn and appends trusted guidance to `guidanceLog` for the next iteration. A `data` handler can use it when an exceptional result needs a new decision; ordinary returned tool text is evidence, not trusted guidance. Host controls are trusted outcomes of the authorized call, unlike actor code trying to complete before it has reviewed a new inspection result.
- Successful completion uses `final(message)` when the answer is known without another context object, or `final(task, context)` when collected evidence needs synthesis into output fields. Handlers use the same one-/two-argument forms through `extra.protocol.final(...)`, not a separate respond API.
- Both successful `final(...)` forms continue through the responder in public flows.
- `askClarification(...)` requests missing user information and bypasses the responder. It accepts a string or `{ question, type?, choices? }`; normalization and failures are specified below.

For regex literals, division, and live reads versus exported bindings, see [RLM actor rules](agent-rlm.md#rlm-actor-code-rules) and the [runtime cases](../examples/12-runtime.ts).

## Clarification and Resume State

Public `forward()` and `streamingForward()` throw `AxAgentClarificationError` on `askClarification(...)`. Prefer the error's captured continuation state, restore it with `setState(...)`, then call `forward(...)` with the user's answer:

```typescript
import { AxAgentClarificationError, AxJSRuntime, agent, ai } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });
const tripAgent = agent('userRequest:string, answer?:string -> reply:string', {
  contextFields: [],
  runtime: new AxJSRuntime(),
});
let savedState = tripAgent.getState();
try {
  await tripAgent.forward(llm, { userRequest: 'Plan a Lisbon trip' });
} catch (error) {
  if (error instanceof AxAgentClarificationError) {
    console.log(error.question);
    savedState = error.getState();
  } else {
    throw error;
  }
}
if (savedState) {
  tripAgent.setState(savedState);
  const resumed = await tripAgent.forward(llm, {
    userRequest: 'Plan a Lisbon trip',
    answer: 'June 1-5',
  });
  console.log(resumed.reply);
}
```

- `.question`: user-facing question text; `.clarification`: normalized structured payload; `.getState()`: continuation state captured at throw time.
- Agent `getState()` / `setState(...)` export/restore instance continuation state.
- Clarification can originate in either actor. Distiller clarification skips executor and responder and captures the distiller's continuation state (including its runtime bindings when export succeeds); executor clarification skips the responder and captures executor state. Restore the error's state rather than assuming agent-level `getState()` is from the stage that asked. See the [25.4.13 source map](https://unpkg.com/@ax-llm/ax@25.4.13/index.js.map), `../agent/agentInternal/actorLoop.ts:520–557` and `pipelineForward.ts:141–148,603–605,703–705`.
- `test(...)` is a harness/debug exception to public flow: it returns structured completion payloads rather than throwing clarification exceptions.

### Payload constraints

String shorthand is valid: `askClarification("What dates should I use?")`. Prefer structured payloads for richer UIs:

```javascript
askClarification({
  question: 'Which route should I use?',
  type: 'single_choice',
  choices: ['Fastest', 'Scenic'],
});
```

- Supported `type`: `text`, `number`, `date`, `single_choice`, `multiple_choice`.
- Choice entries are strings or `{ label, value? }` objects.
- Missing, empty, or malformed `single_choice.choices` downgrades to a plain clarification question instead of failing the turn.
- `multiple_choice` requires at least two valid choices; otherwise the actor turn fails with a corrective runtime error.
- Invalid payloads, such as a missing `question`, are actor-turn runtime errors, not successful clarification completions.

### State constraints

- `runtimeBindings` restores execution state; `runtimeEntries`, `actionLogEntries`, and `checkpointState` restore prompt context.
- Resume adds no fake rehydration action-log turn; provenance remains the original actor code that set the value.
- Only serializable/structured-clone-friendly values are guaranteed to round-trip.
- Reserved globals (`inputs`, tools, protocol helpers) are rebuilt fresh, not saved.
- A mutable resumed agent instance is conversation-scoped; never share it across unrelated concurrent conversations.

## Bubble Errors

Normally the actor loop catches errors and returns `[ERROR] ...` strings for recovery. Use `bubbleErrors` only for fatal infrastructure failures that must escape `.forward()`, such as database outage, authentication failure, or quota exhaustion:

```typescript
import { agent, f, fn } from '@ax-llm/ax';

class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}
const dbTool = fn('queryUsers')
  .description('Query the user database')
  .namespace('db')
  .arg('filter', f.string('Filter expression'))
  .returns(f.string('JSON result'))
  .handler(async ({ filter }) => {
    if (!isConnected()) throw new DatabaseError('DB connection refused');
    return JSON.stringify(await db.query(filter));
  })
  .build();
const myAgent = agent('query:string -> answer:string', {
  contextFields: [],
  functions: [dbTool],
  bubbleErrors: [DatabaseError],
});
```

- The option is an array of Error constructor classes, matched with `instanceof`.
- Matching errors from handlers, actor execution, or `llmQuery(...)` sub-queries bypass actor-loop catches and propagate immediately to `.forward()`.
- Do not list expected recoverable tool errors; let the actor handle `[ERROR] ...`.
- `AxAgentClarificationError` and `AxAIServiceAbortedError` always bubble unconditionally.

**Go error boundary (historical):** [PR #866](https://github.com/ax-llm/ax/blob/a2780f9a10acf6576765092153c7604babf277c3/tools/axir/internal/axir/templates/go/goRuntime.go.txt) changed agent `Forward` and `StreamingForward` to preserve the concrete `AxGenerateError` and nested provider causes through generation and agent error conversions. At that boundary, use `errors.As` for `AxGenerateError` / `AxError` and `errors.Unwrap` for the cause chain; provider status, code, retryability, response payload, URL, and request body remain available. The change addressed error identity and metadata preservation, not `bubbleErrors` policy or cross-language parity.

## Discovery Mode

Enable discovery to inspect modules and fetch callable definitions on demand:

```typescript
const analyst = agent('context:string, query:string -> answer:string', {
  agentIdentity: {
    name: 'Analyst',
    description: 'Analyzes long context',
    namespace: 'team',
  },
  contextFields: ['context'],
  functions: [writer, ...tools],
  functionDiscovery: true,
});
```

Supported actor API forms:

```typescript
await discover(item: string): void
await discover(items: string[]): void
await discover({ tools?: string | string[], skills?: string | string[] }): void
```

The `tools` path requires function discovery; the `skills` path requires `onSkillsSearch` or a non-empty `skillsCatalog`. The object form can request either path independently. A successful lookup pauses execution, even when called through an alias. Docs and skill bodies appear in the next actor prompt, not in a return value.

- `discover('kb')`: callable list for discoverable module `kb`.
- `discover('kb.findSnippets')`: full callable definition.
- `discover('lookup')`: resolves to `utils.lookup`.
- `discover({ tools: ['kb'], skills: ['release-checklist'] })`: tool docs and skill bodies in one turn.
- Group known modules, callables, and skills in one `discover(...)` request; do not use repeated calls or `Promise.all(...)`. Read the next prompt's “Discovered Tool Docs” and “Loaded Skills” before writing dependent code. No discovery hoisting, automatic splitting, or replay of later code occurs.
- Prefer exact qualified names. In discovery mode, invoking a registered executor callable without its exact contract loads the contract and pauses **before the handler runs**, including through an alias of that function. Finding a module only lists callables. Already loaded contracts, inline `alwaysInclude` definitions, and inline docs when discovery is off need no discovery turn.
- A miss is bounded recovery feedback, not a newly loaded callable. Mixed lookups retain valid docs and report misses. If a guessed name fails, use the available module list and exact callable contract rather than guessing similar names.
- The distiller can discover metadata and skills but cannot run external callables. Its tool stubs reject calls without loading contracts, so use explicit `discover(...)` when available. The responder does not use discovery. For memory recall and skills, see [memory and runtime skills](agent-memory-skills.md).

Source: [25.4.13 source map](https://unpkg.com/@ax-llm/ax@25.4.13/index.js.map), `../agent/agentInternal/coordinator.ts:114–127`, `initialization.ts:87–97`, `runtimeGlobals.ts:334–356,372–428,696–815` and `../agent/runtime.ts:1074–1099,1114–1160`.

## Core Configuration

```typescript
agent(signature, {
  ai,
  judgeAI,
  agentIdentity,
  contextFields,
  functions,
  functionDiscovery,
  autoUpgrade,
  playbook,
  citations,
  ...agentOptions,
});
```

`ai` is an optional instance-default service; `.forward(ai, ...)` can still supply the runtime service. `judgeAI` is the optional default judge/teacher for optimization flows. Identity controls user-facing prompts and child-function metadata:

```typescript
agentIdentity?: {
  name: string;
  description: string;
  namespace?: string;
}
```

- `name` is camelCase-normalized for child function names.
- `name` and `description` appear in actor/responder prompts as user-facing identity.
- `namespace` replaces the default child module `utils`, e.g. with `team`.

### Context field inline policies

Each `contextFields` entry is a plain field name or an inline-policy object for the distiller prompt:

- `{ field, promptMaxChars: N }`: inline only if the serialized value is at most `N` characters; otherwise omit it and retain it runtime-only. Use when partial data is worse than none.
- `{ field, keepInPromptChars: N, reverseTruncate?: boolean }`: always inline a truncated string excerpt. `reverseTruncate: true` keeps the last `N` characters; otherwise a prefix. Use when a prefix/suffix is useful.

`promptMaxChars` and `keepInPromptChars` are mutually exclusive on one field; `reverseTruncate` requires `keepInPromptChars`. See the [25.4.13 source map](https://unpkg.com/@ax-llm/ax@25.4.13/index.js.map), `../agent/runtime.ts:913–957`. For context selection, see [context selection](agent-context.md); for runtime visibility, see [RLM stage handoff](agent-rlm.md#mental-model).

### Auto-upgrade defaults and precedence

`autoUpgrade` is on by default and applies discovery/context controls based on character counts:

```typescript
autoUpgrade?: boolean | {
  functionDiscovery?: boolean | { aboveFunctionDocChars?: number }; // default 10_000
  contextFields?: boolean | { promoteAboveChars?: number; previewChars?: number }; // 8_000 / 1_200
}
```

- When `functionDiscovery` is unset and estimated inline docs for discoverable functions exceed approximately 10,000 characters, discovery turns on. Explicit `functionDiscovery: true | false` always wins.
- Per run, an undeclared input value over 8,000 serialized characters is kept runtime-only, with a 1,200-character truncated prompt preview and `contextMetadata` entry. The full value remains `inputs.<field>`; the responder gets the same preview.
- Explicitly declared `contextFields` retain their declared configuration.
- Required non-string fields (arrays, objects, numbers, media) are never auto-promoted; explicitly declare them as context fields when potentially large.
- Set `autoUpgrade: false`, or disable one side, for manual behavior.
- Each promotion emits `field_auto_promoted` through `onContextEvent`, with field name, original size, and preview size; see [observability](agent-observability.md).

### Learning and citations

Construction-time `playbook` and `citations` both default off. The TypeScript contracts follow below; upstream also reports generated Python, Java, C++, Go, and Rust support, which is not established by this package's declarations or offline fixtures.

**`playbook`** attaches an ACE playbook:

- When attached, `learn` defaults on. Runs with failure signals (error turns, dead ends, failing tool calls) trigger one bounded update of durable avoidance rules for the next actor prompt. Clean runs incur zero learning LLM cost.
- Restore with `playbook: { playbook: snapshot }`; snapshot can be `{ playbook, artifact }` or a bare playbook. Upstream reports the same generated-package shape and a deprecated `seed` snapshot alias; verify those package-specific migration rules before use.
- Persist via `onUpdate`; read the live handle via `getPlaybook()` or its language-shaped equivalent.
- Gate with `learn: { minSignals, dedupe }`; disable with `learn: false`.
- Reflection/curation uses `teacherAI`, defaulting first to the agent's `judgeAI`, then its `ai`. An `isExpensive` teacher also requires `teacherOptions: { useExpensiveModel: 'yes' }`; otherwise updates curate nothing.
- Evolve the same playbook from a task set with a held-out verification gate using the agent-bound evolve method; see [playbooks](playbook.md).

**`citations`** adds an optional `evidenceCitations: string[]` responder output naming used evidence: top-level curated-evidence keys and memory IDs. In-pipeline validation prevents citations to uncollected evidence; it checks existence, not entailment. Pass `true` or `{ field?, surface?: 'output' | 'hidden', includeMemoryIds?, onCitations? }`.

### Stage guidance and generated-language spellings

In TypeScript 25.4.13, the pipeline returned by `agent(...)` has **no `setInstruction` method**. Use `assistant.executor.setInstruction(text)` to **replace** that executor's stage-owned instruction; `assistant.addActorInstruction(text)` **appends** an executor-only standing rule. Neither changes distiller/responder guidance or grants tool authority. For distiller instructions and construction-time descriptions, see [stage prompt controls](agent-rlm.md#stage-prompt-controls).

Keep the canonical rules in application state and explicitly reapply the replacement after changing the signature:

```typescript
const assistant = agent('query:string -> reorderUnits:number', {
  contextFields: [], directResponse: 'off',
});
let executorRule = 'Propose enough units to reach ten units in stock.';
const packingRule = 'Round the proposed units up to a multiple of four.';
assistant.executor.setInstruction(executorRule);
executorRule = 'Propose enough units to reach twelve units in stock.';
assistant.executor.setInstruction(executorRule); // replaces ten; does not append
assistant.addActorInstruction(packingRule);     // separate additive channel
assistant.setSignature('query:string, requestTag?:string -> reorderUnits:number');
assistant.executor.setInstruction(executorRule); // reassert application policy
```

**Rebuild boundary:** this release keeps the executor actor object during pipeline `setSignature`; its stage-owned instruction and addenda survive that object's inner-program rebuild. Instructions placed on recreated inner programs are a different boundary and can disappear. The recipe above does not depend on an empty instruction being correct or claim automatic retention across replacing the agent or restoring `AxAgentState`: addenda are process-local, not serialized state. On a fresh agent, replay the application-owned replacement and each standing rule once. Do **not** append the same rule again on the existing executor after `setSignature`; that duplicates it.

Inspect `assistant.executor.getInstruction()` and that stage's `getOptimizableComponents()`, not the first matching instruction key in the pipeline aggregate: default IDs can collide across stages. The executable [stage-instructions case](../examples/09-agents.ts) changes the actual schema, records the pre-reapplication boundary, explicitly reapplies the canonical rule, and checks before/after system prompts, single-copy append, absent prior replacement, stage isolation, real stock reads, and typed proposals. Its deterministic replies prove wiring and arithmetic, not model reasoning quality.

Current implementation: [25.4.13 source map](https://unpkg.com/@ax-llm/ax@25.4.13/index.js.map), `../agent/AxAgent.ts:570–610` (stage instruction and inner-program rebuild), `../agent/agentInternal/coordinator.ts:901–911,959–975` (retained stage objects and process-local addenda), and `../agent/agentInternal/signatureBuilders.ts:254–271` (prompt composition); [public types](https://unpkg.com/@ax-llm/ax@25.4.13/index.d.ts). Generated-language names below follow their own APIs; they do not imply a TypeScript pipeline setter or identical retention boundaries.

The generated-language spellings below are upstream-reported navigation, not verified cross-language API, persistence, or observer-failure guarantees. Check the target package's versioned declarations/examples before porting.

| Language | Reported citations observer | Reported gated playbook evolve |
| --- | --- | --- |
| Python | `citations.onCitations` | `agent.playbook().evolve(dataset, options)` |
| Java | `citations.onCitations` (`Consumer`) | `agent.playbook(null).evolve(dataset, options)` |
| C++ | `set_citations_observer(...)` | `agent.get_playbook()->evolve(dataset, options)` |
| Go | `citations.onCitations` (`func([]Value)`) | `agent.GetPlaybook().EvolveAgent(ctx, dataset, options)` |
| Rust | `set_citations_observer(...)` | `playbook.evolve_agent(&mut agent, client, dataset, options)` |

Upstream reports `set_playbook_observer(...)` for C++/Rust learning updates and native `playbook.onUpdate` callbacks for Python/Java/Go.

## Public Surface and Tuning Boundary

| Area | Methods/options | Details |
| --- | --- | --- |
| Running | `forward(ai, values, options?)`, `streamingForward(ai, values, options?)` | Prefer `forward`; stream only when the caller needs streamed responder output |
| Forward-time retrieval | `skills`, `onUsedMemories`, `onUsedSkills` | [Memory and runtime skills](agent-memory-skills.md) |
| State/control | `getState()`, `setState(state?)`, `getContextMap()`, `setContextMap(map?)`, `stop()`, `getSignature()`, `setSignature(signature)`, `getFunction()`, `getId()`, `setId(id)` | Context-map evolve policy is on `AxAgentContextMap`: `infiniteEvolve`, `evolveSteps`, `maxChars`, not agent config |
| Observability | `getChatLog()`, `getUsage()`, `getStagedUsage()`, `resetUsage()`, `getTraces()` | [Agent observability](agent-observability.md) |
| Demos/tuning | `setDemos(...)`, `namedPrograms()`, `namedProgramInstances()`, `optimize(...)`, `applyOptimization(...)`, `getOptimizableComponents()`, `applyOptimizedComponents(...)` | [Agent optimization](agent-optimize.md) |
| Learning | `playbook()`, `getPlaybook()` | `playbook()` returns an agent-aware handle with `update(...)`, `render()`, state/load methods, and verified dataset evolution; `getPlaybook()` reads the live handle. Upstream reports language-shaped generated-package names; see [playbooks](playbook.md) |

- `getFunction()` requires `agentIdentity` for child-tool metadata.
- `setSignature(...)` must retain configured `contextFields`; a missing configured field throws.
- Low-level component methods are advanced hooks; normal tuning examples use `agent.optimize(...)` / `agent.applyOptimization(...)`.
- For tuning, use eval-safe tools; treat `judgeOptions` as optimize configuration; use an objective `metric` for mechanical scoring and the built-in judge for qualitative run review. Runtime authoring stays here; tuning belongs in [agent optimization](agent-optimize.md).
- [rlm-context-map-live.ts](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-context-map-live.ts) demonstrates provider-backed persistence and finite evolution.

## Event-Driven Agents

`AxEventRuntime` wakes or resumes Agents while retaining logical state. Use `createProgram(instance)` for multi-tenant Agents; do not run one mutable Agent object concurrently for multiple instance keys. Clarification and remote task completion are owned continuations, not synthetic user turns.

Declare the signature with `eventTarget('id').createProgram(signature, factory)` and map values using `eventPath`. Before invocation, the runtime verifies each created Agent against that signature. Fan out with multiple matching routes so each Agent has its own authorization, instance serialization, retry policy, and run record. See [event runtime](event-runtime.md).

## Automatic Sessions (TypeScript)

- On supporting providers, declared-background tools become native actor tools after discovery. Their results already return through the model tool loop, not the generated-code observation gate. Use that evidence; do not invoke the native tool again from generated code.
- Stateful code remains serialized. Pass the shared controller through forward options.
- Agent stage scopes: `root/distiller`, `root/executor`, `root/responder`.
- `forward()` and `streamingForward()` report identical run-control events: `started` at `root`, each stage's event pair at its scope, then `completed` or `failed` at `root`.
- If a streaming consumer stops early, the in-flight stage and `root` end with `aborted`.
- A steer targeting a stage scope applies to that stage in both methods.

## Working Examples and Resources

Fetch full working examples as needed:

- [Agent](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/agent.ts): basic agent.
- [Functions](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/function.ts): function validation.
- [Food Search](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/food-search.ts): API tools.
- [Smart Home](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/smart-home.ts): state management.
- [Customer Support](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/customer-support.ts): classification agent.
- [Abort Patterns](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/abort-patterns.ts): abort handling.
- [Smart Defaults Agent](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/typescript/long-agents/smart-defaults-agent.ts): automatic context promotion, relevance hints, and runtime tools.
- [Portable Playbook Evolve](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/python/optimization/agent-playbook-evolve.py): Python construction-time learning, validated citations, stage guidance, and verified task-set evolution; parallel Java/C++/Go/Rust examples are alongside it.

Additional RLM examples are in [RLM](agent-rlm.md); memory/skill examples are in [memory and runtime skills](agent-memory-skills.md).

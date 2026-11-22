# Executable Ax Examples

Pinned to `@ax-llm/ax`, `@ax-llm/ax-tools` and `@ax-llm/ax-ai-sdk-provider` **25.4.13**. CLI discovery declares **39 flat modules** and **242 cases**; see [observed acceptance](#observed-acceptance-boundary) for separate execution evidence. This is an executable layer beside the guides, not another skill or a replacement for API contracts. Links resolve relative to this file; run the commands below from the installed skill root.

## Select, then run

For design or mechanism selection, start with [Architecture](../references/architecture.md), choose the smallest topology, then read the owning guide and one selected module. For a narrow change, go directly to its guide/module below. Progress **core contracts → selected mechanisms → compositions**; do not preload the example corpus. CLI discovery imports metadata from all numbered modules without running cases; this is not an instruction to load all source into an agent’s context.

Run these commands from the installed `ax-skills` directory containing `SKILL.md`. From the repository root, use `--cwd skills/ax-skills/examples` instead. No original `upstream/` fixtures, Ax checkout, repository scripts or additional skill installation is required. Use **Bun 1.4.5** and the package's pinned **Biome 2.6.8**. The authoritative `bun.lock` pins Zod 4.1.11, TypeScript 5.9.3 and Node types 22.18.6.

The package also pins `ai` 7.0.2 and overrides `@ai-sdk/provider`/`@ai-sdk/provider-utils` to 4.0.0/5.0.0. The Ax Vercel provider retains its nested Zod 3.25.76 alongside root Zod 4.1.11. The Flow telemetry case uses real OpenTelemetry API 1.9.0 and trace SDK 2.0.1; the latter is registry-deprecated but included for compatibility with this collection.

```sh
bun install --no-env-file --cwd examples --frozen-lockfile
bun run --no-env-file --cwd examples check
bun run --no-env-file --cwd examples list
bun run --no-env-file --cwd examples list 01-signatures
bun run --no-env-file --cwd examples offline 01-signatures
bun run --no-env-file --cwd examples offline
```

The frozen install downloads packages and writes `examples/node_modules` with lifecycle scripts disabled; it does not install Ax skills or build the native SQLite add-on. Do not enable dependency lifecycle scripts globally. `--no-env-file` suppresses Bun's automatic `.env` loading; the runner does not load provider secrets by default. `check` runs strict Biome CI plus TypeScript `tsc --noEmit`. Use `typecheck`, `lint` or `format` separately for typechecking, linting or writing formatting changes.

`list` emits JSON with exact case IDs, titles, features, modes and per-mode `runtimes` (for example, `{"offline":"bun","live":"node"}`), without constructing services or loading an env file. It inventories both runtimes. Select an exact ID or a module basename without `.ts`; prefixes and globs are not supported. Execution selects cases in the requested mode and runtime; choosing an exact ID from the other runtime produces an error naming the correct script. Bun forwards script arguments directly; no package-manager `--` separator is needed.

### Complete offline acceptance

The default `offline` script runs **239** trusted/scripted cases on Bun. The three Node-only cases below complete the **242-case** inventory. Use **Node 24.15.0** (the verified exception version) on `PATH`; `offline:node` and `live:node` use Node's native TypeScript type stripping.

```sh
bun run --no-env-file --cwd examples setup:sqlite
bun run --no-env-file --cwd examples offline:node
```

| Node-only offline case | Reason |
| --- | --- |
| [`12-runtime/permission-and-test-boundaries`](12-runtime.ts) | The published Ax worker does not enforce the demonstrated permission boundary under Bun. This case needs Node, not SQLite. |
| [`30-event-storage/sqlite-restart-sink-redrive`](30-event-storage.ts) | Published Ax Tools hardcodes the native `better-sqlite3` add-on, which Bun rejects. |
| [`30-event-storage/local-multiworker`](30-event-storage.ts) | The same native add-on is required to exercise the shared local inbox. |

Run `setup:sqlite` only for the two SQLite cases. It prepares only the pinned `better-sqlite3` driver: use a compatible prebuild for the platform and Node version, or provide a native build toolchain (Python 3, a C/C++ compiler and the platform's build tools, such as `make` on Unix). Allow writable local scratch for the test databases. Neither native SQLite nor the permission-case exception makes the Bun lane suitable for running untrusted code.

### Opt-in live execution

Live execution is **named and opt-in**, never the default. Set `AX_EXAMPLE_ENV_FILE` to an absolute private env-file path. This exported case declares live mode; confirm current metadata with `list` before selecting another case:

```sh
bun run --no-env-file --cwd examples live --env "$AX_EXAMPLE_ENV_FILE" 26-architecture/typed-invoice
```

Keep that file outside the installed collection and version control. The runner loads only the explicitly supplied file; it does not search for root.env or print its contents. Listing ignores `--env`. For the seven AxAgent cases whose live worker needs Node, `list` reports `runtimes.live: "node"`; select the exact ID with `live:node` and the same `--env` syntax. They fail if selected in Bun live mode, but their scripted offline variants run on Bun. Pure live generation/decision cases use `live` on Bun. Do not run live cases merely to follow a guide.

### Modes, prerequisites and effects

- **Offline fixtures:** model I/O is scripted; actual SDK parsing, generation orchestration, routing, runtime, optimization and local protocol algorithms execute. Fixture outputs are not provider-quality evidence. The runner guards fixture `fetch` and Node-compatible sockets, restricting network targets on those paths to literal loopback addresses. This is not full OS egress coverage or a sandbox. No model credentials are required.
- **Live providers:** only listed live-capable cases make billed remote model/decision requests. General generation uses `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`; signature decisions use `AI_DECISIONS_PROVIDER`, `AI_DECISIONS_MODEL`, `AI_DECISIONS_API_KEY`, including `google-gemini-decisions` with `gemini-decision-1`. Optional endpoint/deployment names are `AI_API_URL`, `AI_RESOURCE_NAME`, `AI_DEPLOYMENT_NAME`, `AI_API_VERSION` and the corresponding `AI_DECISIONS_*` names. These are configuration names, not supplied credentials. Choose a compatible operation/model/profile; generic keys do not establish media, Box or native-decision capability. The runner's native accessor is Jev-only; Google/OpenAI native examples use explicit offline clients.
- **Bounds:** offline execution caps guarded fetch HTTP requests and loopback socket connections at 50 each **per case**; live execution caps fetch HTTP requests at 50 **per invocation**. The runner gives each case 120 seconds, disables redirects and requests at most 512 generated output tokens through its generation helpers. This is not a dollar budget or a guarantee covering arbitrary third-party socket traffic. Run selected live cases, not an assumed live sweep; cost and acceptance remain application-owned.
- **SQLite/events:** in-memory cases need no durable service. Only the two AxSQLite cases require the opt-in setup above. They use the native `better-sqlite3` dependency, not Node’s built-in SQLite API. Use writable local scratch, not a network filesystem. Any temporary database/store is example-owned, not a durable business record.
- **MCP/protocols:** offline protocol cases use local or injected fixtures, not an external business server. Permit loopback binding where the selected case requires it. Real server identity, OAuth credentials/consent, callback registration, authorization and delivery belong to the host application; generic model credentials do not configure them.
- **Audio/media:** modules 21, 22 and 31 are offline-only injected-fetch/WebSocket-frame examples. Generated silence and scripted responses exercise mapping/turn lifecycle, not recognition or speech quality; no microphone, real speech file, credential or external endpoint is required. Real audio needs valid spoken media, the selected provider’s dedicated STT/TTS/conversational/live capability and a suitable WebSocket runtime. Image fixtures likewise do not certify real-image decision accuracy; experimental Box has the guide’s separate constraints.
- **Effects and cleanup:** cases must own and close local servers, sockets, runtimes and temporary stores, and restore injected globals in `finally`; run the CLI sequentially rather than parallelizing shared-global fixtures. Summaries go to stdout; credentials and raw provider errors are withheld. No live microphone or external business write is part of this suite. Normal completion cleans case-owned resources; after interruption inspect only case-owned scratch. Remove `examples/node_modules` if you want to undo dependency installation; retain the lockfile and never delete unrelated data or private env files.

Supported APIs and exported modes describe intended scope. Only recorded commands/results establish what was **exercised** on a particular runtime/provider. Neither a listed case, fixture success nor typechecking proves current live acceptance, speech quality, calibrated decisions, production reliability or generated-language parity.

## Complete module map

### 1. Core contracts

| Module | Focus | Guide |
| --- | --- | --- |
| [01-signatures.ts](01-signatures.ts) | String, fluent and Zod 4 enum/array contracts; original runtime validators | [Signatures](../references/signature.md) |
| [02-generation.ts](02-generation.ts) | Structured generation, memory/few-shot examples and extraction → host rule → explanation | [Generators](../references/gen.md), [Overview](../references/llm.md#memory-and-examples) |
| [03-tools-streaming.ts](03-tools-streaming.ts) | Tool execution, mixed streamed-tool text/history and per-field mixed Zod/native tool schemas | [Generators](../references/gen.md), [Zod fields](../references/signature.md#standard-schema-zod) |
| [28-advanced-generation.ts](28-advanced-generation.ts) | Advanced execution, recovery and evaluation contracts | [Generators](../references/gen.md) |

### 2. Select mechanisms, not the whole table

For bounded semantic judgments, start with [Native decisions](../references/typesafe.md), then select a decision case below; use general generation when the required output is prose or another unsupported decision output. Keep facts, policy and effects in code.

| Module | Focus | Guide |
| --- | --- | --- |
| [04-providers.ts](04-providers.ts) | Provider construction, image output, Hydrogen limits and streaming; DeepSeek Flash defaults, catalog/runtime image discrepancy, native Chat function-only structured mode and forced-choice rejection | [Providers](../references/ai.md#gemini-4-hydrogen), [DeepSeek boundaries](../references/ai.md#deepseek-notes) |
| [05-provider-routing.ts](05-provider-routing.ts) | Capability routing and operational balancing | [Providers](../references/ai.md) |
| [27-provider-replay.ts](27-provider-replay.ts) | Provider replay and cache boundaries | [Providers](../references/ai.md) |
| [33-browser-ai.ts](33-browser-ai.ts) | Chrome-only adapter fixtures and [browser entry](browser/chrome-ai.html); model inference remains unqualified | [Providers](../references/ai.md#chrome-built-in-ai-typescriptjavascript-only) |
| [34-vercel.ts](34-vercel.ts) | Real Vercel adapter, typed output and stream consumption | [Providers](../references/ai.md#vercel-ai-sdk-integration) |
| [37-document-citations.ts](37-document-citations.ts) | Five native document sources, URL-less locations, block snapshots, passage attribution, local rejection and router preservation | [Document citations](../references/ai.md#anthropic-document-citations), [Logs/usage](../references/gen.md#normalized-chat-logs-and-usage) |
| [06-decisions.ts](06-decisions.ts) | Jev, OpenAI and Gemini Decisions; provider-specific native contracts, threshold ownership and applicability/category uncertainty | [Native decisions](../references/typesafe.md), [OpenAI Decisions](../references/ai.md#openai-decisions) |
| [39-decision-patterns.ts](39-decision-patterns.ts) | Focused semantic judgments composed with host-owned policy | [General decision patterns](../references/typesafe.md#general-decision-patterns), [Ax composition](../references/typesafe.md#ax-composition-and-optimization) |
| [07-images.ts](07-images.ts) | Image decisions and experimental localization | [Typesafe](../references/typesafe.md), [Signatures](../references/signature.md) |
| [08-refinement.ts](08-refinement.ts) | Complete-candidate selection and refinement | [Refine](../references/refine.md) |
| [09-agents.ts](09-agents.ts) | Agent construction and scoped tools | [Core agents](../references/agent.md) |
| [10-agent-delegation.ts](10-agent-delegation.ts) | Explicit child-agent boundaries | [Core agents](../references/agent.md) |
| [11-clarification.ts](11-clarification.ts) | Clarification and continuation state | [Core agents](../references/agent.md) |
| [12-runtime.ts](12-runtime.ts) | RLM execution, regex completion/retained-variable analysis and division controls; live reads versus exported snapshots | [RLM actor code rules](../references/agent-rlm.md#rlm-actor-code-rules) |
| [36-custom-runtime.ts](36-custom-runtime.ts) | Real structured-plan runtime, host tools and retained state | [RLM](../references/agent-rlm.md#custom-code-runtimes) |
| [13-context.ts](13-context.ts) | Context orientation versus within-run policy | [Context chooser](../references/agent-context.md), [RLM](../references/agent-rlm.md) |
| [14-memory-skills.ts](14-memory-skills.ts) | Recall and runtime skill discovery | [Memory and skills](../references/agent-memory-skills.md) |
| [15-observability.ts](15-observability.ts) | Usage, callbacks and attribution | [Observability](../references/agent-observability.md) |
| [32-executor-context.ts](32-executor-context.ts) | Actor cutoff recovery/exhaustion, prompt fidelity wiring, feedback truncation, fresh and batch observation handoffs, observer failures and repeated references versus cycles | [RLM](../references/agent-rlm.md), [Observability](../references/agent-observability.md) |
| [17-events.ts](17-events.ts) | Explicit routes/lifecycle; malformed string envelopes reject before routing/enqueue, valid padded strings remain unchanged | [Event rules](../references/event-runtime.md#rules), [Consumer checks](../references/event-runtime.md#testing) |
| [18-event-resume.ts](18-event-resume.ts) | Correlated continuation and delivery | [Event runtime](../references/event-runtime.md) |
| [30-event-storage.ts](30-event-storage.ts) | Event persistence and local storage | [Event runtime](../references/event-runtime.md) |
| [35-ucp.ts](35-ucp.ts) | Verified commerce webhooks, single-member freshness binding and native UCP inheritance | [Event runtime](../references/event-runtime.md#ucp-adapter), [Flows](../references/flow.md#native-mcpucp) |
| [19-mcp.ts](19-mcp.ts) | Native operations, chat catalog rebuild, Flow inheritance/cancellation and live-evaluation denial; `function-overrides` covers legacy-wrapper compatibility only | [MCP](../references/mcp.md#selected-executable-contracts) |
| [20-mcp-host.ts](20-mcp-host.ts) | Host capabilities, events and authority | [MCP](../references/mcp.md) |
| [29-mcp-oauth.ts](29-mcp-oauth.ts) | OAuth ownership and protocol fixtures; unexpected legacy SSE listener errors propagate after successful operations rather than from `finally` | [MCP](../references/mcp.md) |
| [38-mcp-events.ts](38-mcp-events.ts) | Managed subscription selection/ownership/reconnect and identity-bound task continuation | [MCP events](../references/mcp.md#selected-executable-contracts), [Event runtime](../references/event-runtime.md) |
| [21-audio.ts](21-audio.ts) | Batch and structured audio fixtures | [Audio](../references/audio.md) |
| [22-audio-live.ts](22-audio-live.ts) | Realtime protocol fixtures, not a live microphone | [Audio](../references/audio.md) |
| [31-audio-streams.ts](31-audio-streams.ts) | Streaming audio and turn lifecycle fixtures | [Audio](../references/audio.md) |
| [23-optimize.ts](23-optimize.ts) | Global optimization, full Flow-tree artifacts and original-demo baseline/bootstrap freshness | [GEPA](../references/gepa.md) |
| [24-agent-optimize.ts](24-agent-optimize.ts) | Agent optimization, isolated clarification rollouts and required/forbidden delegation policy | [Agent optimization](../references/agent-optimize.md) |
| [25-playbooks.ts](25-playbooks.ts) | Program/agent evolution, automatic failure harvesting, persisted lessons and separately owned teacher permissions | [Playbooks](../references/playbook.md#selected-executable-contracts) |

### 3. Compose after choosing boundaries

| Module | Focus | Guide |
| --- | --- | --- |
| [16-flow.ts](16-flow.ts) | Typed dependencies, native evidence, hook precedence/failures, event continuation, pending-node cancellation and OpenTelemetry lifecycle | [Flows](../references/flow.md) |
| [26-architecture.ts](26-architecture.ts) | Five application patterns; `evidence-aware-ticket` combines atomic judgments, current/unavailable/stale authoritative facts, ordered host rules and optional outcome acknowledgement | [Architecture](../references/architecture.md#11-compose-small-patterns-and-stage-verification), [Judgment policy](../references/typesafe.md#atomic-judgments-and-host-policy) |

Use `bun run --no-env-file --cwd examples list MODULE_BASENAME` to find the exact case ID. Read that case's `run(ctx)`, imports and referenced helpers—not the corpus—then run `bun run --no-env-file --cwd examples offline CASE_ID` (or `offline:node` if its offline runtime is Node). Return to the guide for constraints; examples demonstrate selected contracts, not every supported combination.

### Focused decision case selection

For provider/API/threshold contracts retain `06-decisions`; for image/Box use `07-images`; for the existing authoritative-facts composition use `26-architecture/evidence-aware-ticket`. For general patterns, read [General decision patterns](../references/typesafe.md#general-decision-patterns) and select exactly one offline-only case:

| Exact case ID / module | Select when |
| --- | --- |
| [`39-decision-patterns/candidate-selection`](39-decision-patterns.ts) | Select among host-owned candidates; distinguish empty, singleton, ambiguous and failed outcomes without inventing values. |
| [`39-decision-patterns/speculative-truth-table`](39-decision-patterns.ts) | Combine independent judgments over shared state in host code; dependent questions require a later request, not sibling answers. |
| [`39-decision-patterns/rerank-and-reweight`](39-decision-patterns.ts) | Score authorized current candidates once per dimension, preserve native evidence and reweight in code; reject no-match, split or incomplete evidence. |
| [`39-decision-patterns/verify-escalate`](39-decision-patterns.ts) | Verify a candidate, escalate uncertainty and verify a fallback again before release; errors never authorize effects. |

These cases use injected I/O, not live services or model-quality evidence. Follow the same `list MODULE_BASENAME` → inspect `run(ctx)` → `offline CASE_ID` procedure above. For Flow and optimization boundaries, read [Ax composition and optimization](../references/typesafe.md#ax-composition-and-optimization), not the whole corpus.

For the browser surface, run `bun run --no-env-file --cwd examples build:browser` to bundle with Bun, serve `examples/browser/` with a local static HTTP server and open `chrome-ai.html`. `check` includes this entry. Only a compatible Chrome profile can run its local model; scripted adapter fixtures and an unavailable-state rendering do not establish Gemini Nano inference. No model session or download starts on import.

## 25.4.13 release and runtime boundaries

Select one owning guide and exact case. The four **new** IDs are marked below; the other IDs retain or amend existing routes.

| Exact case ID / module | Contract to inspect |
| --- | --- |
| **New:** [`04-providers/deepseek-flash-capability-boundaries`](04-providers.ts) | [Flash](../references/ai.md#deepseek-notes) defaults in Chat and Responses; native Chat reports images unsupported despite catalog text/image input and wire serialization. Structured native Chat selects the function rung, not singleton `json_object`; forced raw choice rejects. No live image or alias qualification. |
| **New:** [`32-executor-context/actor-cutoff-recovery`](32-executor-context.ts) | [Same-turn recovery](../references/agent-rlm.md#actor-output-cutoff-versus-runtime-replay-truncation) in both stages: unchanged first reask, then a shorter-step note, then ordinary continuation when a reply succeeds. |
| **New:** [`32-executor-context/fresh-evidence-handoff`](32-executor-context.ts) | [Default inspection and replay](../references/agent-rlm.md#rlm-actor-code-rules): automatic fresh evidence, guarded dispatch pause, and older observation excerpting under `checkpointed` versus `full`; saved values survive. |
| **New:** [`32-executor-context/batch-evidence-handoff`](32-executor-context.ts) | [Batch](../references/agent-rlm.md#executor-batches) preflight pauses for missing contracts, then authorized independent calls yield ordered evidence; retain successful siblings and retry only needed failed work. No transaction or rollback. |
| [`32-executor-context/actor-cutoff-no-execution`](32-executor-context.ts) | Both actor stages exhaust after three extra requests and throw the last error. Rejected ordinary code does not execute; earlier effects remain. Do not generalize to native tool dispatch. |
| [`32-executor-context/dynamic-output-truncation`](32-executor-context.ts) | Default 12,000-character feedback ceiling, explicit caps, `full` without decay, and smaller checkpointed feedback without loss of live values. This is not a token, cost or memory bound. |
| [`32-executor-context/prompt-detail-comparison`](32-executor-context.ts) | Shipped actor prompts preserve original instructions and add only relevant facts. Scripted delivery is not semantic compliance; bundled templates do not read `promptLevel`. |
| [`04-providers/deployment-reasoning-dialects`](04-providers.ts) | Native, hosted and custom reasoning conventions differ; a model-like ID does not confer a deployment's privileges or capabilities. |
| [`12-runtime/regex-completion-boundaries`](12-runtime.ts), [`12-runtime/division-state-boundaries`](12-runtime.ts) | Limited scanner, not a parser or sandbox proof. Postfix probe reads live `units: 25` but exports `units: 24`; snapshot restoration is a separate contract. |
| [`17-events/invalid-envelope-before-routing`](17-events.ts) | [Typed event checks](../references/event-runtime.md#rules) reject non-string and blank `id`, `source` and `type` before routing/enqueue, preserve valid padded strings, and do not authenticate identity. |

Read [RLM stage limits](../references/agent-rlm.md#mental-model) before treating responder output as completion: the real pipeline can synthesize a fallback after exhausting `maxTurns` with no explicit final. Confirm tool outcomes and effects in the host; prefer existing sufficient evidence or an authorized inspection before [clarification](../references/agent.md#clarification-and-resume-state). Generated-source observation and cutoff contracts and [Docker fixes](../references/llm.md#docker-session-fixes-25413) are not exercised by these TypeScript fixtures.

## Exact Release and Source-Backed Cases

These case IDs route to source-backed SDK and interaction contracts, including the protocol and playbook cases below. A listed contract is not a recorded execution result; inspect current `list` metadata before running it. Each case is scoped to offline scripted/injected I/O, not live provider quality. Select its guide section and module only; no extra skill installation is required.

| Exact case ID / module | Contract to inspect |
| --- | --- |
| [`03-tools-streaming/mixed-tool-text-history`](03-tools-streaming.ts) | Tool-call text retained in next-request history, once-only fixture tool execution and merged deltas. |
| [`04-providers/hydrogen-thinking-and-limits`](04-providers.ts) | Logical/native thinking mapping, preset override, explicit cap, local unsupported-budget/cache/oversize rejection. |
| [`04-providers/hydrogen-schema-tools-stream`](04-providers.ts) | Native schema/tool request adaptation, streaming and omission of unsupported sampling controls. |
| [`37-document-citations/native-sources-nonstream`](37-document-citations.ts) | All five document source forms, cache metadata and native URL-less location ranges. |
| [`37-document-citations/stream-block-snapshots`](37-document-citations.ts) | Replace complete block snapshots; citation-only updates do not duplicate display text. |
| [`37-document-citations/generation-passage-associations`](37-document-citations.ts) | Forward/stream logs retain passage associations and result indices; flat usage retains sources, not passage maps. |
| [`37-document-citations/local-validation`](37-document-citations.ts) | Invalid source shapes, mixed citation enablement and enabled-citation/native-JSON conflicts reject before transport. |
| [`37-document-citations/router-preservation`](37-document-citations.ts) | Native documents/cited PDFs survive routing without lossy media degradation. |
| [`32-executor-context/shared-reference-serialization`](32-executor-context.ts) | Real return-mode worker repeats sibling references; [only ancestor cycles](../references/agent-rlm.md#shared-references-are-not-cycles) become `[Circular]` in executor replay. |
| [`32-executor-context/observer-failure-boundaries`](32-executor-context.ts) | Function-observer failures do not block tools; actor-turn callback failures propagate before responder execution. |
| [`03-tools-streaming/standard-schema-fields`](03-tools-streaming.ts) | Per-name Zod arguments mixed with native fields, optional argument/hint, returned array and original-validator rejection. |
| [`23-optimize/flow-tree-components`](23-optimize.ts) | Optimize two-node Flow, serialize/restore/apply full stable child component keys and observe child requests. |
| [`23-optimize/bootstrap-baseline-freshness`](23-optimize.ts) | Original caller-demo baseline before bootstrap, separate budgets, held-out-only stale-trace exclusion and explicit small-budget rejection. |
| [`24-agent-optimize/clarification-rollouts`](24-agent-optimize.ts) | Score clarification without responder/output, isolate evaluation continuation state and restore caller state. |
| [`24-agent-optimize/delegation-call-policy`](24-agent-optimize.ts) | Distinguish required child, ordinary tool and no-child answers; score forbidden delegation and narrowed arguments. |
| [`16-flow/runtime-hook-resolution`](16-flow.ts) | Forward/factory/child/global hook precedence without mutation; telemetry fail-open versus limiter rejection; cleanup isolation. |
| [`16-flow/event-continuation`](16-flow.ts) | Actual Flow event target receives signature-valid event input and correlated event context; owned continuation resumes once. |
| [`16-flow/session-cancel-pending`](16-flow.ts) | Cancel two controlled pending Flow nodes; reject the run, accept neither result and close node sessions. |
| [`19-mcp/native-chat`](19-mcp.ts) | Actual `axMCPChat` loop retains raw results and rebuilds next-step tool definitions after a catalog notification. |
| [`19-mcp/native-flow`](19-mcp.ts) | External native MCP context reaches nested Flow nodes with shared client ownership, raw results and abort propagation. |
| [`19-mcp/live-evaluation-guard`](19-mcp.ts) | `agent.optimize()` denies live MCP before protocol/model/tool effects; MCP requires replay, not a `sandbox` label. |
| [`38-mcp-events/managed-subscriptions`](38-mcp-events.ts) | Concrete-resource selection/diff, selector/transition failure recovery, manual/two-source ownership and reconnect; no implicit model wake. |
| [`38-mcp-events/owned-task-resume`](38-mcp-events.ts) | Real task notifications resume only a trusted identity's namespace/task-correlated continuation; reject foreign ownership and duplicate effects. |
| [`25-playbooks/automatic-failure-harvesting`](25-playbooks.ts) | Construction-time attachment harvests real recoverable failures, calls `onUpdate`, persists/restores lessons and leaves clean runs unchanged. |
| [`25-playbooks/teacher-permission`](25-playbooks.ts) | Program reflector/curator permission and distinct agent weakness-miner and proposal-application teacher options, with pre-HTTP denial. |

For citations, native provenance is attribution, not truth; document indices belong to the matching request. For all cases retain the [mode/effect/cleanup rules](#modes-prerequisites-and-effects): scripted HTTP/SSE does not imply external networking, return-mode workers must stop, and owned Flow/event/tool barriers and temporary state must close. No citation fixture requires a real PDF upload, hosted file, credential or billed call. The interaction rows specify bounded contracts, not promises of quality improvement, rollback or generated-language acceptance.

The protocol/playbook rows need only the pinned SDK, scripted AI and owned local/injected peers; no OAuth credential, external MCP endpoint or billed model is required. Their IDs are **offline-only** despite `live-evaluation-guard` naming the denied transport mode. They mutate fixture catalogs/subscriptions, continuation stores and in-memory playbook snapshots, not external business records. Close sources/runtimes/listeners before caller-owned clients, stop runtime workers, restore injected globals and remove only owned scratch. Playbook automatic adaptation is trusted feedback, not held-out proof; the existing verified-retain/reject cases cover verification.

## Observed acceptance boundary

The exact [examples audit](../assets/examples-audit.json) and [coverage audit](../assets/coverage-audit.json) receipts for root task `ax-skills-b6v` cover the published 25.4.13 integration at `8488a0f9afea4af0ca482a0eb8503cb3e7ba7b34`, not the Bun 1.4.5/Biome migration or later edits. On **2026-11-19 UTC**, CLI discovery listed **242 cases in 39 modules**; the separate full offline run used the old `node --import tsx run.ts` script, executed all 242 and exited 0. It recorded **zero model HTTP requests**, 197 fixture HTTP requests and 53 loopback connections. Strict TypeScript and the then-esbuild browser build also exited 0; the build does not qualify browser inference. None of these results establishes live quality, independent review, generated-language parity or whole-root semantic acceptance.

Earlier receipts at `58063332e6433ad46c73bc5237478cb58eab68f2` separately record **238 offline cases in 39 modules** passing on **2026-11-17**, with zero model HTTP requests, 197 fixture HTTP requests and 53 loopback connections. Zero model HTTP is not zero network traffic. See the archived [examples audit](https://github.com/PhilosophiMoonbeam/ax-skills/blob/58063332e6433ad46c73bc5237478cb58eab68f2/skills/ax-skills/assets/examples-audit.json) and [coverage audit](https://github.com/PhilosophiMoonbeam/ax-skills/blob/58063332e6433ad46c73bc5237478cb58eab68f2/skills/ax-skills/assets/coverage-audit.json).

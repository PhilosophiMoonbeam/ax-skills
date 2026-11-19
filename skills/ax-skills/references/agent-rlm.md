# AxAgent RLM Runtime, Context Policy, and Semantic Queries

Source API snapshot: `@ax-llm/ax` 25.4.13. Use for RLM code execution, `AxJSRuntime`, `contextFields`, `contextPolicy`, `liveRuntimeState`, `promptLevel`, stage prompts, `executorModelPolicy`, `maxRuntimeChars`, `agent.test(...)`, `llmQuery(...)`, `recursionOptions`, and long-running runtime behavior. Not ordinary setup: see [agent setup](agent.md) for child agents, tool namespaces, clarification, and `bubbleErrors`; [observability](agent-observability.md) for callbacks/logs; [memory and skills](agent-memory-skills.md) for persistent orientation, retrieval, and skill loading.

## Use These Defaults

- Use `agent(...)`, not `new AxAgent(...)`.
- Save results that need interpretation, then read the next model turn's evidence before taking guarded actions. Continue within the current turn for deterministic work that already has sufficient inputs. No console call is required for automatic tool observations.
- Rely on `autoUpgrade` (ON by default) for oversized inputs you did not declare in `contextFields`: any input value over ~8k serialized chars is kept runtime-only automatically, with a 1,200-char prompt preview plus a `contextMetadata` line, while the full value stays live in the runtime as `inputs.<field>`. Declare a field in `contextFields` only when you want a specific inline policy (`promptMaxChars` / `keepInPromptChars`) or need a large required non-string field kept out of the prompt (those are left inline by auto-upgrade).
- Choose replay and model upgrades using [Prompt Level and Model Selection](#prompt-level-and-model-selection); add task guidance through [stage prompt controls](#stage-prompt-controls).
- Use `contextMap` for recurring long-context corpora when the distiller should start future runs with a small persisted orientation cache.
- Use explicit child agents in `functions: [...]` when the task needs specialist agents with their own tools/runtime.
- Use `llmQuery(...)` only for focused semantic questions over narrowed context; it does not spawn a tool-using child AxAgent.
- Prefer `maxSubAgentCalls` only when you need an explicit cap on `llmQuery(...)` sub-query usage.

## Mental Model

`AxAgent` normally runs a three-stage pipeline:

```text
distiller (RLM actor) -> executor (RLM actor) -> responder (synthesizer)
```

- **distiller** always runs first, with original inputs and runtime-only context fields. It gathers evidence through code, then calls `final(request, evidence)` to populate `inputs.executorRequest` and live evidence. Preserve the user's instructions and conditions in their original wording; add only contextual facts needed to resolve references or follow-ups such as “yes, do it.” Do not invent checks, steps, deliverables, reports or completion conditions. With no context fields, normalization still runs with `contextFields: []`. Metadata/skills discovery can be available, but external callable execution is blocked; the distiller is not a capability gate.
- **executor** receives non-context original inputs subject to exclusions, `inputs.executorRequest`, a compact `distilledContextSummary` and live `inputs.distilledContext`. Raw fields listed by `contextMetadata` are readable in `inputs`, not pasted in full into the prompt. When distillation adds or omits requirements, resolve the requested work against original task inputs. Execute only host-authorized actions and report actual tool outcomes; original user wording does not grant authority.
- **responder** synthesizes the user's output signature from actor evidence. If the executor exhausts `maxTurns` without a completion payload (for example, after an inspection on the last turn), Ax can synthesize a fallback `final` from available evidence and still run the responder. A returned answer or evaluation `completionType: 'final'` does not prove explicit task completion (`../agent/agentInternal/actorLoop.ts:500–515,574–586`, `pipelineForward.ts:703–739`, `pipelineForwardForEvaluation.ts:201–214`). Clarification from either actor bypasses synthesis; [restore the state carried by the error](agent.md#clarification-and-resume-state).

**Shipped prompt policy:** both actor templates now include the original-task rules above ([25.4.13 source map](https://unpkg.com/@ax-llm/ax@25.4.13/index.js.map), `../agent/templates.generated.ts:8–9`, decoded distiller line 11 and executor line 15). Handoff forwards the `executorRequest` and evidence without checking semantic equivalence. It forwards the original non-context inputs subject to stage exclusions, and raw context metadata only when the runtime session is shared (`../agent/agentInternal/pipelineForward.ts:540–593`). Do not treat retrieved content as instructions, assume excluded fields are restored to the executor, or use prompt fidelity as validation or authorization.

### Actor output cutoff versus runtime replay truncation

If actor-program generation fails with a message containing `Max tokens reached before completion` or `Invalid function arguments`, the **same distiller or executor turn** reasks up to three times: one with unchanged prompt inputs, then up to two with a shorter-step note appended to the action log for that request. Matching is case-sensitive across at most six nodes starting at the thrown error, following `.cause` only on `Error` objects. A nonmatching error escapes immediately; on exhaustion the helper rethrows the **last caught error**. This also covers malformed function arguments without a `length` finish reason if the matching error reaches the helper.

There is no separate cutoff option; these reasks use the same effective abort signal, are separate from `maxRetries` and generic generation/transport handling, and do not consume extra `maxTurns` iterations. They still cost generation requests. See the [25.4.13 source map](https://unpkg.com/@ax-llm/ax@25.4.13/index.js.map), `../agent/agentInternal/cutOffReply.ts:13–60`, `actorLoopTurn.ts:329–349,373–483`, `actorLoop.ts:500–515` and `../dsp/functions.ts:180–186`.

Rejected ordinary actor code does not execute, even if a length-tagged reply contains syntactically valid code. This does not undo prior effects, reclaim a fresh continuation snapshot, or authorize replay. Provider-native function dispatch can precede the length failure (`../dsp/response/nonStreaming.ts:125–157,243–247`); reconcile uncertain effects in the application. In contrast, [runtime output truncation](#dynamic-output-truncation) happens after execution and only bounds visible feedback.

See [executor/context cases](../examples/32-executor-context.ts): `32-executor-context/actor-cutoff-recovery` targets retry prompt order and successful continuation; `32-executor-context/actor-cutoff-no-execution` targets exhaustion, rejected code and prior effects. These are separate from generated-port evidence below.

### Direct respond (executor skip)

With `directResponse: 'auto'` (the default), the distiller can end the run with the `respond(task, evidence)` primitive when the task needs no executor authority — the executor stage is skipped entirely (zero executor model calls) and the responder synthesizes straight from the distiller's evidence. Unlike `final`, whose evidence stays live in the shared session by reference, `respond`'s evidence crosses into the responder prompt (budgeted by `maxEvidenceChars`), and the distiller's runtime variables are exported as the cross-run state exactly as the executor's would have been.

- **Static agents** (no functions, child agents, or native MCP/UCP operations) get a respond-only distiller prompt under `'auto'`. This is a prompt choice, not a runtime ban on `final`; a `final` handoff can still reach the executor.
- **Agents with executor authority** get `respond` alongside `final` under a conservative prompt covenant: use it only to answer from sufficient provided context, never when a listed function/module covers the need, a request asks for live/fresh state, or a side effect is required. Skipping executor work must be consistent with the authorized task; this choice is not an application safety boundary.
- `directResponse: 'off'` removes the primitive from the prompt and the runtime, and the pipeline rejects a respond payload outright. Source: `../agent/agentInternal/signatureBuilders.ts:309–320`, `promptAssembly.ts:36–45`, `pipelineForward.ts:223–229`.

Treat both actor stages as long-running code runtime sessions that the actor steers over multiple turns, not as fresh script generators on every turn. `AxJSRuntime` is the default; custom runtimes set `language` so the actor code field becomes `<language>Code` such as `pythonCode` while JavaScript keeps the legacy `javascriptCode`.

- Successful code leaves variables, functions, imports, and computed values available in the runtime session.
- The actor should continue from existing runtime state instead of recreating prior work.
- `actionLog`, `liveRuntimeState`, and checkpoint summaries control prompt visibility, not whether an initialized binding still exists or whether an effect happened.
- Rebuild state only after an explicit runtime restart notice or when you intentionally need to overwrite a value.

## RLM Actor Code Rules

For `AxJSRuntime`, write one runnable program per turn. Stop at the next decision that depends on information the model has not yet seen. Before more work, check what is already saved and whether that evidence is sufficient and current enough for the authorized task. If an available capability can resolve a missing fact, use it before asking for clarification. Report actual outcomes, including partial success or failure; do not infer an effect from submitted code.

- **Local work:** deterministic computations can share a turn. In stdout mode, `console.log(...)` is optional and does not yield. Log a compact projection if the next turn needs it. In the executor, logging and completion can coexist when no fresh observation is pending. The bundled distiller prompt prefers compact local inspections and a separate handoff; that is stage guidance, not a universal runtime restriction.
- **Inspection (default):** await a tool or child agent, bind its result, then end the block. The result is automatically shown to the next model turn within the output budget. Local statements can still run after the tool returns; the next guarded host call, `llmQuery(...)`, `final(...)`, `respond(...)`, or `askClarification(...)` pauses before dispatch. Do not prewrite a dependent action and count on the pause as a permission or effect-safety boundary.
- **Deterministic data:** [`.resultPolicy('data')`](agent.md#tool-functions-and-schemas) permits chaining after a successful documented result, including same-turn completion. Thrown ordinary failures still produce error evidence. When a returned status or caveat could change the decision, leave the policy at `inspect` or signal the exception with [trusted host guidance](agent.md#host-side-completion-and-unified-final-signal). Native model-tool results already return to the model via the native tool loop; this gate applies to generated code invoking runtime globals.
- **Discovery and recall:** `discover(...)` and a non-empty `recall(...)` lookup pause the current execution on completion, even through aliases. Read the new docs, skills, or memories in the next prompt. An undiscovered executor callable loads its exact contract without dispatch; missing names only yield bounded recovery feedback. Distiller tool stubs reject calls without loading contracts; use explicit `discover(...)` where available. See [discovery mode](agent.md#discovery-mode) and [recall](agent-memory-skills.md).
- **Continue after a pause:** use fresh observations and initialized bindings (when runtime inspection is supported), not submitted source or a prior checkpoint, to determine what happened. The blocked handler did not run, but local statements can run until the pause propagates on that execution path; for example, a binding initialized before awaiting the blocked call's rejection can survive. Statements after the point of propagation on that path did not run. A pause is not an ordinary tool failure. Reuse initialized values and issue only still-needed calls. Do not replay the submitted program or treat an uninitialized declaration as a saved result. Read or project the live binding if evidence is truncated or a summary appears stale. Budget `maxTurns` for discovery and review.
- **Keep async work in its turn:** await host calls and handle rejections explicitly. `AxJSRuntime` tracks pending host calls and promise continuations within the execution timeout; ignored async errors can surface before the next turn without discarding already initialized values. Settled or expired executions cannot start host work in a later turn. Cancellation or a pause does not roll back effects already dispatched. End the block on an accepted `final(...)` or `askClarification(...)`; do not catch runtime control signals to keep acting.

For custom runtimes, follow `getUsageInstructions()`, primitive overrides and callable formatting, and check how the runtime propagates host signals and persists bindings. TypeScript source: [25.4.13 map](https://unpkg.com/@ax-llm/ax@25.4.13/index.js.map), `../agent/agentInternal/turnObservations.ts:194–388` (dispatch guard at 241–250), `runtimeGlobals.ts:156–270,334–356,696–815`, `runtimeExecution.ts:95–139,186–219,318–325,483–486`, `runtimeExecutionHelpers.ts:98–180`, and `../funcs/worker.runtime.ts:1675–1815,2030–2067,2182–2197,2814–2840`.

The 25.4.13 lightweight scanner masks terminated single-line regex literals in unambiguous expression positions and preserves division after literals, updates and property reads. This is neither a full parser nor a sandbox proof (`../util/jsAnalysis.ts:5–7,197–208,243–280`); static checks do not require a console call (`../agent/runtime.ts:1074–1099`). See `12-runtime/regex-completion-boundaries` and `12-runtime/division-state-boundaries` in the [runtime cases](../examples/12-runtime.ts).

**Live/export discrepancy:** first observed on 25.4.12, this was also observed in the offline 25.4.13 `12-runtime/division-state-boundaries` case linked above: after `let units = 24` and `const quotient = units++ / 3`, the live binding showed `units: 25` while the exported binding showed `units: 24`; `quotient` was `8` in both. The worker copies declarations to globals and snapshots own-property values (`../funcs/worker.runtime.ts:838–847,2182–2197,2213–2239,2507–2539`); `runtimeExecutionSession.ts:327–349` exports those bindings. A later lexical update need not refresh a copied property. This is a bounded observation for that case, not a general guarantee about postfix restoration.

Two executor turns with an already documented inspection tool:

```javascript
// Turn 1: save fresh evidence; the tool result is automatically visible.
const customers = await kb.findCustomers({ segment: 'active' });
```

```javascript
// Turn 2: after reviewing the result and confirming it is sufficient.
const topCustomers = customers.slice(0, 3);
await final('Report the first three matching customers', { topCustomers });
```

### Executor batches

In TypeScript, `batch(...)` takes a non-empty array of `{ name, args }` entries naming registered qualified callables. **Exclude active native background tools:** use the evidence already delivered by the native tool loop. Batching can bypass the direct binding's repeat-call guard and run the handler again, duplicating side effects (`../agent/agentInternal/runtimeExecution.ts:298–365`, `runtimeGlobals.ts:388–414,611–627,654–660`). Supply all arguments up front; `args` may be an object or positional array and defaults to `{}` when omitted. Use known independent arguments, not callbacks or arguments chosen by interpreting an earlier member. For example:

```javascript
const documents = await batch([
  { name: 'kb.read', args: { id: 'doc-a' } },
  { name: 'kb.read', args: { id: 'doc-b' } },
]);
```

Batch preflight checks the entry shapes and callable names, loads all missing contracts, and pauses before any dispatch if new docs are needed. Read the argument/return schemas and descriptions before issuing the batch; preflight is neither all-member schema validation nor effect authorization. TypeScript runs members with bounded concurrency and returns outcomes in input order: `{ name, status: 'fulfilled', value }` or `{ name, status: 'rejected', error }` (a message string). Bind the returned array; inspection results and ordinary failures are shown as bounded, indexed evidence and require a fresh model turn before guarded actions. A successful batch of `data` calls may continue deterministically in the same turn.

An ordinary failed member does not discard successful siblings; retry only failed work when appropriate and authorized. Host completion/guidance, clarification, abort, and configured bubbled errors are terminal for batch dispatch, not ordinary rejected outcomes returned to the actor; in-flight members may already have done work. No transaction or effect rollback is implied. See `../agent/runtimePrimitives.ts:55–65`, `../agent/agentInternal/runtimeGlobals.ts:589–693`, and `32-executor-context/batch-evidence-handoff` in the [executor/context cases](../examples/32-executor-context.ts).

### Generated runtime scope

The [release AxIR cutoff loop](https://github.com/ax-llm/ax/blob/8dbb33d64629d935cc21d79734300018677d73dc/ir/axcore/agent.axir#L14287-L14379) ([PR #912](https://github.com/ax-llm/ax/pull/912)) covers generated Python, Go, Rust, Java and C++ runtime-mode distiller/executor loops, including streaming: up to three extra requests, first unchanged, others with a note. The ports match the surfaced message rather than walking TypeScript's cause chain. Empty cutoffs now report the max-token error; malformed tool-call payloads can instead go through generated tool-error recovery. The port-only `actorMode: 'completion'` path and empty non-cutoff replies are unchanged. Generated `validation_retries` is a separate generator setting, not a cutoff knob.

The [release AxIR observation source](https://github.com/ax-llm/ax/blob/8dbb33d64629d935cc21d79734300018677d73dc/ir/axcore/agent.axir#L10531-L10690) ([PR #914](https://github.com/ax-llm/ax/pull/914)) covers the five **embedded JavaScript** adapters, not arbitrary custom runtimes or completion-only stages. It implements discovery/recall pauses, initialized bindings, deterministic data chaining, and observation-aware replay. Unlike TypeScript, generated `batch` preflight accepts object args only (no positional arrays), permits at most 128 entries, and excludes active native tools (`agent_runtime_execute_batch`, lines 10610–10690). Members dispatch synchronously in input order; a thrown child error can interrupt later siblings rather than become a rejected outcome ([`agent_execute_callable`](https://github.com/ax-llm/ax/blob/8dbb33d64629d935cc21d79734300018677d73dc/ir/axcore/agent.axir#L5288-L5311)). Use `result_policy("data")` for Python/Rust builders and C++ `Tool`, `WithResultPolicy("data")` on Go `Tool`, or `resultPolicy("data")` on Java `Tool.Builder`. These are source-only observations, not installed-package or cross-language parity claims.

## Context Policy Presets

`contextPolicy.preset`:

- `full`: Replay completed code and outputs as recorded, with no checkpointing or dynamic output-ceiling decay. Paused source is still omitted from prompts.
- `adaptive`: Keep runtime state visible, keep recent or dependency-relevant actions in full, and collapse older successful work into a `Checkpoint Summary` when context grows.
- `checkpointed` (default, `balanced`): Keep fresh observation feedback within its normal output budget, excerpt large older paused observations, and checkpoint older successful history when rendered replay remains over budget.
- `lean`: Most aggressive compression. Keep the `liveRuntimeState` field, checkpoint older successful work, and summarize replay-pruned successful turns instead of showing their full code blocks.

Important:

- `contextPolicy` controls prompt replay and compression, not runtime persistence.
- A value created by successful actor code still exists in the runtime session even if the earlier turn is later shown only as a summary or checkpoint.
- `discover(...)` docs accumulate in actor prompt fields, not as raw action-log output. Action-log mentions and tool text are evidence, not instructions.
- Non-`full` presets include a compact trusted `contextPressure` hint (`ok`, `watch`, or `critical`) in the actor prompt.
- Prompt compaction is separate from the raw exported action state. The `paused` action entry retains submitted source and bounded feedback, but prompt replay and checkpoint inputs omit its source. Use the saved result and recorded call/binding evidence, not the raw submitted code, to infer what actually ran.
- Checkpointed replay can render an older paused result as a head/tail excerpt even before a checkpoint exists: eligible outputs are non-error, non-policy and longer than 768 characters; the first 480 and last 260 characters are used only when the excerpt is shorter. This can emit `action_compacted` with `reason: 'older_observation'`. The newest observation stays visible; old checkpoints are historical evidence, not grounds to skip a live read. See `../agent/contextManager.ts:764–823,1195–1196,1759–1767,1828–1853` in the [source map](https://unpkg.com/@ax-llm/ax@25.4.13/index.js.map).

## Prompt Level and Model Selection

`contextPolicy.preset` controls raw-history replay; `executorModelPolicy` upgrades only the executor. Leaner replay usually requires a stronger model; `full` gives smaller models more raw prior evidence.

| Task/model needs | Choose |
| --- | --- |
| Short tasks, actor-loop debugging, uncompressed retained feedback, or weaker/cheaper models | `full` |
| Most RLM tasks (default); long multi-turn work with medium-to-strong models | `checkpointed + balanced` |
| Earlier compression of older successful work while live runtime state remains visible | `adaptive + balanced` |
| Very long, character-constrained work that can continue from current runtime state plus compact summaries; strong model | `lean` |

`promptLevel: 'default' | 'detailed'` is a supported explicit option, but the 25.4.13 bundled distiller and executor templates ignore it. The value reaches both template renderers; neither template reads it. Do not use `'detailed'` to request extra scaffolding or `'default'` to reduce replay. Add guidance through [stage descriptions](#stage-prompt-controls) or [stage instructions](agent.md#stage-guidance-and-generated-language-spellings); use `contextPolicy` to change replay. See the [25.4.13 source map](https://unpkg.com/@ax-llm/ax@25.4.13/index.js.map), `../agent/agentInternal/coordinator.ts:107–129`, `signatureBuilders.ts:274–285`, `../agent/rlm.ts:666–672,888–895` and `../agent/templates.generated.ts:8–9`.

`32-executor-context/prompt-detail-comparison` in the [executor/context cases](../examples/32-executor-context.ts) uses `directResponse: 'off'`, explicit stage models and responder output to distinguish prompt delivery from compliance. The bundled-template limitation is established by source, not by identical task outcomes.

For a cheap default actor, use `executorModelPolicy` to upgrade only the executor after consecutive error turns or discovery in specified namespaces. Use `contextPolicy.budget` for prompt pressure; history size is not a model-upgrade trigger.

## Option Layout

Top-level controls:

- `recursionOptions.ai`: routes `llmQuery(...)` sub-query calls to a different AI service than the parent run.
- `recursionOptions.model`, `modelConfig`, and other forward options: tune the AxGen call used by `llmQuery(...)`.
- `maxSubAgentCalls`: shared `llmQuery(...)` sub-query budget across the whole run. Default is `100`.
- `maxBatchedLlmQueryConcurrency`: caps batched `llmQuery([...])` concurrency.
- `maxRuntimeChars`: interpreter and observation feedback ceiling, default `12000`. Set `maxRuntimeChars: 3000` explicitly if you need the old ceiling. `full` uses the ceiling unchanged; other presets can reduce it as action history grows. See [dynamic output truncation](#dynamic-output-truncation).
- `summarizerOptions`: default model/options for the internal checkpoint summarizer.
- `contextPolicy`: replay/checkpointing/compression policy.
- `contextMap`: optional persistent orientation cache injected into the distiller and updated once after each successful run. `AxAgentContextMap` evolves indefinitely by default; use `{ infiniteEvolve: false, evolveSteps: N }` on the map object for finite warmup followed by reuse.
- `contextOptions`: distiller-stage forward options.
- `autoUpgrade`: smart defaults, ON by default. Auto-enables `functionDiscovery` for large tool catalogs and keeps oversized undeclared input values runtime-only with a truncated prompt preview. Set `false` to opt out, or tune per side: `{ functionDiscovery?: boolean | { aboveFunctionDocChars }, contextFields?: boolean | { promoteAboveChars, previewChars } }`. Explicit `functionDiscovery` and declared `contextFields` always win.
- `executorOptions`: executor-stage forward options such as `description`, `model`, `modelConfig`, `thinkingTokenBudget`, and `showThoughts`.
- `executorModelPolicy`: executor-only model override rules based on consecutive error turns or discovery fetches from listed namespaces.
- `responderOptions`: responder-stage forward options.
- `judgeOptions`: built-in judge options for `agent.optimize(...)`; for tuning workflows see [agent optimization](agent-optimize.md).

Canonical shape:

```typescript
const researchAgent = agent('query:string -> answer:string', {
  contextFields: ['query'],
  runtime,
  maxTurns: 3,
  recursionOptions: {
    model: 'gpt-6-luna',
  },
  maxRuntimeChars: 12000,
  summarizerOptions: {
    model: 'gpt-6-luna',
    modelConfig: { temperature: 0.1, maxTokens: 180 },
  },
  contextPolicy: {
    preset: 'checkpointed',
    budget: 'balanced',
  },
  contextOptions: {
    model: 'gpt-6-luna',
  },
  executorOptions: {
    description: 'Use tools first and keep JS steps small.',
    model: 'gpt-6-luna',
  },
  executorModelPolicy: [
    {
      model: 'gpt-6-sol',
      aboveErrorTurns: 2,
      namespaces: ['db', 'kb'],
    },
  ],
  responderOptions: {
    model: 'gpt-6-luna',
  },
});
```

Semantics:

- Top-level `maxTurns` caps each actor stage's turn loop. Stage option bags
  contain forward options; they do not declare a `maxTurns` override.
- `maxRuntimeChars` bounds interpreter and observation feedback, not the whole action-log entry or history managed by `contextPolicy.budget`.
- `summarizerOptions` tunes only the internal checkpoint summarizer. It does not change actor or responder model selection.
- `executorModelPolicy` only switches the actor model. It does not change `responderOptions.model`.
- `llmQuery(...)` uses `recursionOptions.ai` when set, otherwise it falls back to the parent `.forward(ai, ...)` service.
- `recursionOptions` configures the AxGen semantic sub-query used by `llmQuery(...)`; it does not create a child AxAgent and cannot give the sub-query tools.
- `executorModelPolicy` entries are ordered from weaker to stronger. If multiple rules match, the last matching entry wins.
- If one entry defines `namespaces`, any successful `discover(...)` function-definition fetch from one of those namespaces marks the rule as matched starting on the next actor turn.
- Do not add `recursionOptions` unless the user needs different model/options for `llmQuery(...)`.

## Dynamic Output Truncation

The `full` preset applies the fixed `maxRuntimeChars` ceiling each turn. Other presets start at that ceiling with no action history and reduce it linearly as action-log code/output approaches `targetPromptChars`. The lower bound is the larger of 15% of the ceiling and 400 characters, capped at the configured ceiling. This bounds interpreter and observation feedback, not the combined replayed action output: the turn can append a discovery summary and prepend native tool activity without clipping the combined text again. Runtime values are not truncated by replay.

- Observation and interpreter output share the per-turn budget. An observation preserves complete compact JSON when it fits; oversized values use bounded samples, sharing space across fields and batch results with explicit omission markers. A compact projection of a saved value is more useful than printing the whole result again.
- Interpreter/console replay uses type-aware truncation: large arrays can retain head/tail samples, deeply nested structures use placeholders, and long stacks are shortened. This is separate from model reply cutoff and from compaction of **older** observations.

See the [25.4.13 source map](https://unpkg.com/@ax-llm/ax@25.4.13/index.js.map), `../agent/config.ts:22,493–499`, `agentInternal/runtimeExecution.ts:157–170`, `runtimeExecutionHelpers.ts:128–138`, `actorLoopTurn.ts:549–561`, `discoveryHelpers.ts:162–174`, `turnObservations.ts:11–24,309–388`, `truncate.ts:29–48`; `32-executor-context/dynamic-output-truncation` in the [executor/context cases](../examples/32-executor-context.ts) distinguishes omitted versus explicit ceilings and `full` versus non-`full` replay.

### Shared references are not cycles (25.4.11)

Object-valued runtime returns pass through Ax's `formatInterpreterOutput` → `smartStringify` before replay truncation. [PR #893](https://github.com/ax-llm/ax/pull/893) makes cycle detection ancestor-scoped: `{ primary: shared, backup: shared }` and `{ first: [shared], second: [shared] }` retain both copies; a true ancestor back-reference becomes `[Circular]`. Depth and character limits still apply. This is replay serialization, not a promise to encode arbitrary graphs losslessly or preserve object identity in JSON.

Default stdout-mode `console.log(...)` already returns text and bypasses this object serializer. The [`shared-reference-serialization` case](../examples/32-executor-context.ts) deliberately uses `new AxJSRuntime({ outputMode: 'return' })`, whose usage instructions permit `return` or a trailing expression. It checks real worker identity, both serialized sibling paths, the true-cycle marker, and the next executor requests; no replacement serializer is used.

Exact [25.4.11 source map](https://unpkg.com/@ax-llm/ax@25.4.11/index.js.map): `agent/truncate.ts:159–210`, `agent/runtime.ts:678–695`, `agent/agentInternal/runtimeExecutionHelpers.ts:68–110`, and `funcs/jsRuntime.ts:39,210–225`.

[PR #896's Core source](https://github.com/ax-llm/ax/blob/6b9807f9722dfc1852ff65f1961f0a08958aa09d/ir/axcore/agent.axir#L2314-L2420) carries the same ancestor-only rule into `agent_depth_limited_value` / `agent_smart_stringify`. Its native identity primitives use Python `is`, Java reference `==`, C++ shared-pointer identity, Rust `Rc::ptr_eq`, and Go pointer identity (plus slice length). This is source-observed generated-port design, not executed generated-package acceptance; the local regression executes TypeScript only.

## Stage Prompt Controls

The three stage-config bags are `contextOptions` (distiller), `executorOptions` (executor), and `responderOptions` (responder). They share a forward-option type, but the pipeline does not wire every field identically.

Key fields:

- `assistant.distiller.setInstruction(text)`: set the distiller's own instruction. In 25.4.13 `contextOptions.description` is passed to actor initialization as a top-level description and stripped there; do not rely on it as a distiller prompt hook.
- `executorOptions.description`: append extra executor-specific instructions; this is the typical place for tool-use guidance.
- `responderOptions.description`: append extra responder-specific instructions.
- `contextOptions.model` / `executorOptions.model` / `responderOptions.model`: split model choice across stages.
- `contextOptions.ai` / `executorOptions.ai` / `responderOptions.ai`: override the AI service for a specific stage.
- `executorModelPolicy`: auto-switch only the executor when the run is on a consecutive error streak or discovery fetches land in specific namespaces.

For replacement or additive standing executor instructions, use the [stage-owned methods](agent.md#stage-guidance-and-generated-language-spellings), not `promptLevel`. `executorOptions.excludeFields` and `responderOptions.excludeFields` omit fields in the respective stages; keep original task fields available to the executor when it needs to check the handoff. Field exclusions do not change authority. See the [source map](https://unpkg.com/@ax-llm/ax@25.4.13/index.js.map), `../agent/agentInternal/coordinator.ts:279–283,320–323,366–376,444–452`, `initialization.ts:198–229,259–267`, and `../agent/AxAgent.ts:596–610`.

Good split-model pattern:

```typescript
const researchAgent = agent('query:string -> answer:string', {
  contextFields: ['query'],
  runtime,
  contextPolicy: { preset: 'checkpointed', budget: 'balanced' },
  executorOptions: {
    model: 'gpt-5.4',
  },
  responderOptions: {
    model: 'gpt-5.4-mini',
  },
});
```

Model guidance:

- Put the stronger model on the actor when the task depends on multi-turn exploration, discovery, runtime state reuse, or compressed replay.
- Put the stronger model on the responder only when the hard part is final synthesis/formatting rather than exploration.
- For cost-sensitive setups, a common pattern is stronger actor plus cheaper responder.

Prompt/cache shape:

- Each actor turn is executable code plus observed feedback, not a replay of the entire chat transcript.
- Stable system prompt: role/stage rules, primitive descriptions, static module list, always-included callable signatures, output contract, and field definitions.
- Cached working inputs: task inputs, inline context, `contextMetadata`, `contextMap`, `memories`, `executorRequest`, `distilledContextSummary`, `discoveredToolDocs`, `loadedSkills`, and `summarizedActorLog`.
- Dynamic turn tail: `guidanceLog`, `actionLog`, `liveRuntimeState`, and `contextPressure`.
- Review fresh model-dependent observations before guarded calls. If contracts or evidence are missing, use the relevant capability before finalizing or asking the user.

Separate dependent discovery from calls, for example:

```javascript
await discover('kb.findSnippets'); // Execution pauses; read the callable contract next.
```

```javascript
const snippets = await kb.findSnippets({ topic: 'severity' }); // Read the result next.
```

If the result suffices, the next turn can finish using `snippets`. Later code in the discovery block would not be hoisted, split, or executed on your behalf.

## AxJSRuntime Security

Default `new AxJSRuntime()` is hardened: no network, no filesystem, no child process, dynamic `import()` blocked, intrinsics frozen, `ShadowRealm` locked to `undefined`, worker IPC locked in browser/Deno/Bun, Bun workers use `smol: true`, and on Node 20+ the OS Permission Model auto-engages where available.

Threat model: this is defense-in-depth for LLM-authored code, not a container or VM boundary. Host callbacks and granted runtime permissions remain the authority boundary; keep durable secrets and privileged effects in host-side functions.

Permission enum (`AxJSRuntimePermission`):
`NETWORK`, `STORAGE`, `CODE_LOADING`, `COMMUNICATION`, `TIMING`, `WORKERS`, `FILESYSTEM`, `CHILD_PROCESS`.

Options quick reference:

- `permissions?: readonly AxJSRuntimePermission[]`: default `[]`; opt in capabilities.
- `blockDynamicImport?: boolean`: default `true`.
- `allowedModules?: readonly string[]`: default `[]`; narrow dynamic-import allowlist gate. Allowlisted specifiers are attempted, but full Node module namespace passthrough depends on Node vm semantics.
- `freezeIntrinsics?: boolean`: default `true`.
- `blockShadowRealm?: boolean`: default `true`.
- `lockWorkerIPC?: boolean`: default `true`.
- `preventGlobalThisExtensions?: boolean`: default `false`; opt-in and breaks top-level persistence.
- `useNodePermissionModel?: boolean | 'auto'`: default `'auto'`.
- `nodePermissionAllowlist?: { fsRead?; fsWrite?; childProcess?; addons?; wasi? }`.
- `resourceLimits?: { maxOldGenerationSizeMb?; maxYoungGenerationSizeMb?; codeRangeSizeMb?; stackSizeMb? }`.
- `allowDenoRemoteImport?: boolean`: default `false`.
- `allowUnsafeNodeHostAccess?: boolean`: default `false`.

Recipes:

```typescript
new AxJSRuntime();

new AxJSRuntime({ permissions: [AxJSRuntimePermission.NETWORK] });

new AxJSRuntime({
  permissions: [AxJSRuntimePermission.FILESYSTEM],
  allowedModules: ['node:fs', 'node:fs/promises', 'node:path'],
  useNodePermissionModel: 'auto',
  nodePermissionAllowlist: {
    fsRead: ['/app/data'],
    fsWrite: ['/app/data'],
  },
});
```

Rules for the LLM author:

- Default to `new AxJSRuntime()` with no options unless the user asked for a specific capability.
- When the user asks for `fetch`, add `permissions: [AxJSRuntimePermission.NETWORK]`.
- When the user asks for filesystem access, prefer host-side tool functions. If direct runtime filesystem access is required, add `permissions: [AxJSRuntimePermission.FILESYSTEM]`, scope with `nodePermissionAllowlist` when the user names a directory, and treat `allowedModules` as an import allowlist gate rather than a portability guarantee.
- Do not disable `freezeIntrinsics`, `blockShadowRealm`, or `lockWorkerIPC` unless the user explicitly asks.
- Treat `allowUnsafeNodeHostAccess: true` as a red flag; only use it when the user is authoring trusted code in their own process.
- `preventGlobalThisExtensions: true` breaks top-level `var`/`let`/`const` persistence across turns; never set it for stdout-mode RLM where persistence is load-bearing.
- On Deno, `blockDynamicImport` is a no-op; the defense is the worker permission sandbox. Pass `allowDenoRemoteImport: true` only if remote module loading is genuinely required.

## Custom Code Runtimes

Implement `AxCodeRuntime` when the actor should write a language other than JavaScript.

- Set `language` to the model-facing language name. JavaScript aliases (`JavaScript`, `js`, `ecmascript`) keep `javascriptCode`; other values derive lower-camel code fields such as `pythonCode` or `cSharpCode`.
- Keep execution inside `createSession(globals, options)`. AxAgent passes `inputs`, `llmQuery`, `final`, `askClarification`, progress callbacks, memory/discovery primitives, and namespaced tools as host globals; the runtime decides how those globals appear in the target language.
- Put language syntax, output behavior, persistence semantics, and completion-call examples in `getUsageInstructions()`.
- Use `getPrimitiveOverrides()` to describe language-native calls for built-in primitives, and `formatCallable()` to describe language-native calls for tools and child agents.
- Implement `inspectGlobals()` on sessions when `contextPolicy` should show live runtime state for non-JavaScript runtimes; otherwise AxAgent will not run JavaScript fallback inspection snippets.
- If a session returns errors in the code as readable text instead of rejecting, also implement `executeWithStatus()` and return `{ value, isError: true }` for them. AxAgent then tags those turns as errors for failure learning and context pruning, while the actor reads the same text. `AxJSRuntime` does this for `ReferenceError`, `TypeError`, `SyntaxError`, and the other built-in error types.

The [custom runtime example](../examples/36-custom-runtime.ts) implements a real, constrained JSON Plan interpreter—not JavaScript under a different language label. Actual agent turns call a host invoice tool, retain values, produce typed output, restore isolated sessions and close them. The interpreter's operation allowlist is an application protocol, not a claim to run arbitrary Python or provide a general security sandbox.

## RLM Test Harness

Use `agent.test(code, contextFieldValues?, options?)` when the user wants to validate runtime snippets against the actual AxAgent runtime environment without running the full actor/responder loop. With `AxJSRuntime`, those snippets are JavaScript.

```typescript
import { AxJSRuntime, agent, f, fn } from '@ax-llm/ax';

const runtime = new AxJSRuntime();

const tools = [
  fn('sum')
    .description('Return the sum of the provided numeric values')
    .namespace('math')
    .arg('values', f.number('Value to add').array())
    .returns(f.number('Sum of all values'))
    .handler(async ({ values }) =>
      values.reduce((total, value) => total + value, 0)
    )
    .build(),
];

const toolHarness = agent('query:string -> answer:string', {
  contextFields: [],
  runtime,
  functions: tools,
  contextPolicy: { preset: 'checkpointed', budget: 'balanced' },
});

const toolOutput = await toolHarness.test(
  'console.log(await math.sum({ values: [3, 5, 8] }))'
);

console.log(toolOutput);
```

Rules:

- `test(...)` creates a fresh runtime session per call.
- Context-field snippets run in the context/distiller runtime and expose `inputs` plus non-colliding top-level aliases for configured `contextFields`.
- Tool snippets should use an agent with no `contextFields`, or test the executor stage directly, so namespaced functions, child agents, and `llmQuery(...)` are in scope.
- In `AxJSRuntime`, do not rely on calling `inspectRuntime()` from inside `test(...)` snippets yet; prefer checking runtime globals directly inside the snippet.
- Ordinary snippets return a formatted output string; an observation pause can return feedback instead of an error.
- Runtime failures throw rather than returning LLM-style error strings.
- For protocol tests, accepted `final(...)` and `askClarification(...)` return structured payloads; the harness does not run the responder or start a new model turn. This differs from [public clarification](agent.md#clarification-and-resume-state).
- Pass only `contextFields` values to `test(...)`; it is not a general way to inject arbitrary non-context inputs.
- If the snippet uses `llmQuery(...)`, provide an AI service through the agent config or `options.ai`.

## `llmQuery(...)` Rules

Available forms:

- `await llmQuery(query, context?)`
- `await llmQuery({ query, context? })`
- `await llmQuery([{ query, context }, ...])`

Rules:

- `llmQuery(...)` forwards only the explicit `context` argument.
- Parent inputs, runtime variables, tool results, and discovered docs are not automatically available to `llmQuery(...)`; include any needed facts in `context`.
- `llmQuery(...)` is a direct semantic helper backed by an AxGen sub-query. It does not create a child AxAgent, does not run an actor runtime session, and does not have access to tools or discovery.
- Use batched `llmQuery([...])` only for independent semantic questions. Use serial calls when later work depends on earlier results.
- Pass compact named object context instead of huge raw parent payloads.
- Do not assume anything other than the returned string comes back from `llmQuery(...)`.
- `maxSubAgentCalls` is a shared budget for `llmQuery(...)` sub-queries across the top-level run.
- Single-call `llmQuery(...)` may return `[ERROR] ...` on non-abort failures.
- Batched `llmQuery([...])` returns per-item `[ERROR] ...`.
- If a result starts with `[ERROR]`, inspect or branch on it instead of assuming success.

Minimal example:

```javascript
const summary = await llmQuery('Summarize this incident', inputs.context);
if (summary.startsWith('[ERROR]')) {
  console.log(summary);
} else {
  console.log(summary);
}
```

Parallel semantic review example:

Use independent semantic reviews followed by a dependent merge. These queries do not require tools or discovery; tool-dependent reviews belong in child agents.

```javascript
const narrowedIncidents = incidents.map((incident) => ({
  id: incident.id,
  timeline: incident.timeline,
  notes: incident.notes.slice(0, 1200),
}));

const [severityReview, followupReview] = await llmQuery([
  {
    query:
      'Review severity policy alignment using only the supplied incidents and rubric. Return compact findings.',
    context: {
      incidents: narrowedIncidents,
      rubric: 'severity-policy',
    },
  },
  {
    query:
      'Review postmortem and follow-up obligations using only the supplied incidents and rubric. Return compact findings.',
    context: {
      incidents: narrowedIncidents,
      rubric: 'postmortem-followup',
    },
  },
]);

const merged = await llmQuery(
  'Merge these delegated reviews into one manager-ready summary with next steps.',
  {
    severityReview,
    followupReview,
    audience: inputs.audience,
  }
);
```

Delegation decision guide:

- **JS-only**: deterministic logic such as filter, sort, count, regex, or date math -> do it inline.
- **Single-shot semantic**: needs LLM reasoning but no tools or multi-step exploration -> single `llmQuery(...)` with narrow context.
- **Specialist/tool delegation**: needs its own tools, discovery, runtime, or reusable role -> create a child `agent(...)` and pass it in `functions: [...]`.
- **Parallel semantic fan-out**: two or more independent semantic-only subtasks -> batched `llmQuery([...])`.

Context handling:

- Always narrow with JS before delegating. Never pass raw `inputs.*`.
- Name context keys semantically, e.g. `{ emails: filtered, rubric: 'classify-urgency' }`.
- Estimate total sub-query calls before fanning out. `maxSubAgentCalls` is shared across the run.

Patterns:

- Fan-Out / Fan-In: JS narrows into categories -> `llmQuery([...])` fans out per category -> JS or one more `llmQuery(...)` merges semantic results.
- Pipeline: serial `llmQuery(...)` calls where each depends on the prior result.
- Specialist tool use: call child agents or tools via their namespaced function globals, e.g. `await team.writer({ draft })`.

## Examples

Full working examples:

- [RLM](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm.ts) - RLM basic
- [RLM Long Task](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-long-task.ts) - RLM context policy
- [RLM Discovery](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-discovery.ts) - discovery mode, grouped tools, child agents as functions, and semantic `llmQuery(...)`
- [RLM Adaptive Replay](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-adaptive-replay.ts) - adaptive replay

Flagship real-world long-agents (also ported to Python, Go, Rust, Java, and C++ under `src/examples/<lang>/long-agents/`; run with `bun run example <lang> <path>`):

- [Incident Log Forensics](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/typescript/long-agents/incident-log-forensics.ts) - large-context log forensics over `contextFields` (Gemini)
- [Codebase Peek Map](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/typescript/long-agents/codebase-peek-map.ts) - Peek-paper context-map orientation over a large repo snapshot
- [Data Analyst with Tools](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/typescript/long-agents/data-analyst-with-tools.ts) - large data dictionary in `contextFields` + typed warehouse tools the model queries instead of inlining
- [Smart Defaults Agent](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/typescript/long-agents/smart-defaults-agent.ts) - oversized undeclared context auto-promoted runtime-only, with relevance hints and runtime tools
- [Self-Improving Lab](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/typescript/long-agents/self-improving-lab.ts) - many-tool agent that runs experiments, grades them with an independent verifier, and distills verified rules into memory

## Do Not Generate

- Do not prewrite dependent actions that require interpreting new evidence. Deterministic multi-step work is allowed.
- Do not complete with an unread inspection result or skip an authorized required action on the strength of old evidence.
- Do not assume old successful turns stay fully replayed under adaptive/checkpointed/lean policies.
- Do not rebuild runtime state just because a prior turn was summarized.
- Do not describe `llmQuery(...)` as spawning a tool-using child AxAgent.
- Do not assume parent inputs are available to `llmQuery(...)` unless passed in `context`.
- Do not ignore `[ERROR] ...` results from `llmQuery(...)`.
- Do not grant `AxJSRuntime` permissions unless the user asked for the capability.

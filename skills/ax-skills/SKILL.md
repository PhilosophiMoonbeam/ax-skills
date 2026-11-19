---
name: ax-skills
description: Design, implement and review @ax-llm/ax TypeScript LLM systems. Use for holistic architecture, execution topology and trust/state boundaries; ai() providers, routing, balancing and embeddings; s()/f() signatures; ax()/AxGen generation, streaming and validation; agent()/AxAgent tools, resultPolicy, child delegation, clarification and resume; contextMap, contextPolicy, memories and runtime skills; RLM/AxJSRuntime fresh evidence, executor batch, runtime budgets and cutoff; usage, tracing and cost ownership; flow()/AxFlow DAGs; AxEventRuntime events and persistence; agent.optimize(), optimize()/AxGEPA, playbook()/ACE and bestOfN/refine; AxMCPClient transports, catalogs and OAuth; audio/multimodal applications; and focused semantic judgments with Jev, OpenAI and Gemini decision models, host-owned policy, typed evidence, probabilities, media and Box localization.
---

# Ax Skills

Use one entrypoint and 19 selectively loaded references. The example CLI lists 242 cases across 39 executable modules; listing is not executed acceptance. Markdown links resolve relative to their containing file; no separately installed Ax skill is required.

## Working policy

1. **Design, mechanism selection, or cross-language porting:** read [Architecture](references/architecture.md) first, even for a single subsystem such as retrieval, image localization or audio routing. Then load only the selected specialist sections and relevant example. **Narrow coding or debugging:** go directly to the owning row below. Do not preload every guide or the example corpus.
2. Prefer `ai()`, `ax()`, `agent()`, `flow()`, `optimize()`, `s()`, `f()` and `fn()` where supported; use specialized classes when required.
3. This collection combines official `@ax-llm/ax` **25.4.13 guidance** with authored design synthesis and scoped TypeScript SDK evidence. Owning guides distinguish published guidance from released behavior. Check installed declarations; do not infer live provider acceptance or generated-language parity.
4. Keep credentials in application environment/secret storage, never examples or logs. Before verification inspect scripts and obtain task-required authorization. Prefer local type checks and focused tests; never silently run billed model calls, external services, live audio or state-changing operations. Report only checks actually exercised.

## Architectural orientation

- Start with a signature-bound `AxGen`; use `AxFlow` for application-defined dependencies/branches and `AxAgent` for model-directed tool use. RLM is the agent's code/runtime strategy; child delegation is an explicit specialist boundary, not `llmQuery()`.
- Prefer focused decision models such as Jev through `@ax-llm/ax` for bounded semantic judgments; use separate generation for prose/tools. Code owns exact facts, policy, authority and effects; capability filtering and operational balancing do not establish semantic equivalence or application quality.
- Keep corpus orientation (`contextMap`), within-run replay (`contextPolicy`), recalled facts, loaded runtime skills and evolving playbooks distinct. Runtime sessions and continuation snapshots are not a durable application database.
- The application owns authenticated identity, tool authority, durable storage, retry/idempotency policy, delivery, accounting and acceptance criteria. MCP content is untrusted; event sources require explicit wake/resume routes.

Use Architecture to turn these alternatives into a justified design and implementation reading plan.

## Route by task

| Task or symbols | Read | Boundary / companion |
| --- | --- | --- |
| Holistic pre-development understanding, system design, topology, alternatives, trust/state/reliability boundaries, staged verification | [Architecture](references/architecture.md) | Design procedure and deliverable; then selected implementation guides. |
| Library orientation, imports, factories, basic examples, global defaults | [Library overview](references/llm.md) | Quick reference, not a substitute for design or specialist contracts. |
| `ai()`, providers/models, deployment and capability checks, Gemini 4 Hydrogen, Anthropic document citations, Bedrock, media, embeddings, caching, routing and balancing | [AI providers](references/ai.md) | [DeepSeek Flash](references/ai.md#deepseek-notes) lists image input in its catalog, not in native Chat capability; structured output on native Chat V4 rules, when selected, is function-only. Audio and native decisions have separate guides. |
| `transcribe()`, `speak()`, `:audio`, `speech`, `.chat()` audio, OpenAI Realtime, Gemini Live, Grok Voice, Meta Muse, voices/formats/transcripts | [Audio I/O](references/audio.md) | Batch/scripted artifacts versus conversational/live turns; add Providers and Signatures as needed. |
| String signatures, `s()`, `f()`, `f.box()`/`AxBox`, schemas, modifiers, constraints, value descriptions, typed input/output contracts | [Signatures](references/signature.md) | Schema construction; execution in Generators, native decisions/media in Typesafe. |
| `ax()`, `AxGen`, `forward()`, `streamingForward()`, streamed tool text/history, function calls, unknown-tool recovery, `functionResultFormatter`, assertions/processors, hooks, citation passage logs/usage, self-tuning, ordinary and novelty F1 | [Generators](references/gen.md) | Structured execution and hard validation; document source setup in Providers, native decisions in Typesafe. |
| `agent()` / `AxAgent`, tools and `resultPolicy`, children, discovery, stage handoff, completion, clarification and resume | [Core agents](references/agent.md) | [Tool contracts](references/agent.md#tool-functions-and-schemas) and [host completion](references/agent.md#host-side-completion-and-unified-final-signal); runtime behavior below. |
| Choose `contextMap` versus `contextPolicy`, recall/memories, runtime skills, optimization or playbooks | [Agent context chooser](references/agent-context.md) | Mechanism and scope selection; implementation in the next two guides. |
| `contextMap`/`AxAgentContextMap`, catalogs/search, `recall()`, `inputs.memories`, preloading/carryover, relevance ranking, `discover({ skills })`, loaded/used IDs | [Memory and skills](references/agent-memory-skills.md) | Corpus orientation and retrieval, not trajectory compaction; runtime skills are not installable coding skills. |
| RLM / `AxJSRuntime`, fresh evidence and executor `batch`, `contextPolicy`, `liveRuntimeState`, `maxRuntimeChars`, `promptLevel`, `executorModelPolicy`, actor cutoff, `llmQuery()` | [Agent RLM runtime](references/agent-rlm.md) | [Actor code](references/agent-rlm.md#rlm-actor-code-rules) and [executor batches](references/agent-rlm.md#executor-batches); [runtime feedback budgets](references/agent-rlm.md#dynamic-output-truncation) are separate from [generation cutoff](references/agent-rlm.md#actor-output-cutoff-versus-runtime-replay-truncation). |
| `axGlobals.onUsage`, `usageContext`, tenant accounting, actor/context/status/function callbacks, `reportSuccess`/`reportFailure`, logs, usage/resetUsage, traces | [Agent observability](references/agent-observability.md) | Runtime telemetry; application owns durable aggregation, privacy and currency pricing. |
| `agent.optimize()`, datasets/targets, `judgeOptions`, deterministic metrics, saved `optimizedProgram` | [Agent optimization](references/agent-optimize.md) | Agent-specific evaluation/tuning; global optimizer and playbook evolution below. |
| `flow()`, `AxFlow`, DAGs, conditional routing, auto-parallel execution, map/reduce | [Flows](references/flow.md) | Program composition, not external event ingestion or durable wake/resume. |
| `AxEventRuntime`, non-whitespace string envelope identifiers, generated-runtime validation, inbox/routes, explicit wake/resume, owned continuations, stores, persisted results, sinks | [Event runtime](references/event-runtime.md) | Event lifecycle and reliability; TypeScript validation is not generated-language runtime acceptance or authenticated identity. Add MCP for protocol event sources. |
| `optimize()`, `AxGEPA`, BootstrapFewShot, Pareto/multi-objective tuning, reflective evolution, `baselineScore` / `baselineScores`, `validationExamples`, `maxMetricCalls`, bootstrap budgets | [GEPA optimization](references/gepa.md) | Offline instruction/demo optimization for generators, flows or agent trees; decision feedback/data flywheels in [Native decisions](references/typesafe.md#feedback-data-flywheel), not model-weight training. |
| `playbook()`, `AxPlaybook`, ACE, `agent.playbook()`, offline `evolve()` and online `update()` | [Playbooks](references/playbook.md) | Reusable task knowledge; [decision feedback lifecycle](references/typesafe.md#feedback-data-flywheel) covers verified labels, candidate evaluation and explicit promotion, not automatic improvement. |
| `bestOfN()`, `refine()`, rewards, thresholds, native samples, serial attempts, advice/diagnostics | [Refine and best-of-N](references/refine.md) | Complete-output selection within a call, not streaming or persistent learning. |
| `AxMCPClient`, native `mcp`, transports, catalogs, tools/prompts/resources, tasks/subscriptions, sampling/elicitation/roots, OAuth, Apps, recording/replay | [Native MCP](references/mcp.md) | Protocol ownership and trust; add Event runtime for persisted wake/resume. |
| Focused semantic judgments instead of general generation; Jev, `openai-decisions`, `google-gemini-decisions`, `typesafe()`, `openaiDecisions()`, `googleGeminiDecisions()`, boolean/class/rubric scores, evidence/probabilities/provenance, `trueThreshold`, native questions, applicability gates, media and Box | [Native decisions](references/typesafe.md) | Jev supplies judgments; code owns facts, policy, authority and effects. Provider inputs, confidence and refusals differ; only Jev supports native Box. |

## Working examples

[Examples index](examples/INDEX.md) maps focused cases to their guides, setup, modes and cleanup. For design, choose an architecture pattern before its composition; for implementation, choose one guide and one case. Read that case's `run(ctx)`, imports and referenced helpers, not the corpus. Offline fixtures exercise SDK behavior, not model quality; live execution requires explicit selection.

# AxAgent Context Tool Selection

Use this decision guide when choosing a context feature, distinguishing `contextMap` from `contextPolicy` or memory, or designing long-context agents. Select the tool, then use the exact implementation reference below; this is not a core-agent or runtime-code guide. Prefer a direct recommendation over tutorial prose. Source API snapshot: `@ax-llm/ax` 25.4.13.

## Select by Need and Scope

| Need | Context object | Scope | API | Implementation reference |
| --- | --- | --- | --- | --- |
| Many tasks over one large repository, document set, or dataset | Context map | Recurring corpus; persists across runs | `contextMap` | [RLM and context maps](agent-rlm.md) |
| Tune how much of a fresh runtime result the next actor sees | Current runtime feedback | One execution; actor-visible preview | `maxRuntimeChars` | [RLM Context Policy Presets](agent-rlm.md#context-policy-presets) |
| Older observations crowd out live work | Trajectory replay | Older prompt history in this run | `contextPolicy: { preset, budget }` | [RLM Context Policy Presets](agent-rlm.md#context-policy-presets) |
| Use a full value again or resume with saved state | Runtime bindings / continuation state | Live session, or compatible saved state across calls | Initialized bindings; `getState()` / `setState(...)` | [RLM runtime and state](agent-rlm.md) |
| Evolve task strategy from examples or live feedback | Context playbook | A stage; offline evolution and online update | `agent.playbook(...)` | [Agent optimization](agent-optimize.md) and [playbooks](playbook.md) |
| Tune prompts, instructions, or demonstrations offline | Instruction text | A program; offline | `agent.optimize(...)` (GEPA) | [Agent optimization](agent-optimize.md) |
| Retrieve task-relevant facts or guides | Retrieval | On demand; memories are per run, loaded skills can persist | `recall(...)` / `discover({ skills })` | [Memory and runtime skills](agent-memory-skills.md#retrieval-defaults-and-stage-ownership) |

## Defaults

- Recurring corpus with many different questions: `contextMap`, a persistent orientation cache.
- One long multi-turn run under prompt pressure: `contextPolicy: { preset: 'checkpointed', budget: 'balanced' }`. Move to `lean` for very long runs with strong models; use `full` for short tasks or weak models.
- Evolving strategy: `agent.playbook(...)`, offline from examples or online from live feedback.
- Offline instruction/demo tuning: `agent.optimize(...)` (GEPA).
- On-demand facts: `recall(...)` for memories; `discover({ skills })` for runtime skill guides.
- One oversized input, such as a pasted document or large JSON value: normally do nothing. `autoUpgrade` is on by default and keeps the full value runtime-only with a prompt preview. Use `contextFields` for a specific inline policy or a large required non-string field; see [RLM input policies](agent-rlm.md).

## Boundaries and Anti-Patterns

- Do not use `contextMap` to compact a single run's history. Use `maxRuntimeChars` for fresh feedback and `contextPolicy` for older replay; neither setting is a runtime state retention policy.
- Do not use `contextPolicy` to carry knowledge across runs. Use `contextMap` for corpus orientation, or saved continuation state to resume runtime work.
- Do not hand-build a strategy playbook in the prompt; evolve it with `agent.playbook(...)`.
- Do not put the full corpus into every run's prompt; combine a context map with on-demand `recall(...)`.
- Runtime skills loaded with `discover({ skills })` are guides for the running agent, not this installable code-generation reference collection.

## Companion References

- [RLM Context Policy Presets](agent-rlm.md#context-policy-presets): fresh observation budget and older replay compaction.
- [Memory and runtime skills](agent-memory-skills.md): recall, memories, and dynamic guide loading.
- [Agent optimization](agent-optimize.md): GEPA via `agent.optimize(...)` and optimization hand-off for `agent.playbook(...)`; [playbooks](playbook.md) supplies the dedicated evolution/update contract.
- [Core agents](agent.md): agent construction and final/clarification protocols.

Selected executable examples: [corpus maps and trajectory policies](../examples/13-context.ts), [recall and runtime skills](../examples/14-memory-skills.ts), [offline agent tuning](../examples/24-agent-optimize.ts), and [playbook evolution/update](../examples/25-playbooks.ts). Choose only the relevant module.

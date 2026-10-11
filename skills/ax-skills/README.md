# Ax Skills Collection

A single progressive-disclosure skill for `@ax-llm/ax`. [SKILL.md](SKILL.md) contains discovery metadata, operating policy and task routing. Its 18 directly linked references contain the technical guidance. README is supporting documentation, not a second skill entrypoint.

## Installation and disclosure

Install or copy the entire `skills/ax-skills` directory into the skill directory supported by your agent host, retaining the directory name `ax-skills`, `SKILL.md` and `references/`. Configure the host to discover that directory according to its own installation instructions. Installing only `SKILL.md` omits required guidance.

The host discovers the name and description first, loads the master when an Ax task activates it, and loads the matching references on demand. Follow the master's boundaries when tasks overlap; do not load all references by default. Reference links are relative to the collection root. No separately installed Ax skills, original source files or full Ax library checkout are needed to use this collection. Remote documentation/example links are supplementary resources, not substitute local skill entrypoints.

## Provenance and source snapshots

The conversion inputs are the 18 unchanged `.agents/skills/ax*/SKILL.md` files in this repository. They remain provenance and semantic-audit inputs, not production aliases. `skills-lock.json` remains unchanged as the existing source provenance record. Source frontmatter records `25.3.0` for 17 inputs; `ax-event-runtime` does not declare a version. These values describe the imported source snapshots, not a promise of compatibility with every release or a latest-API guarantee. Use installed package declarations and authoritative documentation to resolve version differences.

The fixed map below is relative to this repository for sources and to this collection root for references. Each source maps to exactly one reference; the master routes directly to every reference.

| Original source | Converted reference |
| --- | --- |
| `.agents/skills/ax-llm/SKILL.md` | [references/llm.md](references/llm.md) |
| `.agents/skills/ax-ai/SKILL.md` | [references/ai.md](references/ai.md) |
| `.agents/skills/ax-audio/SKILL.md` | [references/audio.md](references/audio.md) |
| `.agents/skills/ax-signature/SKILL.md` | [references/signature.md](references/signature.md) |
| `.agents/skills/ax-gen/SKILL.md` | [references/gen.md](references/gen.md) |
| `.agents/skills/ax-agent/SKILL.md` | [references/agent.md](references/agent.md) |
| `.agents/skills/ax-agent-context/SKILL.md` | [references/agent-context.md](references/agent-context.md) |
| `.agents/skills/ax-agent-memory-skills/SKILL.md` | [references/agent-memory-skills.md](references/agent-memory-skills.md) |
| `.agents/skills/ax-agent-rlm/SKILL.md` | [references/agent-rlm.md](references/agent-rlm.md) |
| `.agents/skills/ax-agent-observability/SKILL.md` | [references/agent-observability.md](references/agent-observability.md) |
| `.agents/skills/ax-agent-optimize/SKILL.md` | [references/agent-optimize.md](references/agent-optimize.md) |
| `.agents/skills/ax-flow/SKILL.md` | [references/flow.md](references/flow.md) |
| `.agents/skills/ax-event-runtime/SKILL.md` | [references/event-runtime.md](references/event-runtime.md) |
| `.agents/skills/ax-gepa/SKILL.md` | [references/gepa.md](references/gepa.md) |
| `.agents/skills/ax-playbook/SKILL.md` | [references/playbook.md](references/playbook.md) |
| `.agents/skills/ax-refine/SKILL.md` | [references/refine.md](references/refine.md) |
| `.agents/skills/ax-mcp/SKILL.md` | [references/mcp.md](references/mcp.md) |
| `.agents/skills/ax-typesafe/SKILL.md` | [references/typesafe.md](references/typesafe.md) |

## Repository maintenance

1. Run `bd prime` and `bd ready`; create or claim the relevant Beads issue before changing the collection. Record scope, provenance decisions and review findings in the issue rather than markdown task lists.
2. Read `SKILLS_SPEC.md` and the affected source/reference sections. Preserve the originals and lock file. Change the mapped reference, update master routing when triggers or boundaries change, and update this guide when installation, provenance or maintenance changes.
3. Keep one `SKILL.md`, named `ax-skills` in frontmatter. Keep its description within 1024 characters, its body below 500 lines and the recommended 5000 tokens, and all 18 root-relative reference links direct. References have no frontmatter and no additional skill entrypoints. They must remain usable without the originals or external skill-loading dependencies.
4. Preserve actionable API shapes, constraints, options, edge cases, warnings, example intent and resource URLs. Consolidate genuine repetition rather than deleting distinct coverage to hit a size target. Do not silently upgrade snapshot APIs.
5. After all edits land, an authorized integration owner runs structural validation and reviews disclosure routes. From the repository root, with Python 3 and the `skills-ref` CLI available, run:

   ```sh
   python3 scripts/validate_ax_skills.py
   skills-ref validate skills/ax-skills
   ```

6. Separately review semantic coverage against the unchanged originals: structural validation alone cannot establish it. Resolve missing, incorrect, mixed or uncertain coverage findings, then repeat the full review after corrections. Exercise overlapping routing scenarios by loading the master and only the selected references; confirm the task requires neither original skills nor unrelated reference loading.
7. Record actual validation commands/results and source snapshot evidence in the handoff and audit records. Add measured disclosure/size evidence only after measurement; do not claim coverage or efficiency from author estimates. Close the issue only after the integration owner completes its acceptance checks. Commit, push and remote sync require repository/user authorization.

The procedure above is reusable; the checked conversion snapshot below records observed results, not a guarantee for later edits.

## Verified conversion snapshot

The final review partitions every original line into 334 source-section units across all 18 Ax skills. One non-Ax input (`beads`) was excluded. Original hashes match [the source manifest](assets/source-manifest.json). The frozen semantic rubric, source-to-reference measurements, all section verdicts, comparison spans, routing scenarios, and manual resolutions are in [the coverage audit](assets/coverage-audit.json). These supporting assets are not activation instructions and should not be preloaded.

Three full-corpus judgment passes were followed by evidence-based escalation. The first pass clipped 36 provider-reference contexts; complete counterpart sections replaced those prefixes without changing the rubric or its 60,000-character cap. The final pass has no truncations or errors. Its raw verdicts are 326 covered, one missing, and seven organizational-only units. Manual review overturns the low-confidence missing verdict: all 12 RLM defaults remain in the defaults section and canonical selection table. The seven other units contain headings only. All 334 units are accounted for: 327 semantic-coverage units and seven organizational units; no unresolved coverage defects.

Across the passes, 91 unique escalated units were inspected. Confirmed corrections consolidated repeated RLM selectors and retrieval prohibitions, removed invented factory exceptions, and restored `checkpointed + balanced` as the default for most RLM tasks. Other density flags were checked against distinct examples, API contracts, schema representations, or separately scoped memory/skill behavior rather than accepted as automatic deletion requests.

### Instruction and disclosure size

Counts use `cl100k_base` with `tiktoken` 0.14.0, not a claim about every host's tokenizer. Supporting README/audit assets are excluded from instruction counts.

| Load | Tokens |
| --- | ---: |
| All original skill instructions, including frontmatter | 87,047 |
| All converted references | 78,690 |
| Unified master, including frontmatter | 1,791 |
| Unified master plus all references | 80,481 |
| Master plus smallest selected reference | 2,576 |
| Master plus largest selected reference | 16,589 |

References use 9.60% fewer tokens than the original instructions; including the master, the reduction is 7.54%. Selective disclosure is the main saving: a task loads its relevant references rather than the full collection. Multiple-topic tasks can legitimately require more than one reference.

### Exercised verification

- `skills-ref validate`, `read-properties`, and `to-prompt` validate and expose the actual single skill entrypoint.
- `python3 scripts/validate_ax_skills.py` checks all source hashes, exact reference inventory, direct links, local targets/fragments, frontmatter, and fences.
- Nine isolated validator smoke cases exercise valid input, missing target, missing fragment, changed source hash, obsolete skill loading, obsolete skill URI, allowed package/negative dependency prose, path escape, and unclosed fence.
- Eighteen semantic routing scenarios select the expected primary reference from the actual master; each selected file is then loaded from the collection.

No Python language server was available. Provider-backed Ax examples were not executed: this conversion preserves documented source snapshots, not verified compatibility with newer package releases or live provider endpoints. Re-run the structural checks and semantic audit after changing instructional content.

# Ax Skills Collection

A single progressive-disclosure skill for `@ax-llm/ax`. [SKILL.md](SKILL.md) contains discovery metadata, operating policy and task routing. Its 18 directly linked references contain the technical guidance. README is supporting documentation, not a second skill entrypoint.

## Installation and disclosure

Install the collection with the Skills CLI:

```sh
npx skills add PhilosophiMoonbeam/ax-skills
```

When prompted to select a skill, choose `ax-skills` and the target agent host.

The host discovers the name and description first, loads the master when an Ax task activates it, and loads the matching references on demand. Follow the master's boundaries when tasks overlap; do not load all references by default. Reference links are relative to the collection root. No separately installed Ax skills, original source files or full Ax library checkout are needed to use this collection. Remote documentation/example links are supplementary resources, not substitute local skill entrypoints.

## Provenance and source snapshots

The conversion inputs are the 18 copied `.agents/skills/ax*/SKILL.md` files in this repository. They remain provenance and semantic-audit inputs, not production aliases. The current refresh follows upstream snapshot commit `83f7000`, compared with `5fdf5c3`; it leaves those imported files and `skills-lock.json` untouched. Source frontmatter records `25.4.1` for 17 inputs; `ax-event-runtime` remains unchanged and unversioned. These are documented source snapshots, not guarantees about every package release or live provider. Use installed package declarations and authoritative documentation to resolve version differences.

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

## Verified 25.4.1 refresh

The upstream delta changes behavior in four skills (`ax-ai`, `ax-agent`, `ax-signature`, `ax-typesafe`) and version metadata in 13 others. The unversioned event-runtime source is unchanged.

- **Providers:** GPT-6.1 Sol reasoning, Responses routing, caching, pricing and Bedrock contracts; terminal incomplete-response status and per-stream usage; cumulative Anthropic input/cache/output accounting.
- **Core agents:** multiple actor code fences reject the entire turn for text or structured JSON, with LF or CRLF.
- **Signatures and decisions:** description escaping and round-trips; explicit ordered-score rubrics; `AxBox`/evidence geometry; Jev 1.14 PNG/JPEG localization, asset transport, model/header/image limits, presence checks, and provider-specific restrictions.
- **Discovery:** the master routes image/Box, GPT-6.1, streaming-usage and actor-fence tasks directly to their owning references.

Two upstream inconsistencies are explicit rather than silently propagated: the provider overview still excludes all Jev media, while the updated Typesafe contract adds PNG/JPEG images; the signature source places generated-language Box support in the AxIR backlog, while the Typesafe source claims six-language availability. The collection follows the updated image contract and preserves the unresolved language-parity disagreement. TypeScript Box guidance is complete; inspect the generated package before relying on Box in another language.

### Coverage and provenance

The current audit partitions all 7,864 source lines into 337 sections across all 18 Ax skills. One non-Ax skill (`beads`) is excluded. [The source manifest](assets/source-manifest.json) records current source hashes; [the coverage audit](assets/coverage-audit.json) records exact comparison spans, current reference hashes, all verdicts, manual resolutions, metrics, and exercised checks. These supporting assets are not activation instructions and should not be preloaded.

The final full-corpus pass returned 332 covered, two low-confidence missing, and three organizational verdicts, with no errors or truncations. Manual review resolves all 53 final escalations: the two missing verdicts concern unchanged retrieval batching/child-callback ownership and RLM defaults already present in canonical sections. Seven source sections are heading-only, regardless of their raw model bucket. All 337 sections are accounted for: 330 semantic units and seven organizational units; no unresolved coverage defects. The upgrade introduced no flagged density regressions.

The audit first used a whole-reference density question, then invalidated that rubric and re-judged every section with an explicit upgrade-regression baseline. Two complete passes under the replacement rubric cover the actual final snapshot. Historical conversion evidence remains retrievable from the preceding Git snapshot; old hashes and verdicts are not relabeled as current evidence.

### Instruction and disclosure size

Counts use `cl100k_base` with `tiktoken` 0.14.0, not a claim about every host's tokenizer. Supporting README/audit assets are excluded from instruction counts.

| Load | Tokens |
| --- | ---: |
| All current original skill instructions, including frontmatter | 88,565 |
| All converted references | 80,579 |
| Unified master, including frontmatter | 1,890 |
| Unified master plus all references | 82,469 |
| Master plus smallest selected reference | 2,675 |
| Master plus largest selected reference | 17,151 |

References use 9.02% fewer tokens than current original instructions; including the master, the reduction is 6.88%. Selective disclosure is the main saving: load only relevant references. Multiple-topic tasks can legitimately require more than one.

### Exercised verification

- `skills-ref validate`, `read-properties`, and `to-prompt` validate and expose the actual single skill entrypoint.
- `npx --yes skills add ./skills/ax-skills --list` discovers the local updated collection as one skill without installing it.
- `python3 scripts/validate_ax_skills.py` checks source hashes, exact reference inventory, direct links, local targets/fragments, frontmatter, and fences.
- Nine isolated validator smoke cases exercise valid input, missing target, missing fragment, changed source hash, obsolete skill loading, obsolete skill URI, allowed package/negative dependency prose, path escape, and unclosed fence.
- Twenty-three semantic routing scenarios cover every existing topic plus the new provider, usage, image/Box, escaping and actor-fence guidance; each selected file is then loaded from the actual collection. An initial actor-fence misroute was corrected in the master and the entire routing set repeated.

No live provider calls or Ax package examples were executed. This is a verified documentation/disclosure refresh, not a live endpoint or generated-language compatibility certification. Re-run structural checks and semantic review after instructional changes.

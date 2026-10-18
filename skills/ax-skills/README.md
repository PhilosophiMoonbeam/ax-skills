# Ax Skills Collection

One self-contained progressive-disclosure skill for designing and implementing TypeScript applications with `@ax-llm/ax`, grounded in the official **25.4.3** skill bundle. The collection supports holistic architectural decisions before code and precise API use during implementation. It uses terse-yet-complete Standard Technical English: remove repetition, not distinct contracts, constraints, examples or warnings.

## Design first, then implement

Before choosing APIs, define the task, input/output contracts, quality criteria, authority boundaries and operational constraints. Decide which work is structured generation, agent-directed tool use, explicit workflow orchestration or event-driven resumption. Assign ownership of context, state, side effects, persistence, retries, cancellation and evaluation. Distinguish within-run context management, retrieval, reusable knowledge and offline optimization; they solve different problems.

The collection has three instruction layers:

| Layer | Purpose | Loading |
| --- | --- | --- |
| [Master](SKILL.md) | Capability orientation, safety/authorization policy, design-first routing and implementation routes | Always retained when this skill is active |
| [Architecture guide](references/architecture.md) | Cross-subsystem design decisions, trade-offs and handoff to implementation | On demand for architecture, planning or consequential design changes |
| 18 implementation references | Source-derived API contracts, constraints, examples and specialist behavior | Only the guides needed for the task |

The architecture guide is authored, source-grounded synthesis, not an official API quotation or a promise of runtime guarantees. Implementation references preserve the official contracts and their caveats. Read the architecture guide with selected implementation guides when design depends on exact capabilities. Multiple guides are appropriate for overlapping tasks; loading the entire corpus is not the default.

The host discovers metadata first, loads the master when the skill activates, then follows its local routes. README and audit assets are supporting documentation, not additional entrypoints. Using the installed collection requires neither the original source snapshot nor a full Ax checkout or separately installed specialist skills. External documentation supplements local guidance; check installed package declarations and authoritative documentation when versions differ.

## Installation and one active Ax master

```sh
npx skills add PhilosophiMoonbeam/ax-skills
```

When prompted, select **`ax-skills`** and the target agent host. This collection is intended to be the workspace's one active Ax master. Do not activate a duplicate official `ax-llm` entrypoint or separately registered specialists alongside it; inspect existing installations and deliberately choose which entrypoint remains active.

[Official installation guidance](https://axllm.dev/typescript/skills/) documents a separate upstream installation path. Installing `@ax-llm/ax` automatically sets up official `ax-llm` and its local guides in `.claude/skills` outside CI; it does not install this collection. To prevent duplicate setup:

- Set `AX_SKIP_SKILL_INSTALL=1` during package installation to skip that run.
- Run `npx @ax-llm/ax skills-auto-install off` from the project root to save `ax.skills.autoInstall: false` in `package.json`; merge that setting before the first installation if needed. `skills-auto-install on` restores future automatic setup. CI and the environment opt-out take precedence.
- These preferences do not remove existing skills. Manual `npx @ax-llm/ax setup-claude` still works when automatic setup is disabled; `--all` registers specialists separately. Upstream documents `remove-claude` followed by `setup-claude` for migrating an older official full installation to its official single entrypoint. Do not run that migration merely to install this collection; review existing files before intentional removal or replacement.

## Official bundle and local mapping

The preserved source snapshot is the complete **19-file official bundle** under `.agents/skills/ax-llm`, published for `@ax-llm/ax` 25.4.3 at upstream revision `818d15b02d57de8f215f6d2cb23bd3d3921a6e5e`. The [official index](https://ax-llm.github.io/ax/typescript/.well-known/agent-skills/index.json) identifies the [bundle archive](https://ax-llm.github.io/ax/typescript/.well-known/agent-skills/ax-llm/skill.tar.gz). The snapshot is provenance and audit input, not another production entrypoint.

Source paths below are relative to `.agents/skills/ax-llm`; destinations are relative to this collection. The bundle becomes one master plus 18 implementation references, supplemented by one authored architecture reference. The master directly links all 19 references.

| Official source | Local destination |
| --- | --- |
| `SKILL.md` | [SKILL.md](SKILL.md) and [references/llm.md](references/llm.md) |
| `references/quickstart.md` | [references/llm.md](references/llm.md) |
| `references/ax-ai.md` | [references/ai.md](references/ai.md) |
| `references/ax-audio.md` | [references/audio.md](references/audio.md) |
| `references/ax-signature.md` | [references/signature.md](references/signature.md) |
| `references/ax-gen.md` | [references/gen.md](references/gen.md) |
| `references/ax-agent.md` | [references/agent.md](references/agent.md) |
| `references/ax-agent-context.md` | [references/agent-context.md](references/agent-context.md) |
| `references/ax-agent-memory-skills.md` | [references/agent-memory-skills.md](references/agent-memory-skills.md) |
| `references/ax-agent-rlm.md` | [references/agent-rlm.md](references/agent-rlm.md) |
| `references/ax-agent-observability.md` | [references/agent-observability.md](references/agent-observability.md) |
| `references/ax-agent-optimize.md` | [references/agent-optimize.md](references/agent-optimize.md) |
| `references/ax-flow.md` | [references/flow.md](references/flow.md) |
| `references/ax-event-runtime.md` | [references/event-runtime.md](references/event-runtime.md) |
| `references/ax-gepa.md` | [references/gepa.md](references/gepa.md) |
| `references/ax-playbook.md` | [references/playbook.md](references/playbook.md) |
| `references/ax-refine.md` | [references/refine.md](references/refine.md) |
| `references/ax-mcp.md` | [references/mcp.md](references/mcp.md) |
| `references/ax-typesafe.md` | [references/typesafe.md](references/typesafe.md) |
| Authored cross-subsystem synthesis; no one-to-one source | [references/architecture.md](references/architecture.md) |

[Source manifest](assets/source-manifest.json) schema 2 records the source root, package/version, upstream commit, index/archive URLs and archive SHA-256. Every official Markdown member has a repository-relative source path, collection-relative destinations, SHA-256, original byte count and line count. `authored_references` distinguishes architecture synthesis from copied-source mappings. Archive and member hashes are the ongoing bundle provenance authority. `skills-lock.json` is installer-managed historical metadata: do not manually rewrite it to simulate synchronization.

Two source conflicts remain explicit:

- The provider overview excludes Jev media, while the Typesafe contract supports PNG/JPEG images. The collection follows the detailed image contract without treating the overview as evidence of broader media support.
- Signature guidance places generated-language Box support in the AxIR backlog, while Typesafe guidance claims six-language availability. TypeScript Box guidance is available; inspect the target generated package before relying on another language's support.

## Routine synchronization and integration

Track work in Beads: run `bd prime` and `bd ready`, then create or claim the relevant issue. Read `SKILLS_SPEC.md` and affected source/reference sections before editing. From the repository root:

```sh
python3 scripts/sync_ax_sources.py --check
python3 scripts/sync_ax_sources.py --update
```

No argument means `--check`. Check mode is read-only and reports drift or invalid publication with a nonzero exit status. Explicit `--update` validates the official publication and updates only the preserved source snapshot and schema-2 manifest. It refuses unexpected local files, symlinks and managed source bytes modified relative to the manifest; preserve and resolve local changes rather than overwriting them. Neither mode installs skills, rewrites the lock file, integrates curated references or updates the semantic audit.

Optional CLI arguments are `--repo PATH`, `--collection PATH`, `--index-url URL` and `--npm-url URL`. Publication URL overrides are explicitly trusted inputs, including local test fixtures; do not substitute untrusted endpoints. Exact snapshot/manifest agreement returns exit status 0; drift, invalid metadata/archive, unsafe paths and network/write errors return 1. Update returns 0 after a validated import or no-op; it is mutually exclusive with `--check`.

A successful download or source update is not acceptance. After each update:

1. Integrate every relevant source change into the mapped implementation references, preserving actionable API shapes, constraints, defaults, edge cases, warnings, example intent and resource URLs. Remove obsolete claims rather than adding compatibility prose for superseded snapshots.
2. Review the master and architecture guide for changed capabilities, decision boundaries and cross-guide routes. A source or code update does not silently certify existing architectural insights.
3. Refresh current audit evidence against the final source and collection bytes. Changed source, references or master invalidate corresponding earlier evidence.
4. Have the integration owner perform the acceptance procedure below after all edits land. Record observed commands/results and close the issue only after acceptance. Commit, push and remote synchronization require authorization.

Keep one `SKILL.md`, with frontmatter name `ax-skills`, description within 1024 characters, body below 500 lines and the recommended 5000 tokens. References have no frontmatter or additional skill entrypoints. Keep all reference routes local, direct and usable without the provenance snapshot.

## Acceptance and evidence

Structural validation and semantic/design review answer different questions. The integration owner runs the following after integration, with Python 3 and `skills-ref` available:

```sh
python3 scripts/sync_ax_sources.py --check
python3 scripts/validate_ax_skills.py
skills-ref validate skills/ax-skills
```

Exercise sync/validator behavior tests and host discovery/disclosure smoke checks as well. Inspect the actual master and selected local guides, not just route labels. These are acceptance instructions, not claims that this revision has passed them.

The final **original-versus-new full semantic coverage review** must cover all 19 official source files against the final master and mapped references. Account for every semantic unit and organizational section; resolve missing, incorrect, uncertain or conflicting findings, then repeat the full review after corrections. Check exact contracts and preserved warnings, not keyword presence.

Separately exercise pre-development design and implementation scenarios: select generation versus agents versus flows versus event resumption; assign context/state and side-effect ownership; choose retrieval versus compaction versus optimization; then implement cross-cutting tasks such as agent + MCP, provider + structured outputs, audio + generation, and event-driven agent/flow resumption using only the master and selected guides. Review architecture synthesis for source grounding, explicit assumptions and unsupported guarantees. Verify narrow tasks do not require unrelated guides and overlapping tasks can load several.

[Coverage audit](assets/coverage-audit.json) holds current review evidence only for the source and destination hashes it identifies. Record actual methods, verdicts, resolutions, scenario results and exercised gates; do not relabel historical verdicts as current. The prior 25.4.1 audit, manifest and measurements remain historical Git objects, for example `4cd9d844:skills/ax-skills/assets/coverage-audit.json` and `4cd9d844:skills/ax-skills/README.md` (inspect with `git show`). They do not certify the 25.4.3 bundle or authored architecture guide.

Aggregate corpus compression is not task-level quality. A smaller complete collection can still omit a critical constraint, make a poor architectural choice or load irrelevant guides. Evaluate semantic completeness, design correctness and actual selected-guide disclosure separately. Report size/token measurements only with the measured snapshot, tokenizer and load composition; no density percentage or historical token count establishes current acceptance. Documentation checks do not certify live provider behavior, generated-language parity or application correctness.

## Verified foundation snapshot

The 25.4.3 foundation review covers all 7,817 official source lines in 324 sections: 307 covered units, four explicitly curated source-disagreement units and 13 organizational units. Manual review resolves both automatic missing-coverage findings against existing canonical retrieval rules and context-preset recommendations. All 29 source escalations and both density escalations are resolved; no current coverage defect remains. The audit records the superseded combined coverage/density framing separately from the accepted current-only comparison.

Fifteen architectural scenarios have documented support, and all 38 first-disclosure scenarios select their expected destinations: 15 design-first and 23 direct implementation routes. Selected files were loaded from the actual collection. These checks and independent source-grounding review establish documentary support and disclosure behavior, not a production model-quality improvement.

Observed gates passed: the live official source check; 13 isolated sync regressions; structural validation; `skills-ref validate` and `to-prompt`; and list-only Skills CLI discovery. Five additional isolated CLI scenarios exercise drift, update, subsequent check, no-op and local-edit refusal while preserving curated references, audit and lock data. Ten validator fixtures exercise valid input and malformed links, provenance, inventory, entrypoints, fences and authored-reference paths.

| Instruction load | Tokens |
| --- | ---: |
| Master, including metadata | 1,805 |
| Architecture guide | 5,725 |
| Master plus architecture guide | 7,530 |
| All implementation references | 80,778 |

Counts use `cl100k_base` with `tiktoken` 0.14.0; supporting README and JSON assets are excluded. The master is smaller than the preceding maintained master despite adding architectural orientation. The new design guide adds instructional coverage; do not interpret aggregate size as equal-coverage compression or measured application quality. No live provider, audio or generated-language compatibility check was performed. Re-run acceptance after any source or instructional change.

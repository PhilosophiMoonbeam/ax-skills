# Ax Skills Collection

One self-contained progressive-disclosure skill for designing and implementing TypeScript applications with `@ax-llm/ax`, grounded in the official **25.4.5** skill bundle. The collection supports holistic architectural decisions before code and precise API use during implementation. It uses terse-yet-complete Standard Technical English: remove repetition, not distinct contracts, constraints, examples or warnings.

## Design first, then implement

Before choosing APIs, define the task, input/output contracts, quality criteria, authority boundaries and operational constraints. Decide which work is structured generation, agent-directed tool use, explicit workflow orchestration or event-driven resumption. Assign ownership of context, state, side effects, persistence, retries, cancellation and evaluation. Distinguish within-run context management, retrieval, reusable knowledge and offline optimization; they solve different problems.

The collection has three instruction layers:

| Layer | Purpose | Loading |
| --- | --- | --- |
| [Master](skills/ax-skills/SKILL.md) | Capability orientation, safety/authorization policy, design-first routing and implementation routes | Always retained when this skill is active |
| [Architecture guide](skills/ax-skills/references/architecture.md) | Cross-subsystem design decisions, trade-offs and handoff to implementation | On demand for architecture, planning or consequential design changes |
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

The local reference snapshot is the complete **19-file official bundle** under `.agents/skills/ax-llm`, published for `@ax-llm/ax` 25.4.5 at upstream revision `288505e1b3b6dc686cb781fcc64fb7f5fd3da22e`. The [official index](https://ax-llm.github.io/ax/typescript/.well-known/agent-skills/index.json) identifies the [bundle archive](https://ax-llm.github.io/ax/typescript/.well-known/agent-skills/ax-llm/skill.tar.gz). The user-restored official sources are tracked reference fixtures. Only `skills/ax-skills/` is the published skill collection; source fixtures and local tooling are not distribution entrypoints.

Source paths below are relative to `.agents/skills/ax-llm`; destination labels are relative to `skills/ax-skills/`, and links resolve from this repository root. The bundle becomes one master plus 18 implementation references, supplemented by one authored architecture reference. The master directly links all 19 references.

Relative to the preserved 25.4.3 bundle, 16 official files are byte-identical, the root `SKILL.md` changes only version metadata, and two guides add technical guidance: provider compatibility reports in `ax-ai.md`, and novel-word F1 evaluation/native counterparts in `ax-gen.md`. Compatibility reports measure requested capabilities, not semantic quality; novelty F1 measures lexical overlap, not correctness.

Release context also matters: [25.4.4 / PR 851](https://github.com/ax-llm/ax/pull/851) fixes Gemini cache creation to retain every ordered system message across content breakpoints. Existing caches require expiry or recreation; upgrading alone does not repair cached instructions. [25.4.5 / PR 862](https://github.com/ax-llm/ax/pull/862) closes five named parity areas: native novelty-F1 helpers, partial-JSON string/escaped-quote repair, independent audio input/output compatibility and native reports, Rust/C++ reconnect-close wakeup plus synchronous generated ping without JavaScript timers/listeners, and regression verification of the generated Gemini ordered-system cache mapper. This is not blanket generated-language parity or a resolution of unrelated Box-source contradictions.

| Official source | Local destination |
| --- | --- |
| `SKILL.md` | [SKILL.md](skills/ax-skills/SKILL.md) and [references/llm.md](skills/ax-skills/references/llm.md) |
| `references/quickstart.md` | [references/llm.md](skills/ax-skills/references/llm.md) |
| `references/ax-ai.md` | [references/ai.md](skills/ax-skills/references/ai.md) |
| `references/ax-audio.md` | [references/audio.md](skills/ax-skills/references/audio.md) |
| `references/ax-signature.md` | [references/signature.md](skills/ax-skills/references/signature.md) |
| `references/ax-gen.md` | [references/gen.md](skills/ax-skills/references/gen.md) |
| `references/ax-agent.md` | [references/agent.md](skills/ax-skills/references/agent.md) |
| `references/ax-agent-context.md` | [references/agent-context.md](skills/ax-skills/references/agent-context.md) |
| `references/ax-agent-memory-skills.md` | [references/agent-memory-skills.md](skills/ax-skills/references/agent-memory-skills.md) |
| `references/ax-agent-rlm.md` | [references/agent-rlm.md](skills/ax-skills/references/agent-rlm.md) |
| `references/ax-agent-observability.md` | [references/agent-observability.md](skills/ax-skills/references/agent-observability.md) |
| `references/ax-agent-optimize.md` | [references/agent-optimize.md](skills/ax-skills/references/agent-optimize.md) |
| `references/ax-flow.md` | [references/flow.md](skills/ax-skills/references/flow.md) |
| `references/ax-event-runtime.md` | [references/event-runtime.md](skills/ax-skills/references/event-runtime.md) |
| `references/ax-gepa.md` | [references/gepa.md](skills/ax-skills/references/gepa.md) |
| `references/ax-playbook.md` | [references/playbook.md](skills/ax-skills/references/playbook.md) |
| `references/ax-refine.md` | [references/refine.md](skills/ax-skills/references/refine.md) |
| `references/ax-mcp.md` | [references/mcp.md](skills/ax-skills/references/mcp.md) |
| `references/ax-typesafe.md` | [references/typesafe.md](skills/ax-skills/references/typesafe.md) |
| Authored cross-subsystem synthesis; no one-to-one source | [references/architecture.md](skills/ax-skills/references/architecture.md) |

[Source manifest](skills/ax-skills/assets/source-manifest.json) schema 2 records the source root, package/version, upstream commit, index/archive URLs and archive SHA-256. Every official Markdown member has a repository-relative source path, collection-relative destinations, SHA-256, original byte count and line count. `authored_references` distinguishes architecture synthesis from copied-source mappings. Archive and member hashes are the ongoing bundle provenance authority. `skills-lock.json` is installer-managed historical metadata: do not manually rewrite it to simulate synchronization.

Two source conflicts remain explicit:

- The provider overview excludes Jev media, while the Typesafe contract supports PNG/JPEG images. The collection follows the detailed image contract without treating the overview as evidence of broader media support.
- Signature guidance places generated-language Box support in the AxIR backlog, while Typesafe guidance claims six-language availability. TypeScript Box guidance is available; inspect the target generated package before relying on another language's support.

## Routine synchronization and integration

Track work in Beads: run `bd prime` and `bd ready`, then create or claim the relevant issue. Read `SKILLS_SPEC.md` and affected source/reference sections before editing. From the repository root:

Maintainer checks require the tracked `.agents/skills/ax-llm` reference fixtures. If they are missing locally, restore the exact official archive identified by the source manifest before source synchronization or structural validation. The sync helper checks or updates an existing snapshot; it does not bootstrap missing fixtures. Installed-skill users need none of these repository inputs.

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

[Coverage audit](skills/ax-skills/assets/coverage-audit.json) holds current review evidence only for the source and destination hashes it identifies. Record actual methods, verdicts, resolutions, scenario results and exercised gates; do not relabel historical verdicts as current. The prior 25.4.1 audit, manifest and measurements remain historical Git objects, for example `4cd9d844:skills/ax-skills/assets/coverage-audit.json` and `4cd9d844:skills/ax-skills/README.md` (inspect with `git show`). They do not certify the 25.4.5 bundle or authored architecture guide.

Aggregate corpus compression is not task-level quality. A smaller complete collection can still omit a critical constraint, make a poor architectural choice or load irrelevant guides. Evaluate semantic completeness, design correctness and actual selected-guide disclosure separately. Report size/token measurements only with the measured snapshot, tokenizer and load composition; no density percentage or historical token count establishes current acceptance. Documentation checks do not certify live provider behavior, generated-language parity or application correctness.

## 25.4.5 refresh results

The full-source comparison covers all 7,835 official lines in 325 sections: 305 covered, 15 organizational and five explicitly curated source-disagreement units. All 29 escalations are resolved against current canonical guidance, with no outstanding coverage gaps or unacknowledged conflicts. Separate review of 19 changed instructional documents found no density regressions; the event-runtime guide is unchanged.

All 18 architectural scenarios have documented support. After correcting design/porting priority and native-report discovery, the final 44-case first-disclosure check selected 43 expected routes automatically. Manual review resolved the remaining configuration case and two low-confidence correct choices against the literal master routes. This is documentary/disclosure evidence, not a production model-quality result.

Passed: exact published-source verification, 13 sync regressions, structural validation, `skills-ref validate`/`to-prompt`, list-only discovery of the distribution leaf, and an isolated current-version sync no-op preserving all 42 fixture-file hashes. Seven local consumer cases exercised the actual published 25.4.5 TypeScript novelty-F1 helper, including default/recall modes, multiset counts, history/stopwords, Unicode and empty inputs. No Ax application provider calls, live audio or generated-language executions were performed.

## 25.4.5 measurements

These counts use `cl100k_base` with `tiktoken` 0.14.0. Instruction totals include Markdown metadata; README, JSON assets and tooling are excluded.

| Instruction load | Tokens |
| --- | ---: |
| Master | 1,858 |
| Architecture guide | 6,073 |
| Master plus architecture guide | 7,931 |
| All implementation references | 81,645 |
| Complete official collection | 87,909 |
| Complete unified collection | 89,576 |

The unified total includes the authored architecture synthesis; this is not an equal-coverage compression benchmark. Narrow tasks still load the master and selected implementation sections, not the architecture guide by default. Neither token counts nor documentary review establish application quality.

The prior 25.4.3 foundation review and measurements remain historical in `b0b655b:skills/ax-skills/assets/coverage-audit.json` and `b0b655b:README.md`. They are not current acceptance evidence.

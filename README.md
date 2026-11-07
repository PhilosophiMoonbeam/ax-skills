# Ax Skills Collection

One self-contained progressive-disclosure skill for designing and implementing TypeScript applications with `@ax-llm/ax`, grounded in the official **25.4.9** skill bundle. The collection supports holistic architectural decisions before code and precise API use during implementation. It uses terse-yet-complete Standard Technical English: remove repetition, not distinct contracts, constraints, examples or warnings.

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
npx skills@latest add https://github.com/PhilosophiMoonbeam/ax-skills/tree/main/skills/ax-skills
```

When prompted, select **`ax-skills`** and the target agent host. This collection is intended to be the workspace's one active Ax master. Do not activate a duplicate official `ax-llm` entrypoint or separately registered specialists alongside it; inspect existing installations and deliberately choose which entrypoint remains active.

[Official installation guidance](https://axllm.dev/typescript/skills/) documents a separate upstream installation path. In 25.4.9, when package-install scripts run, automatic setup requires the resolved consumer root's `package.json` to list `@ax-llm/ax` in `dependencies`, `devDependencies` or `optionalDependencies`. It installs official `ax-llm` and local guides in that root's `.claude/skills`, not this collection. Transitive and global installs skip setup, as does CI; runtime imports do not perform this installation. Root resolution prefers `INIT_CWD`, then the installed package's topmost `node_modules` parent. To prevent duplicate setup:

- Set `AX_SKIP_SKILL_INSTALL=1` during package installation to skip that run.
- Run `npx @ax-llm/ax skills-auto-install off` from the project root to save `ax.skills.autoInstall: false` in `package.json`; merge that setting before the first installation if needed. `skills-auto-install on` restores future automatic setup. CI and the environment opt-out take precedence.
- These preferences do not remove existing skills. Manual `npx @ax-llm/ax setup-claude` still works when automatic setup is disabled; `--all` registers specialists separately. Upstream documents `remove-claude` followed by `setup-claude` for migrating an older official full installation to its official single entrypoint. Do not run that migration merely to install this collection; review existing files before intentional removal or replacement.

## Official bundle and local mapping

The local reference snapshot is the complete **19-file official bundle** under `.agents/skills/ax-llm`, published for `@ax-llm/ax` 25.4.9 with npm `gitHead` `3ad7b69947e05f1770b1bd6cb1316a8ec7fcd106`. Local source-snapshot commit `72bdb96e1db79f9e95d983a97ca3cfe9acef4655` and its parent `d2a94fa` provide the 25.4.9-versus-25.4.8 comparison boundary, not the upstream publication revision. The [official index](https://ax-llm.github.io/ax/typescript/.well-known/agent-skills/index.json) identifies the [bundle archive](https://ax-llm.github.io/ax/typescript/.well-known/agent-skills/ax-llm/skill.tar.gz), SHA-256 `f49ea43da83174dcdeef0b2d454dd3627984d513e4671e323c15aa614f2f2a4c`. All 19 local source members match that publication byte-for-byte: 377,164 bytes and 7,865 lines. The user-restored official sources are tracked reference fixtures. Only `skills/ax-skills/` is the published skill collection; source fixtures and local tooling are not distribution entrypoints.

Source paths below are relative to `.agents/skills/ax-llm`; destination labels are relative to `skills/ax-skills/`, and links resolve from this repository root. The bundle becomes one master plus 18 implementation references, supplemented by one authored architecture reference. The master directly links all 19 references.

Relative to the preserved 25.4.8 bundle, 16 official guides are byte-identical. The master changes version metadata; Providers adds empty-text replay and cache-marker rules; Generation adds per-call unknown-tool recovery and formatter bypass. The installer lock records new digests, not additional API contracts.

The [25.4.9 release](https://github.com/ax-llm/ax/releases/tag/25.4.9) separates visible output from sensitive replay state: [PR 876](https://github.com/ax-llm/ax/pull/876) omits truly empty text after preserved Anthropic thinking; [PR 883](https://github.com/ax-llm/ax/pull/883) aligns generated-client cache placement and plain unknown-tool errors. Generated clients already continued unknown-tool batches; the previous downstream raise-and-retry caveat is obsolete. The collection preserves the bounded recovery contract and application-owned authority, deduplication and replay policy—not universal port parity. [PR 881](https://github.com/ax-llm/ax/pull/881) narrows automatic skill setup as described above. The new authenticated-local MCP example and security-reporting documentation add no library API or runtime guarantee.

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

[Coverage audit](skills/ax-skills/assets/coverage-audit.json) holds review evidence only for the source and destination hashes it identifies. Record actual methods, verdicts, resolutions, scenario results and exercised gates; do not relabel historical judgments or SDK runs as current. Source-publication checks establish fixture identity, not curated semantic coverage. The prior 25.4.1 audit, manifest and measurements remain historical Git objects, for example `4cd9d844:skills/ax-skills/assets/coverage-audit.json` and `4cd9d844:skills/ax-skills/README.md` (inspect with `git show`). They do not certify the current bundle or authored architecture guide.

Aggregate corpus compression is not task-level quality. A smaller complete collection can still omit a critical constraint, make a poor architectural choice or load irrelevant guides. Evaluate semantic completeness, design correctness and actual selected-guide disclosure separately. Report size/token measurements only with the measured snapshot, tokenizer and load composition; no density percentage or historical token count establishes current acceptance. Documentation checks do not certify live provider behavior, generated-language parity or application correctness.

## 25.4.9 refresh results

The fresh full-source comparison covers all 7,865 official lines in 326 sections. Raw Jev labels were 303 covered, 14 organizational, eight gaps and one curated. Inspection resolved all 57 escalations: eight false-gap labels were supported by current canonical sections; five explicit curations remain bounded; official frontmatter is organizational. Accepted totals are 306 covered, 15 organizational and five curated, with no unresolved coverage defect. No prior verdict was relabeled as current.

All 29 architecture scenarios have documented support. One 60,612-character design state exceeded the frozen 60,000-character cap; its marked truncation and complete manual review are recorded. All 65 first-disclosure routes matched automatically; five low-confidence cases were confirmed against literal master policy. Five new prose checks were dense; all five accuracy escalations were resolved against primary sources and actual SDK evidence. Two independent bounded reviews found no defects. All 425 review-state fingerprints were independently reconstructed. These are documentary/design/disclosure results, not production model-quality or whole-corpus density scores.

Passed: exact published-source verification, 13 sync regressions, structural validation, `skills-ref validate`/`to-prompt`, list-only distribution-leaf discovery, and isolated current-version sync no-op preserving 42 fixture-file hashes. Actual TypeScript SDK replay checks passed all 28 current cases and reproduced 22 expected empty-text failures plus six passing controls on 25.4.8. All 20 tool-recovery/formatter/error-boundary scenarios passed across both versions. Published installer decision modules passed 37 isolated checks per version, confirming direct-root setup versus transitive/global skips without writing skills.

SDK smokes made no live provider calls; signatures were opaque fixtures, not cryptographic validation. Actual package-manager installation, manual setup, Windows, audio and generated-language execution were not qualified. Local-leaf discovery does not prove bare-repository discovery isolation. Owned scratch was removed after evidence capture.

## 25.4.9 measurements

These counts use `cl100k_base` with `tiktoken` 0.14.0. Instruction totals include Markdown metadata; README, JSON assets and tooling are excluded.

| Instruction load | Tokens |
| --- | ---: |
| Master | 1,908 |
| Architecture guide | 7,061 |
| Master plus architecture guide | 8,969 |
| All implementation references | 83,483 |
| Complete official collection | 88,575 |
| Complete unified collection | 92,452 |

The unified total includes the authored architecture synthesis; this is not an equal-coverage compression benchmark. Narrow tasks still load the master and selected implementation sections, not the architecture guide by default. Neither token counts nor documentary review establish application quality.

Prior review evidence remains historical: 25.4.8 in `d2a94fa:skills/ax-skills/assets/coverage-audit.json` and `d2a94fa:README.md`; 25.4.7 in `57b5cba:skills/ax-skills/assets/coverage-audit.json` and `57b5cba:README.md`; 25.4.6 in `93020c9:skills/ax-skills/assets/coverage-audit.json` and `93020c9:README.md`; 25.4.5 in `e3d86c0:skills/ax-skills/assets/coverage-audit.json` and `e3d86c0:README.md`; the 25.4.3 foundation in `b0b655b:skills/ax-skills/assets/coverage-audit.json` and `b0b655b:README.md`. None certifies the current snapshot.

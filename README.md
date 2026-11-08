# Ax Skills Collection

One self-contained progressive-disclosure skill for designing and implementing TypeScript applications with `@ax-llm/ax`, grounded in the official **25.4.9** skill bundle. The collection supports holistic architectural decisions before code and precise API use during implementation. It uses terse-yet-complete Standard Technical English: remove repetition, not distinct contracts, constraints, examples or warnings.

## Design first, then implement

Before choosing APIs, define the task, input/output contracts, quality criteria, authority boundaries and operational constraints. Decide which work is structured generation, agent-directed tool use, explicit workflow orchestration or event-driven resumption. Assign ownership of context, state, side effects, persistence, retries, cancellation and evaluation. Distinguish within-run context management, retrieval, reusable knowledge and offline optimization; they solve different problems.

The collection has four disclosure layers:

| Layer | Purpose | Loading |
| --- | --- | --- |
| [Master](skills/ax-skills/SKILL.md) | Capability orientation, safety/authorization policy, design-first routing and implementation routes | Always retained when this skill is active |
| [Architecture guide](skills/ax-skills/references/architecture.md) | Cross-subsystem design decisions, trade-offs and handoff to implementation | On demand for architecture, planning or consequential design changes |
| 18 implementation references | Source-derived API contracts, constraints, examples and specialist behavior | Only the guides needed for the task |
| [36 executable modules](skills/ax-skills/examples/INDEX.md) | Runnable core contracts, selected mechanisms and five architectural compositions | Only the selected module/case after its owning guide |

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

## Run the installed examples

The [example index](skills/ax-skills/examples/INDEX.md) maps every module, links its guide and explains fixture/live modes, prerequisites, effects and cleanup. The master routes to that single index rather than eagerly linking every module. Choose architecture → narrow guide → selected example for design work; narrow implementation tasks need only their owning guide/example. CLI metadata discovery imports modules without running cases; do not preload their source into the agent context.

The examples package travels with the skill collection and needs no original fixtures, full Ax checkout or repository tooling. Use Node >=22.18.0; use Node 24 and npm 12 for the native SQLite setup below. From this repository root:

```sh
npm --prefix skills/ax-skills/examples ci --ignore-scripts
npm --prefix skills/ax-skills/examples install-scripts approve better-sqlite3
npm --prefix skills/ax-skills/examples rebuild better-sqlite3 --foreground-scripts
npm --prefix skills/ax-skills/examples run check
npm --prefix skills/ax-skills/examples run list
npm --prefix skills/ax-skills/examples run offline -- 01-signatures
npm --prefix skills/ax-skills/examples run offline
```

For an installed skill, run the same commands from its `ax-skills` directory with `--prefix examples`. Package/lock pins are Ax, Ax Tools and the Ax Vercel provider 25.4.9; `ai` 7.0.2 with `@ai-sdk/provider` 4.0.0 and `@ai-sdk/provider-utils` 5.0.0 overrides; OpenTelemetry API 1.9.0 and trace SDK 2.0.1; Zod 4.1.11, TypeScript 5.9.3, tsx 4.20.6, esbuild 0.25.12 and Node types 22.18.6. The trace SDK release is npm-deprecated but tested compatible here. Script-free installation avoids automatic upstream skill setup; explicitly approve/rebuild only `better-sqlite3`, with a compatible native prebuild or build toolchain. The package records npm 12 approval for the pinned driver; older npm versions without `install-scripts` omit only that approval command, retaining the targeted rebuild. Do not rebuild all dependencies or enable Ax’s postinstall. Installation writes `node_modules`; cases own their local resources and temporary stores.

Offline is the default: scripted model I/O drives actual SDK algorithms and local/injected protocols, not billed providers or real-provider quality evidence. Browser adapter fixtures and the browser entry do not qualify actual browser-model inference. Audio modules are offline protocol/media fixtures, not real speech or microphone acceptance. SQLite uses native `better-sqlite3`, not Node’s built-in SQLite API. Generic model credentials do not establish audio, image/Box, MCP or OAuth prerequisites.

For separately authorized live work, set `AX_EXAMPLE_ENV_FILE` to an absolute private file path. This exact exported case declares live mode; inspect `list` before selecting another case:

```sh
npm --prefix skills/ax-skills/examples run live -- --env "$AX_EXAMPLE_ENV_FILE" 26-architecture/typed-invoice
```

Generation configuration names are `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`; decisions use `AI_DECISIONS_PROVIDER`, `AI_DECISIONS_MODEL`, `AI_DECISIONS_API_KEY`. Optional endpoint/deployment names and operation-specific prerequisites are in the index. Never commit or print private values. Live mode requires named selection; it does not run an implicit sweep. Offline limits are 50 fetch requests and 50 loopback socket connections per case; the live fetch limit is 50 per invocation. Cases have 120 seconds and helper-generated output is capped at 512 tokens; these are not spending or production reliability guarantees. No live microphone or external business write belongs to this suite.

Supported/exported modes are not exercised acceptance. Report actual typecheck, fixture, runtime and live-provider results separately; proposed commands and successful fixture responses do not certify live model quality. The integration owner runs all gates after module edits land.

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

[Coverage audit](skills/ax-skills/assets/coverage-audit.json) records the final original-to-curated review. [Examples audit](skills/ax-skills/assets/examples-audit.json) records feature mappings, selected case spans, raw Jev verdicts/probabilities, parent resolutions and observed execution. Each applies only to its recorded hashes. Source-publication checks establish fixture identity, not semantic coverage. Earlier audits remain historical Git objects; the pre-example 25.4.9 audit is `d4f113f:skills/ax-skills/assets/coverage-audit.json`, and the 25.4.1 audit is `4cd9d844:skills/ax-skills/assets/coverage-audit.json`.

Aggregate corpus compression is not task-level quality. A smaller complete collection can still omit a critical constraint, make a poor architectural choice or load irrelevant guides. Evaluate semantic completeness, design correctness and actual selected-guide disclosure separately. Report size/token measurements only with the measured snapshot, tokenizer and load composition; no density percentage or historical token count establishes current acceptance. Documentation checks do not certify live provider behavior, generated-language parity or application correctness.

## Current executable-example acceptance

The pinned collection contains **202 cases in 36 modules**, with one selectively loaded index. Strict TypeScript and the complete offline CLI suite pass. Offline cases exercise real SDK algorithms, native SQLite, owned protocol peers and provider adapters with declared synthetic I/O; they are not model-quality benchmarks.

The Jev augmentation separates atomic semantic judgments from authoritative facts, ordered host policy and authorized effects. The ticket composition exercises 18 overlap, eligibility, amount and uncertainty scenarios; generation chaining now uses extraction → host rule → explanation. New cases prove scalar/evidence threshold ownership, companion applicability gating and native Flow score-rubric signatures. Design work reaches this material through Architecture → Typesafe → the selected example; the 52-line master remains unchanged. Source: [TypeSafe’s judgment-versus-decision guidance](https://typesafe.ai/blog/dont-call-it-a-decision-model).

Earlier live acceptance covered configured generation, adapter decision evidence, native structured decisions, typed invoice extraction and the original repository-investigator composition: **five scenarios, 16 actual HTTP requests**. Those observations remain historical and do not qualify the amended ticket composition or new cases. No live provider calls were made for this augmentation. Earlier browser checks observed the honest **unavailable on this device/profile** state, not model inference. Live speech, microphone, image synthesis and external business writes remain unqualified.

Execution corrected guide assumptions about raw-chat streaming defaults, hook timing/stop behavior, Zod enum conversion, recalled-memory worker visibility, agent bootstrap/restoration, partial chat logs, sink-redrive snapshots, ineffective bundled `promptLevel` templates, Vercel forwarding and verified webhook metadata binding. The Jev changes additionally correct scalar-versus-evidence thresholds and the Flow guide’s native-client-only scoring claim. Audit assets distinguish the immutable historical full review from current amendment inputs, byte-identical carryover and observed execution; old automated votes are never relabeled as fresh acceptance. The 19 official files / 7,865 lines remain preserved; current curated corrections deliberately qualify inaccurate upstream wording.

## Historical 25.4.9 refresh results

These results describe the earlier hash-pinned documentation refresh, before the executable-example/disclosure changes. They remain evidence for that recorded state only, not current acceptance of these edits or any live provider.

The fresh full-source comparison covers all 7,865 official lines in 326 sections. Raw Jev labels were 303 covered, 14 organizational, eight gaps and one curated. Inspection resolved all 57 escalations: eight false-gap labels were supported by current canonical sections; five explicit curations remain bounded; official frontmatter is organizational. Accepted totals are 306 covered, 15 organizational and five curated, with no unresolved coverage defect. No prior verdict was relabeled as current.

All 29 architecture scenarios have documented support. One 60,612-character design state exceeded the frozen 60,000-character cap; its marked truncation and complete manual review are recorded. All 65 first-disclosure routes matched automatically; five low-confidence cases were confirmed against literal master policy. Five new prose checks were dense; all five accuracy escalations were resolved against primary sources and actual SDK evidence. Two independent bounded reviews found no defects. All 425 review-state fingerprints were independently reconstructed. These are documentary/design/disclosure results, not production model-quality or whole-corpus density scores.

Passed: exact published-source verification, 13 sync regressions, structural validation, `skills-ref validate`/`to-prompt`, list-only distribution-leaf discovery, and isolated current-version sync no-op preserving 42 fixture-file hashes. Actual TypeScript SDK replay checks passed all 28 current cases and reproduced 22 expected empty-text failures plus six passing controls on 25.4.8. All 20 tool-recovery/formatter/error-boundary scenarios passed across both versions. Published installer decision modules passed 37 isolated checks per version, confirming direct-root setup versus transitive/global skips without writing skills.

SDK smokes made no live provider calls; signatures were opaque fixtures, not cryptographic validation. Actual package-manager installation, manual setup, Windows, audio and generated-language execution were not qualified. Local-leaf discovery does not prove bare-repository discovery isolation. Owned scratch was removed after evidence capture.

## Historical 25.4.9 measurements

These pre-example/disclosure counts used `cl100k_base` with `tiktoken` 0.14.0. Instruction totals included Markdown metadata; README, JSON assets, executable code and tooling were excluded. They are not measurements of the current edited master or example disclosure.

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

# Ax Skills Collection

One self-contained progressive-disclosure skill for designing and implementing TypeScript applications with `@ax-llm/ax`, grounded in the supplied official **25.4.11** skills and release. The collection supports holistic architectural decisions before code and precise API use during implementation. It uses terse-yet-complete Standard Technical English: remove repetition, not distinct contracts, constraints, examples or warnings.

## Design first, then implement

Before choosing APIs, define the task, input/output contracts, quality criteria, authority boundaries and operational constraints. Decide which work is structured generation, agent-directed tool use, explicit workflow orchestration or event-driven resumption. Assign ownership of context, state, side effects, persistence, retries, cancellation and evaluation. Distinguish within-run context management, retrieval, reusable knowledge and offline optimization; they solve different problems.

The collection has four disclosure layers:

| Layer | Purpose | Loading |
| --- | --- | --- |
| [Master](skills/ax-skills/SKILL.md) | Capability orientation, safety/authorization policy, design-first routing and implementation routes | Always retained when this skill is active |
| [Architecture guide](skills/ax-skills/references/architecture.md) | Cross-subsystem design decisions, trade-offs and handoff to implementation | On demand for architecture, planning or consequential design changes |
| 18 implementation references | Source-derived API contracts, constraints, examples and specialist behavior | Only the guides needed for the task |
| [39 executable modules](skills/ax-skills/examples/INDEX.md) | Runnable core contracts, selected mechanisms, five architectural compositions and four general decision-pattern cases | Only the selected module/case after its owning guide |

The architecture guide is authored, source-grounded synthesis, not an official API quotation or a promise of runtime guarantees. Implementation references preserve the official contracts and their caveats. Read the architecture guide with selected implementation guides when design depends on exact capabilities. Multiple guides are appropriate for overlapping tasks; loading the entire corpus is not the default.

For semantic decisions, start with [architecture](skills/ax-skills/references/architecture.md) to separate deterministic facts, bounded atomic judgments and host-owned policy/effects. Use [typed decisions](skills/ax-skills/references/typesafe.md) for candidate selection, question/state design, scoring, verification and provider-specific contracts; then select [39-decision-patterns.ts](skills/ax-skills/examples/39-decision-patterns.ts). Generation, Flow and optimization remain complementary mechanisms, not substitutes for authority or evaluation.

The host discovers metadata first, loads the master when the skill activates, then follows its local routes. README and audit assets are supporting documentation, not additional entrypoints. Using the installed collection requires neither the original source snapshot nor a full Ax checkout or separately installed specialist skills. External documentation supplements local guidance; check installed package declarations and authoritative documentation when versions differ.

## Installation and one active Ax master

```sh
bunx skills@latest add https://github.com/PhilosophiMoonbeam/ax-skills/tree/main/skills/ax-skills
```

When prompted, select **`ax-skills`** and the target agent host. This collection is intended to be the workspace's one active Ax master. Do not activate a duplicate official `ax-llm` entrypoint or separately registered specialists alongside it; inspect existing installations and deliberately choose which entrypoint remains active.

[Official installation guidance](https://axllm.dev/typescript/skills/) documents a separate upstream installation path. In the pinned package, when package-install scripts run, automatic setup requires the resolved consumer root's `package.json` to list `@ax-llm/ax` in `dependencies`, `devDependencies` or `optionalDependencies`. It installs official `ax-llm` and local guides in that root's `.claude/skills`, not this collection. Transitive and global installs skip setup, as does CI; runtime imports do not perform this installation. Root resolution prefers `INIT_CWD`, then the installed package's topmost `node_modules` parent. To prevent duplicate setup:

- Set `AX_SKIP_SKILL_INSTALL=1` during package installation to skip that run.
- Run `bunx @ax-llm/ax skills-auto-install off` from the project root to save `ax.skills.autoInstall: false` in `package.json`; merge that setting before the first installation if needed. `skills-auto-install on` restores future automatic setup. CI and the environment opt-out take precedence.
- These preferences do not remove existing skills. Manual `bunx @ax-llm/ax setup-claude` still works when automatic setup is disabled; `--all` registers specialists separately. Upstream documents `remove-claude` followed by `setup-claude` for migrating an older official full installation to its official single entrypoint. Do not run that migration merely to install this collection; review existing files before intentional removal or replacement.

## Run the installed examples

The [example index](skills/ax-skills/examples/INDEX.md) maps every module, links its guide and explains fixture/live modes, prerequisites, effects and cleanup. The master routes to that single index rather than eagerly linking every module. Choose architecture → narrow guide → selected example for design work; narrow implementation tasks need only their owning guide/example. CLI metadata discovery imports modules without running cases; do not preload their source into the agent context.

The examples package travels with the skill collection and needs no original fixtures, full Ax checkout or repository tooling. Use Bun **1.4.4** for installation and commands, with Node **>=22.18.0** for the SDK scripts (Node 24 is verified). Bun is the package manager; these scripts deliberately retain the Node runtime. From this repository root:

```sh
bun install --no-env-file --cwd skills/ax-skills/examples --frozen-lockfile
bun run --no-env-file --cwd skills/ax-skills/examples check
bun run --no-env-file --cwd skills/ax-skills/examples list
bun run --no-env-file --cwd skills/ax-skills/examples offline 01-signatures
bun run --no-env-file --cwd skills/ax-skills/examples offline
```

For an installed skill, use the same commands from its `ax-skills` directory with `--cwd examples`. `--no-env-file` disables Bun's automatic `.env` loading; live runs still receive the runner's explicit `--env` path. The authoritative `bun.lock` pins Ax, Ax Tools and the Ax Vercel provider 25.4.11; `ai` 7.0.2 with `@ai-sdk/provider` 4.0.0 and `@ai-sdk/provider-utils` 5.0.0 overrides; OpenTelemetry API 1.9.0 and trace SDK 2.0.1; Zod 4.1.11, TypeScript 5.9.3, tsx 4.20.6, esbuild 0.25.12 and Node types 22.18.6. The trace SDK release is registry-deprecated; compatibility evidence applies only to recorded checks. The explicit Bun `trustedDependencies` list permits lifecycle scripts only for `better-sqlite3`, requiring a compatible native prebuild or build toolchain. It replaces Bun's default allowlist and leaves Ax's skill-install postinstall disabled. Do not trust all dependencies. Installation writes `node_modules`; cases own their local resources and temporary stores.

Offline is the default: scripted model I/O drives actual SDK algorithms and local/injected protocols, not billed providers or real-provider quality evidence. Browser adapter fixtures and the browser entry do not qualify actual browser-model inference. Audio modules are offline protocol/media fixtures, not real speech or microphone acceptance. SQLite uses native `better-sqlite3`, not Node’s built-in SQLite API. Generic model credentials do not establish audio, image/Box, MCP or OAuth prerequisites.

For separately authorized live work, set `AX_EXAMPLE_ENV_FILE` to an absolute private file path. This exact exported case declares live mode; inspect `list` before selecting another case:

```sh
bun run --no-env-file --cwd skills/ax-skills/examples live --env "$AX_EXAMPLE_ENV_FILE" 26-architecture/typed-invoice
```

Generation configuration names are `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`; decisions use `AI_DECISIONS_PROVIDER`, `AI_DECISIONS_MODEL`, `AI_DECISIONS_API_KEY`. Optional endpoint/deployment names and operation-specific prerequisites are in the index. Never commit or print private values. Live mode requires named selection; it does not run an implicit sweep. Offline limits are 50 fetch requests and 50 loopback socket connections per case; the live fetch limit is 50 per invocation. Cases have 120 seconds and helper-generated output is capped at 512 tokens; these are not spending or production reliability guarantees. No live microphone or external business write belongs to this suite.

Supported/exported modes are not exercised acceptance. Report actual typecheck, fixture, runtime and live-provider results separately; proposed commands and successful fixture responses do not certify live model quality. The integration owner runs all gates after module edits land.

## Official bundle and local mapping

The supplied snapshot contains **39 inputs: 827,595 bytes and 16,950 lines** under `upstream/`. Its progressive bundle is the complete **19-file publication** at `upstream/ax-llm`: **386,935 bytes and 8,027 lines**, pinned to `@ax-llm/ax` **25.4.11**, npm `gitHead` `007ab8366e5bfa98d871feb1af188cc029295c58`. The canonical HTTPS [official index](https://axllm.dev/typescript/.well-known/agent-skills/index.json) identifies the [bundle archive](https://axllm.dev/typescript/.well-known/agent-skills/ax-llm/skill.tar.gz), SHA-256 `7a0352003bd15688a0806e8e372e1ece50681ed15eedf27f6f749b2461eb87b8`. The archive pin covers those 19 members, not all 39 supplied files.

The other inputs are **17 specialist `SKILL.md` wrappers and three nested Typesafe reference copies**. Wrappers largely repeat progressive-reference content with specialist metadata, orientation and examples; they are not 17 novel API topics. Review their distinct contracts, retain duplicate-source mappings and route them to the existing owning guides, not additional active skills. The source partition has 683 section occurrences: 349 unique units and 334 exact duplicates; nine release entries are separate inputs.

Two separately supplied supplements—the official TypeSafe skill and decision-pattern research—extend the review inventory to **41 inputs**, with **46 supplemental sections**. They do not change the original 39-input partition or the 19-member publication manifest. Research is fallible design input, not authority for Ax APIs or portable quality, calibration, cost, latency or security guarantees.

Source paths in the table are relative to `upstream/`; destinations are relative to `skills/ax-skills/`. Distributed Markdown links resolve from their containing file. One 52-line master directly routes all 19 local references: 18 implementation guides plus authored architecture synthesis. Only `skills/ax-skills/` is distributed; upstream files are reference inputs, not active entrypoints.

The [25.4.11 release](https://github.com/ax-llm/ax/releases/tag/25.4.11) adds or repairs four related surfaces:

- **Streamed tool text:** preserve text accompanying tool calls, merge deltas and retain it in subsequent request history; see [generation](skills/ax-skills/references/gen.md#streaming-output-and-replacement-versions) and [03-tools-streaming.ts](skills/ax-skills/examples/03-tools-streaming.ts). [PR 887](https://github.com/ax-llm/ax/pull/887) and [PR 891](https://github.com/ax-llm/ax/pull/891).
- **Gemini 4 Hydrogen:** apply its provider-specific thinking, request-size, schema/tool and streaming constraints, not generic Gemini assumptions; see [providers](skills/ax-skills/references/ai.md#gemini-4-hydrogen) and [04-providers.ts](skills/ax-skills/examples/04-providers.ts). [PR 892](https://github.com/ax-llm/ax/pull/892).
- **Native document citations:** preserve source forms, URL-less document locations and passage associations. Replace streamed block snapshots rather than appending them; provenance is attribution, not truth. See [citations](skills/ax-skills/references/ai.md#anthropic-document-citations), [normalized logs](skills/ax-skills/references/gen.md#normalized-chat-logs-and-usage) and [37-document-citations.ts](skills/ax-skills/examples/37-document-citations.ts). [PR 894](https://github.com/ax-llm/ax/pull/894), [PR 895](https://github.com/ax-llm/ax/pull/895) and [PR 896](https://github.com/ax-llm/ax/pull/896).
- **Shared references:** repeated sibling references are not ancestor cycles; preserve the former and mark only real cycles in executor replay. See [RLM](skills/ax-skills/references/agent-rlm.md#shared-references-are-not-cycles-25411) and [32-executor-context.ts](skills/ax-skills/examples/32-executor-context.ts). [PR 893](https://github.com/ax-llm/ax/pull/893) and [PR 896](https://github.com/ax-llm/ax/pull/896).

The release/credit entries, including [PR 897](https://github.com/ax-llm/ax/pull/897), are organizational evidence, not extra APIs. Generated-language release notes establish source-described scope, not runtime qualification here. Dedicated Jev, OpenAI and Gemini Decisions remain distinct contracts; shared evidence shapes do not imply equivalent APIs or calibration. See [typed decisions](skills/ax-skills/references/typesafe.md).

Two bounded tsEpistle backports reconcile the MCP example and its index note: `29-mcp-oauth.ts` preserves an earlier operation error when its SSE listener also fails, while still surfacing an unexpected listener failure after successful operations; `examples/INDEX.md` describes that precedence instead of a throw from `finally`. A separate failure flag handles even `throw undefined`; host-owned close cancellation remains expected. This is error-precedence preservation, not broader transport reliability.

**Historical 25.4.9:** [PR 876](https://github.com/ax-llm/ax/pull/876) corrected empty-text Anthropic replay; [PR 883](https://github.com/ax-llm/ax/pull/883) aligned generated cache placement and plain unknown-tool errors; [PR 881](https://github.com/ax-llm/ax/pull/881) narrowed automatic setup. Those bounded contracts remain relevant, but their prior acceptance does not certify this revision.

| Progressive source | Specialist wrapper | Local destination |
| --- | --- | --- |
| `ax-llm/SKILL.md` | — | [SKILL.md](skills/ax-skills/SKILL.md) and [references/llm.md](skills/ax-skills/references/llm.md) |
| `ax-llm/references/quickstart.md` | — | [references/llm.md](skills/ax-skills/references/llm.md) |
| `ax-llm/references/ax-ai.md` | `ax-ai/SKILL.md` | [references/ai.md](skills/ax-skills/references/ai.md) |
| `ax-llm/references/ax-audio.md` | `ax-audio/SKILL.md` | [references/audio.md](skills/ax-skills/references/audio.md) |
| `ax-llm/references/ax-signature.md` | `ax-signature/SKILL.md` | [references/signature.md](skills/ax-skills/references/signature.md) |
| `ax-llm/references/ax-gen.md` | `ax-gen/SKILL.md` | [references/gen.md](skills/ax-skills/references/gen.md) |
| `ax-llm/references/ax-agent.md` | `ax-agent/SKILL.md` | [references/agent.md](skills/ax-skills/references/agent.md) |
| `ax-llm/references/ax-agent-context.md` | `ax-agent-context/SKILL.md` | [references/agent-context.md](skills/ax-skills/references/agent-context.md) |
| `ax-llm/references/ax-agent-memory-skills.md` | `ax-agent-memory-skills/SKILL.md` | [references/agent-memory-skills.md](skills/ax-skills/references/agent-memory-skills.md) |
| `ax-llm/references/ax-agent-rlm.md` | `ax-agent-rlm/SKILL.md` | [references/agent-rlm.md](skills/ax-skills/references/agent-rlm.md) |
| `ax-llm/references/ax-agent-observability.md` | `ax-agent-observability/SKILL.md` | [references/agent-observability.md](skills/ax-skills/references/agent-observability.md) |
| `ax-llm/references/ax-agent-optimize.md` | `ax-agent-optimize/SKILL.md` | [references/agent-optimize.md](skills/ax-skills/references/agent-optimize.md) |
| `ax-llm/references/ax-flow.md` | `ax-flow/SKILL.md` | [references/flow.md](skills/ax-skills/references/flow.md) |
| `ax-llm/references/ax-event-runtime.md` | `ax-event-runtime/SKILL.md` | [references/event-runtime.md](skills/ax-skills/references/event-runtime.md) |
| `ax-llm/references/ax-gepa.md` | `ax-gepa/SKILL.md` | [references/gepa.md](skills/ax-skills/references/gepa.md) |
| `ax-llm/references/ax-playbook.md` | `ax-playbook/SKILL.md` | [references/playbook.md](skills/ax-skills/references/playbook.md) |
| `ax-llm/references/ax-refine.md` | `ax-refine/SKILL.md` | [references/refine.md](skills/ax-skills/references/refine.md) |
| `ax-llm/references/ax-mcp.md` | `ax-mcp/SKILL.md` | [references/mcp.md](skills/ax-skills/references/mcp.md) |
| `ax-llm/references/ax-typesafe.md` | `ax-typesafe/SKILL.md` | [references/typesafe.md](skills/ax-skills/references/typesafe.md) |
| `ax-ai/references/ax-typesafe.md`, `ax-gen/references/ax-typesafe.md`, `ax-signature/references/ax-typesafe.md` | Nested copies, not entrypoints | [references/typesafe.md](skills/ax-skills/references/typesafe.md) |
| Authored cross-subsystem synthesis; no one-to-one source | — | [references/architecture.md](skills/ax-skills/references/architecture.md) |

[Source manifest](skills/ax-skills/assets/source-manifest.json) **schema 2** pins only the progressive bundle: source root, package/version, npm revision, canonical index/archive URLs, archive hash and each member's destinations, SHA-256, bytes and lines. `authored_references` separates architecture synthesis from source mappings. The coverage audit separately binds the complete supplied inventory and duplicate occurrences; do not treat the bundle manifest as a 39-input manifest. `skills-lock.json` is installer-managed historical metadata, not synchronization evidence; do not hand-edit it.

Two source conflicts remain explicit:

- The provider overview excludes Jev media, while the Typesafe contract supports PNG/JPEG images. The collection follows the detailed image contract without treating the overview as evidence of broader media support.
- Signature guidance places generated-language Box support in the AxIR backlog, while Typesafe guidance claims six-language availability. TypeScript Box guidance is available; inspect the target generated package before relying on another language's support.

## Routine synchronization and integration

Track work in Beads: run `bd prime` and `bd ready`, then create or claim the relevant issue. Read `SKILLS_SPEC.md` and affected source/reference sections before editing. From the repository root:

Maintainer source checks require the tracked `upstream/ax-llm` progressive fixtures. If missing, restore the exact archive pinned by the source manifest before synchronization or structural validation; the helper does not bootstrap a missing root. Preserve the other supplied specialist/nested inputs separately. Installed-skill users need none of these repository inputs.

```sh
python3 scripts/sync_ax_sources.py --check
python3 scripts/sync_ax_sources.py --update
```

No argument means `--check`. Check mode is read-only and reports drift or invalid publication with a nonzero exit status. Explicit `--update` validates the official publication and updates only `upstream/ax-llm` and the schema-2 manifest; it does not update the 17 sibling specialist wrappers or three nested copies. It refuses unexpected local files, symlinks and managed source bytes modified relative to the manifest; preserve and resolve local changes rather than overwriting them. Neither mode installs skills, rewrites the lock file, integrates curated references or refreshes semantic evidence. Treat supplied inputs as preserved evidence; a deliberate future source refresh needs its own reviewed scope.

Optional CLI arguments are `--repo PATH`, `--collection PATH`, `--index-url URL` and `--npm-url URL`. Publication URL overrides are explicitly trusted inputs, including local test fixtures; do not substitute untrusted endpoints. Exact snapshot/manifest agreement returns exit status 0; drift, invalid metadata/archive, unsafe paths and network/write errors return 1. Update returns 0 after a validated import or no-op; it is mutually exclusive with `--check`.

A successful download or source update is not acceptance. After each update:

1. Integrate every relevant source change into the mapped implementation references, preserving actionable API shapes, constraints, defaults, edge cases, warnings, example intent and resource URLs. Remove obsolete claims rather than adding compatibility prose for superseded snapshots.
2. Review the master and architecture guide for changed capabilities, decision boundaries and cross-guide routes. A source or code update does not silently certify existing architectural insights.
3. Refresh current audit evidence against the final source and collection bytes. Changed source, references or master invalidate their earlier byte-specific judgments. Keep those judgments historical; record any deterministic, target-preserving link migration separately rather than rewriting old input hashes or calling it a fresh semantic review.
4. Have the integration owner perform the acceptance procedure below after all edits land. Record observed commands/results and close the issue only after acceptance. Commit, push and remote synchronization require authorization.

Keep one `SKILL.md`, with frontmatter name `ax-skills`, description within 1024 characters, body below 500 lines and the recommended 5000 tokens. References have no frontmatter or additional skill entrypoints. Keep all reference routes local, direct and usable without the provenance snapshot.

## Acceptance and evidence

Structural validation and semantic/design review answer different questions. The integration owner runs the following after integration, with Python 3 and `skills-ref` available:

```sh
python3 -m unittest discover -s scripts -p 'test_*.py'
python3 scripts/sync_ax_sources.py --check
python3 scripts/validate_ax_skills.py
skills-ref validate skills/ax-skills
skills-ref to-prompt skills/ax-skills
```

Also run the strict TypeScript check, actual CLI discovery and complete offline CLI commands in [Run the installed examples](#run-the-installed-examples). Inspect host discovery/disclosure, the actual master and selected local guides, not just route labels. These are acceptance instructions, not claims that this revision has passed them.

The final **original-versus-new full semantic coverage review** must cover all 39 supplied inputs and nine release entries against the final master and mapped references. Account for every nonempty section, including wrapper-only guidance, exact duplicates and organizational material; resolve missing, incorrect, uncertain or conflicting findings, then repeat the full review after semantic corrections. Preserve the 683-occurrence/349-unique/334-duplicate partition instead of counting duplicates as new API topics. A destination-only Markdown migration may retain historical semantic evidence through an explicit certificate proving identical resolved targets and unchanged API prose, headings and code fences. It is not a new semantic review; changed API meaning requires fresh review.

Separately exercise pre-development design and implementation scenarios: select generation versus agents versus flows versus event resumption; assign context/state and side-effect ownership; choose retrieval versus compaction versus optimization; then implement cross-cutting tasks such as agent + MCP, provider + structured outputs, audio + generation, and event-driven agent/flow resumption using only the master and selected guides. Review architecture synthesis for source grounding, explicit assumptions and unsupported guarantees. Verify narrow tasks do not require unrelated guides and overlapping tasks can load several.

[Coverage audit](skills/ax-skills/assets/coverage-audit.json) uses the existing **schema 6**; [Examples audit](skills/ax-skills/assets/examples-audit.json) uses **schema 4**. Their existing `current` and `historical_baseline` boundaries separate recorded fingerprints, observed procedure outputs and older evidence; format numbers do not imply fresh acceptance. Source identity, semantic/source dispositions, executable runtime results and disclosure findings are distinct evidence. The integration producer's authorized self-check is **not independent review**, and triage labels are not accepted semantic verdicts. Historical 25.4.10 evidence remains at `058f2ae:skills/ax-skills/assets/coverage-audit.json` and `058f2ae:skills/ax-skills/assets/examples-audit.json`; earlier assets remain at `bdebc209`, with pre-example evidence at `d4f113f` and the 25.4.1 audit at `4cd9d844`. Each result applies only to its recorded target hashes and commands.

Aggregate corpus compression is not task-level quality. A smaller complete collection can still omit a critical constraint, make a poor architectural choice or load irrelevant guides. Evaluate semantic completeness, design correctness and actual selected-guide disclosure separately. Report size/token measurements only with the measured snapshot, tokenizer and load composition; no density percentage or historical token count establishes current acceptance. Documentation checks do not certify live provider behavior, generated-language parity or application correctness.

## Current decision-guidance evidence

The integration owner's **2026-11-16 Bun 1.4.4 / Node v24.15.0 self-check** passed all nine final commands: 36 Python regressions, exact 19-member source verification, structural validation, skill validation/discovery, strict TypeScript, CLI discovery, the complete **234-case offline suite in 39 modules**, and changed code-fence compilation. The suite recorded **zero remote model HTTP requests**. Structural validation observed 19 directly linked references, 21 collection Markdown files, 656 links and the 52-line master. A separate corrected targeted run passed all four new cases and the native Box compatibility probe.

The corrected **447-unit source/output review** covers 349 unique original units (retaining all 683 occurrences and 334 duplicates), nine release entries, 46 supplemental sections, 39 changed sections and four new cases. Its 245 escalations have no unresolved actionable finding: 135 were resolved through exact current applicability certificates of prior accepted support, **not fresh manual review**; 110 received direct parent source/hunk/consumer review. All eight capped inputs were escalated. The other 202 units remain model triage, not manual acceptance. Raw labels, fingerprints, certificate basis, dispositions and invalidated-run history are retained in the coverage audit; old votes are not new evidence.

The first full invocation passed the 230 preceding cases before failing in the new module; its failure and corrected targeted results remain separate from the final complete-suite pass. A non-author, source-governed advisory reviewer found no material findings across five decision-contract/discovery/example targets, with access, influence and limitations recorded in the coverage audit. Separate actor/model identity alone does not establish independence; synthetic I/O does not establish live-provider quality. Root acceptance, publication/sync and published-revision smoke remain integration-owner obligations. The user withdrew the mistaken container/tailnet requirement: delivery concerns runnable Bun examples, not deployment.

## Historical 2026-11-15 executable-example acceptance

The integration owner's **2026-11-15 Bun 1.4.4 self-check** observed **230 declared and executed offline cases in 38 modules**, complete offline CLI and strict TypeScript exit 0, with **zero remote model HTTP requests**. The authoritative Bun lock preserves all 91 unique dependency name/version/integrity tuples from the preceding snapshot. Frozen installation, selected module commands, `bunx` execution and the browser build passed; only `better-sqlite3` lifecycle scripts are trusted. Python's 36 regressions, exact 19-member source check, structural validation and skill discovery also passed. Structural output retained 19 directly linked references, 21 collection Markdown files, 620 links and the 52-line master.

For that historical amendment, the [index](skills/ax-skills/examples/INDEX.md#exact-release-and-source-backed-cases) identified release/source-backed cases, while the audits recorded its Bun command, lock, browser and link observations. Its full 25.4.11 source/disclosure model review belonged to `ece5a6c`, not the Bun-edited bytes; it claimed no fresh semantic model votes, live-provider quality or independent review. The exact prior Bun audits remain at `e59a937:skills/ax-skills/assets/coverage-audit.json` and `e59a937:skills/ax-skills/assets/examples-audit.json`; the current 2026-11-16 evidence above is separate.

Offline cases exercise actual SDK algorithms, native SQLite and owned protocol peers, not model quality. Historical Google-profile checks used synthetic fetch; earlier live acceptance covered five scenarios and 16 HTTP requests, not this release. Earlier browser checks observed **unavailable on this device/profile**, not inference. Live speech, microphone, image synthesis, remote MCP/OAuth interoperability, generated-language runtime parity and external business writes remain unqualified.

Historical 25.4.10 review covered 327 source sections and 102 design/disclosure scenarios; three input-limit errors were manually resolved and retained. Its Gemini Decisions, Zod 4, ticket-composition and SSE fault results remain evidence for those recorded bytes only. Neither those votes nor deterministic link-repair certificates certify the amended 25.4.11 collection.

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

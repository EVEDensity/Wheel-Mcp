# Changelog

## Unreleased

- Text-input stage 1: one committed Unicode scalar, independent
  input.text_scalar/v1 capability and exact normal/late result correlation.
  Runtime 0.3.3 still refuses the new capability; native input is a separate
  subsequent stage, not IME, paste, shortcuts or OS keyboard automation.
  Three added fast cases; all previous cases and original budgets remain
  (147 core, 73 safety, 19 engine, 2 package; 241 total).

- Retain hosted gravity acceptance failure 39072866136: safety reached 240s
  before four original files finished/started, with no final summary. Reuse
  only the current live Node process's successful OS identity when creating
  transaction locks, avoiding repeated PowerShell startup per lock. Never cache
  foreign PID reads, stale-lock recovery or stop checks; failed self lookup
  still fails closed. Expand real self-identity isolation assertions, retain
  every original case and the same concurrency / safety / total deadlines.

- Gravity stage 2 adds runtime 0.3.3 / character.gravity2d/v1: explicit bounded
  world-Y integration, fresh flat-floor jump probe, speed clamp and native
  floor/ceiling observations. No idle gravity or permanent controller. Existing
  native/render fixture verifies arcs, stale floor refusal, replay/late results,
  unchanged authored bytes and restored pixels without extra engine startups.
  Keep two development contact-oracle failures; freefall remains exact while
  native contact recovery is checked against authored geometry/safe_margin.
  Required counts: 144 core, 73 safety, 19 engine, 2 package (238 total), with
  all previous cases and original time/concurrency budgets retained.

- Stage 1 gravity/jump host contract: closed optional gravity/impulse fields,
  independent character.gravity2d/v1 capability and exact normal/late response
  correlation. Native runtime 0.3.2 does not advertise the capability and new
  requests fail closed; actual integration is a separate subsequent stage.
  Three new fast cases; all previous cases and time/concurrency budgets remain.

- Stage 2 adds runtime bridge 0.3.2 / character.step2d/v1: bounded native
  step_character_2d with run/write/owner checks, consecutive physics scheduling,
  last-frame contacts, zero held velocity, exact replay and UNKNOWN late-result
  lookup. Actual authored/saved native and local rendered movement tests; no
  automatic controller, gravity, keyboard-consumption or script attachment.
  Rebalance sprite/character native cases into the existing engine phase:
  preserve all tests, 240s safety / 60s engine / 600s total and two workers.
  Required counts are 141 core, 73 safety, 19 engine and 2 package (235 total).
  Retain the first hosted 240s safety timeout; per-case passes were not a gate.

- Stage 1 CharacterBody2D native creation and six bounded character_set fields;
  exact approval, callback/conflict refusal, shape/visual composition, native
  Undo/Redo and actual saved reopen. Editor bridge 0.3.7 announces
  scene.character2d/v1 (27 capabilities); upgrade host/plugin explicitly.
  Runtime movement and arbitrary script attachment are not part of this stage.
  Add two fast cases and one native safety case without removing old tests or
  raising concurrency/deadlines (138 core, 75 safety, 16 engine, 2 package).

- Front-load long transaction/PNG/install files in the unchanged two-worker
  native safety queue. A hosted run reached 240 seconds without a final summary
  after starting transactions at 184s and cleanup at 238s; retain that failure.
  Keep every test and existing timeout; a partial per-file pass is not acceptance.
- Add bounded native Sprite2D creation and sprite_set flags/offset, reusing
  immutable inline PNG/gradient handles with explicit sharing and source CAS.
  Single frame only; reject region/material/external texture dependencies and
  drawing callbacks. Suppress signals during authored texture/property updates
  and native Undo/Redo, recheck live state at commit, and compare actual native
  save/reopen storage and sharing. Bridge 0.3.6 adds scene.sprite2d/v1 (26 entries);
  explicitly upgrade host/plugin together. Keep previous CI tests, limits and
  deadlines; add two schema cases and one native safety case (136 core, 74 safety,
  16 engine, 2 package). Local four-quadrant PNG pixels verify flips, offset and
  centering separately; no hosted GPU or full 2D controller/atlas certification.
- Add bounded native mouse-wheel input on runtime bridge 0.3.1 with explicit
  input.mouse_wheel/v1 capability, viewport coordinates, four directions and
  factor >0..8. Preserve write/run ownership, request replay and legacy key input.
  Inject a native press/release pair; acceptance alone is not GUI consumption.
  Check actual two-axis ScrollContainer behavior, hit testing, hidden controls,
  limits and unchanged scene bytes in hosted headless smoke; separately check
  reversible pixels with a real local renderer. No OS mouse control or touch/IME.
- Document the finite personal-project handoff: no custom secrets, organization
  approvals or self-hosted runners; read-only build and automatic GitHub token
  write permission only in the gated publisher. Lock this policy in CI tests,
  retain every previous case/deadline/worker limit and defer broad engine/platform
  expansion without converting unrun work to PASS (134 core, 73 safety, 16 engine,
  2 package checks). This integrates main; public v0.2.8 assets are unchanged.
- Normalize native scan progress at the plugin boundary: a real post-PNG rescan
  returned 1.85 and broke the unchanged strict editor-state protocol. Clamp only
  the display indicator to 0..1; completion still checks real scanning/importing
  flags and resource readiness, not the progress number.
- Add bounded PNG source snapshots as the sixteenth native resource type,
  ImageTexture: SHA-256-bound project PNG, at most 16 KiB and 32×32, non-interlaced
  8-bit RGB/RGBA with only IHDR/IDAT/IEND. Independently compare host/native pixels,
  bind source hashes through exact approval and final native commit, then embed
  independent RGBA8 pixels. No importer cache, live PNG dependency or arbitrary
  image/metadata/SVG loading. Source-backed handles cannot export directly; approve
  scene assignment first, then reference the independent inline snapshot. Textures
  remain immutable; native Undo/Redo, resource export and actual scene save/reopen
  must retain every pixel. Bridge 0.3.5 adds scene.png_texture/v1 (25 capabilities).
  Preserve every old CI test, deadline and worker limit; add four core checks and
  one native safety case (130 core, 73 safety, 15 engine, 2 package). Local rendered
  PNG import/snapshot/flip checks are separate from hosted headless qualification.
- Add bounded TextureRect authoring: expand modes 0..1, stretch modes 0..6 and
  flips, with exact native Undo/Redo and save/reopen checks. Add a fifteenth
  resource type, GradientTexture2D, limited to 1..32 dimensions and a closed,
  script-free two-stop linear sRGB gradient. No arbitrary image paths or imports.
  Texture handles are immutable; replace them through an approved assignment.
  External exports require an explicit unique inline copy, never an unguarded
  external scene dependency. Reject opaque metadata and stale live resources.
  Bridge 0.3.4 adds scene.texture/v1 with a 24-entry capability budget; upgrade
  host/plugin together. Keep all old CI cases, concurrency and deadlines, adding
  two schema checks and one native case (126 core, 72 safety, 15 engine, 2 package).
  A separate local rendered PNG flip/restore check is not headless CI certification.
- Add bounded native plain-text RichTextLabel creation, multiline text up to
  512 characters, autowrap, fit_content and scroll_active. Keep BBCode, threaded
  parsing, effects, selection/menu, links and manual format stacks outside scope.
  Reject unsafe live settings and callbacks again at commit; protect the native
  scrollbar/timer and retain native Undo/Redo and actual save/reopen verification.
  Check literal tag text and native runtime reflow, not a synthetic line estimate.
  Bridge 0.3.3 adds scene.rich_text/v1 with a 23-entry capability budget; explicitly
  upgrade host and plugin together. No public v0.2.8 asset is replaced. Add the
  new schema/native cases to existing CI gates without removing tests or extending
  deadlines (124 core, 71 safety, 15 engine, 2 package).
- Run hosted test fixtures under GitHub's runner-owned temporary directory,
  not the Windows user-profile temp path. Keep package consumers outside the
  checkout so missing production imports cannot fall back to source node_modules.
  Keep all installation/acceptance deadlines and fail-closed checks unchanged.
- Preserve the explicit isolated test-file queue with Node's public run API
  instead of the CLI's alphabetical ordering. Start expensive native validation
  files first while retaining every file, two workers and all deadlines. Keep
  compact live per-file progress for timeout diagnosis. A passed case with a
  still-live worker remains a failure at the suite deadline; never force exit.
- Add bounded native ScrollContainer creation, scroll modes 0..4 and follow_focus.
  Protect engine-internal nodes from authoring paths; exclude layout-dependent
  scroll positions from authored CAS/readback. Reject user scroll callbacks,
  including connections attached during approval. Verify native Undo/Redo,
  actual save/reopen and real Tab-triggered focus following with a disabled
  control group. Bridge 0.3.2 adds scene.scroll/v1 with a 22-entry capability
  budget; host/plugin must upgrade together. No new Release or IME/wheel/touch
  qualification is implied.
- Preserve the configured Godot executable in the actual package-install gate;
  use the explicit Node executable test double only in engine-free CI. Keep
  bounded phase/elapsed-only package diagnostics when an outer timeout prevents
  a final test report. The locked consumer install uses the cache primed by the
  required source npm ci and fails on a cache miss instead of fetching again;
  lifecycle handling stays enabled. Cold-cache network installation remains
  outside this packaging test. Installation and suite deadlines remain unchanged.
- Add bounded native LineEdit authoring: text, placeholder, editable and 0..512
  max_length; reject implicit truncation/control characters and existing text
  callbacks. Pair text/limit during native undo/redo and preserve signal blocking
  while preventing callbacks during authoring. Validate actual save/reopen and
  focused GUI Backspace/read-only behavior over stdio with Godot 4.7.2.
  Editor bridge 0.3.1 adds scene.line_edit/v1; upgrade host and plugin together.
  Keep the 21-entry capability bound and original frame/file limits.
- Run the configured MCP launcher in the client-owned Node process rather than
  a hidden child. Reuse stdio draining/cleanup and verify real Godot orphan
  recovery after abnormal server death. Startup no longer invokes setup/build:
  missing or incompatible runtimes fail with stderr-only reinstall/rebuild guidance.
  Hide Windows executable discovery/version probes. Cover the actual installed
  package launcher and move the installed Codex probe onto the configured entry.
- Prevent automatic retry advice for side-effecting MCP requests after timeout,
  cancellation or unknown outcome, including writes routed through the runtime
  dispatcher. Keep read-only timeout behavior and preserve inspection advice on
  bounded failure pages. Add concurrent-policy and late-approval regression tests.
  This change is on main only; existing v0.2.8 assets are not replaced.
- Promote installation examples to verified v0.2.8 after automatic publication
  and public-download verification. Preserve unaccepted candidate history.
- Record two independent 193-test hosted passes on commit 9675e7d, with matching
  source/package hashes, clean audit and successful scratch cleanup. This
  documentation update does not requalify changed code or expand release scope.

## 0.2.8

- Add a default manual acceptance-only mode on main. It runs the complete gate
  and prepares artifacts without requiring or creating a tag; the publication
  job is explicitly disabled. Tag publication still requires an existing exact
  stable tag, matching accepted commit and successful independent checks.
- Launch the hosted gate directly with Node and isolate consumer npm commands
  from parent project lifecycle metadata. Preserve registry/cache/proxy settings,
  normal package scripts and all original deadlines. The prior timeout's exact
  cause remains unproven until controlled hosted acceptance completes.
- Prefer an installed absolute PowerShell 7 host for Windows process identity
  and guarded stop operations, with the system Windows PowerShell fallback.
  Keep process-generation/handle checks and the five-second read deadline.
- Pin CI actions to immutable revisions, use the Node 24 artifact uploader,
  distinguish artifact names by attempt and bind downloads to the producing
  build's artifact name. Include bounded failure details with actionable npm
  errors rather than repetitive cache-hit lines.
- Retain the exact-ID publisher and full 71-tool catalog from the unaccepted
  0.2.6/0.2.7 candidates. No skipped checks or production promotion is implied.

## 0.2.7

**Source candidate not published.** Both hosted attempts failed acceptance.

- Include the exact-ID publication flow, source/asset verification, current
  71-tool catalog and version-bound notes from the unpublished v0.2.6 candidate.
- Add an opt-in, engine-free archive installation check to manual CI dispatch.
  Keep it disabled on normal pushes and PRs, so packaging failures can be
  diagnosed without repeating native engine acceptance.
- Include bounded npm verbose diagnostics on package installation failure;
  retain the 30-second command bound and normal consumer lifecycle checks.
- Run archive installation before native safety/runtime acceptance for earlier
  failure feedback, without dropping tests or extending deadlines. The isolated
  hosted archive check passed after two full-gate timeouts; this ordering change
  does not establish the exact cause of those prior installation timeouts.
- v0.2.6 passed core, native safety and runtime checks in both hosted attempts,
  but its actual archive installation exceeded the unchanged command bound.
  It was not published; keep its tag and failed attempts as evidence.
- v0.2.7's first hosted attempt failed four bounded Windows process-identity
  checks. Its second passed core but timed out during archive installation,
  despite installation preceding native safety. The ordering change did not
  resolve the installation issue. No Release was published and no further
  unchanged-candidate reruns were made.

## 0.2.6 source candidate not published

- Bind automated publication to the numeric release ID returned by creation,
  not a fresh draft lookup through the release list. Verify the accepted receipt,
  remote tag, draft identity and every uploaded asset before publishing that ID.
  Use fixed HTTPS hosts, bounded requests and no mutation retries or overwrites.
- Exercise the actual workflow publisher with synthetic files/HTTP, including
  source/tag mismatches, existing releases, ambiguous network failures and
  incorrect asset states, sizes and hashes. This is not a hosted release result.
- Align the tool catalog with all 71 registered tools and check that alignment
  through SDK discovery. Document the implemented subsets and remaining work.
- Generate release notes from the exact version's changelog, rather than
  carrying stale hard-coded descriptions of previous releases into new versions.

## 0.2.5

- Reject foreign HTTP probes, malformed JSON/UTF-8 and invalid Unicode escapes
  at the editor bridge without producing false engine errors. Stop processing
  a connection after its first invalid frame; retain authentication, independent
  write approval, frame limits and strict checks for real engine errors.
- Add native regression coverage for 22 malformed-input cases, fragmented
  Unicode, continued authenticated reads and unchanged scene bytes/dirty state.
  Include it in the bounded release safety suite.
- Retry transient Windows cleanup locks only within the verified CI scratch
  root. Persistent cleanup failures still fail acceptance and retain diagnostics.
- Run the competing-editor lease test using its isolated engine/profile rather
  than the installed engine's global settings. Clarify bounded authoring support
  and remaining gaps in the English and Chinese READMEs.
- Keep the prior expanded-regression timeout and npm audit connection-reset
  receipts as failures. Fresh version-bound acceptance is required for release;
  no full authoring, long-session or production qualification is implied.

## 0.2.4

- Install the actual archive with the locked dependency graph, normal lifecycles
  and cache-preferred bounded registry access. Do not require prewarmed offline
  package metadata on a fresh hosted runner. Keep the 30-second command bound,
  zero retries and ten-second registry timeout, and include command diagnostics.
- The [v0.2.3 hosted run](https://github.com/EVEDensity/Wheel-Mcp/actions/runs/38877365342)
  passed core, native safety and engine checks, then exceeded the offline package
  installation bound. The same source passed all 189 tests locally. Neither
  result overrides the other; that candidate was not published.

## 0.2.3 source candidate not published

- Pass only the selected Godot executable, test registry and scratch paths to
  stdio fixtures. Hosted tests no longer depend on an untracked local `.env`;
  arbitrary host credentials and preapproved grants are not inherited.
- Keep the original tool/assertion failure in stdio cleanup diagnostics.
- The [v0.2.2 hosted run](https://github.com/EVEDensity/Wheel-Mcp/actions/runs/38876107479)
  passed 67/67 safety checks, then stopped at the stdio launch test because the
  isolated child lacked an approved engine path. No Release was published.

## 0.2.2 source candidate not published

- Bound retries for transient Windows locks when removing an owned validation
  stage. A persistent cleanup failure still prevents source writes and records
  the underlying code/cause in failure evidence. Native lock and junction tests
  cover successful cleanup and fail-closed retention.
- The v0.2.1 GitHub build stopped at native validation-stage cleanup (63/64 safety
  checks); it was not published. Keep the [failed run](https://github.com/EVEDensity/Wheel-Mcp/actions/runs/38873015917)
  and tag as historical evidence.

## 0.2.1 source candidate not published

- Add an on-demand GitHub release workflow with bounded Windows acceptance,
  actual package installation, SBOM, checksums and a source-bound receipt.
  Upload to a draft, verify remote asset hashes, then publish without overwriting
  existing releases. Daily CI remains short; no npm publication or soak job.
- Preserve JSON client environment, roots/scopes and client-owned settings on
  forced setup. Back up changed configurations and reject malformed structures.
  Update only `GODOT_PATH` in `.env`, preserving unrelated settings and comments.
- Pin official Godot CI archives by SHA-256 and bound download duration, size
  and redirects to exact HTTPS release hosts before extraction/execution.

- Screenshot-only runs start off-screen, then minimize an unfocusable real-render
  window; `dev_loop` uses the same background policy. Persistent MCP rendering
  defaults to background mode unless a visible preview is explicitly requested
  with `headless:false, background:false`. Headless logic defaults are unchanged.
- One-shot screenshots now explicitly draw a frame before capture. Native tests
  verify actual pixels, changed session state, window flags and process reuse.
  This does not suppress OS/driver dialogs or certify every startup focus path.
- Restart the MCP server after updating. The v0.2.0 tag/assets are unchanged.

## 0.2.0 Windows local release

- Fix cold Windows process identity probes with module-free .NET process APIs;
  preserve process-generation/executable binding and pinned-handle termination.
  Include native identity checks in short CI. Unexpected pre-approval failures
  now report their real tool error rather than appearing as client rejection.

- Revision 2 splits build/style/lint from the core runner, fixes conflicting
  parent/child budgets and requires current-run receipts with minimum coverage.
  The ten-minute operator budget does not change product request deadlines or
  safety requirements. Historical failures remain attached to their old source.
- Restore bounded Windows push/PR CI when the repository is made public;
  native smoke stays manual and npm publication is not automatic.

### Historical source synchronization

- The final pre-push gate exceeded its execution budget without a complete
  passing result. Source synchronization is authorized; this is not an accepted
  stable Release. Historical passing checkpoints remain bound to their source.
- Preserve byte-hashed historical evidence, the frozen benchmark corpus and
  WebP files under Git. Make source identity independent of staging and text EOL.
- Keep actual form observation, TIMEOUT mapping and unchanged bytes in the
  approval-timeout test; its request budget includes Windows preflight I/O.

- Limit stable acceptance to Windows, Godot 4.7.2, trusted local projects and
  stdio. Defer long soak, large stress/matrices, independent-machine and other
  client certification at the maintainer's request; retain failures and safety
  controls. This is not full production or public-network qualification.
- Add a source-bound release gate with native safety, crash recovery,
  headless runtime, actual packaged installation, dependency audit and SBOM.
  Failures/skips/unfinished cleanup cannot qualify the local release.
- Separate `release:gate:full` and `release:check:production` from the local
  stable gate. No gate publishes, tags, pushes or enables GitHub workflows.

- Build before packing instead of compiling during consumer installation. No
  install lifecycle writes client configuration; setup remains an explicit step.
- Explicit runtime package allowlist excludes site media, vendor bundles, tests,
  local evidence and source-only workflows. Declare Zod as a direct dependency.
- Upgrade SDK/TOML and pin compatible patched URI/IP/proxy dependencies in
  both the runtime dependency set and lockfile; refresh development brace expansion.
- Keep the current task state and local Windows/client limits visible in both
  READMEs. Stable/public-network qualification remains NOT_QUALIFIED.
- GitHub CI/CD is paused. Only a bounded manual Windows workflow remains locally;
  heavy engine/release workflows are removed without waiving release criteria.
- Third-party distribution boundaries are documented separately from root MIT.
- Structured test reports require a cumulative summary, not a successful
  per-file summary from a truncated run, and reject summaries hiding failures.
- Full current-source/stable qualification is still incomplete. A native ledger
  failure under mixed full-suite load is retained even though an isolated rerun passed.

## 0.1.0-preview.2 - September 14, 2026

Onboarding and open-source milestone. Local Windows release gate verified:
**90/90 tests (0 skipped)**, **19/19 matrix PASS**, `release:check` PASS, audit
clean. GitHub Actions workflows are present but may not run when the hosting
account has no Actions minutes.

### Added

- One-click onboarding: `npm.cmd run go` / `node scripts/install.mjs` with Godot
  auto-discovery and MCP config generation for Cursor, VS Code and Claude Code.
- `npm run test:godot-ci` — README smoke + E2E subset; fails on any skip.
- `npm run release:gate` — local clean-machine gate (build → test → matrix →
  release:check → audit/sbom).
- Cross-platform Godot CI installer (`scripts/ci-install-godot.mjs`) and workflows
  `godot-smoke.yml` / `release-gate.yml`.
- Project logo at `assets/logo.png`; portable MCP examples under `examples/mcp/`.

### Changed

- Rename package from `godot-game-harness-mcp` to **`wheel-mcp`**; update MCP
  keys, CLI bins and schema `$id` domains.
- Tests and benchmark summaries default to the bundled
  `tests/fixtures/runtime-behavior` project instead of author-machine paths.
- Gitignore generated MCP configs, Godot `.uid` files and local evidence outputs.

### Fixed

- Windows `install.mjs` npm spawn via `cmd.exe /c npm install`.

Includes prior preview work: client repair protocol, strict shutdown, bilingual
README/tool catalog, HTTP security hardening and documentation validation.

## 0.1.0-preview.1

- Initial numbered preview release line.

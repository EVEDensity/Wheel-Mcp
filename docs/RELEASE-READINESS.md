# Release readiness (Windows)

## Local stable release revision 2

Current acceptance is recorded in the [final receipt](releases/0.2.0-windows-local-final.json).
It requires separate build/style/lint budgets, all core/native/runtime/package
suites with zero skips and owned cleanup, fresh audit, SBOM and artifact
integrity. Suite receipts must match the current run and meet minimum coverage.
The operator budget is ten minutes; no product safety threshold is relaxed.
The maintainer authorized public distribution and bounded push/PR CI after
acceptance. Full production and remote deployment remain `NOT_QUALIFIED`.
Earlier failed synchronization and successful checkpoint sections are historical.

An initial revision 2 local pass was followed by independent GitHub Windows CI
failures: process identity probes could time out during PowerShell module cold
startup, before the approval form. Identity queries/stops now use module-free
.NET process APIs, retaining generation/executable checks and a pinned kill
handle. Native process-identity tests are mandatory in the fast suite. The
initial receipt and failed CI runs remain historical; final acceptance requires
fresh local and GitHub CI checks of this fix.

## Historical source synchronization on October 15 2026

**The current commit is not accepted for stable release.** The final gate timed
out in the core phase after 120 seconds; build, format and lint completed, but
the parent did not receive a complete passing test result. An earlier attempt
also exceeded its 180-second native-safety phase budget without a cumulative
summary. These are incomplete runs, not PASS. Failure diagnostics remain local.

The maintainer explicitly authorized pushing source with this limitation and
without creating a stable Release. The prepared package version remains `0.2.0`;
that version string is not an acceptance result. Full production remains
`NOT_QUALIFIED`, and GitHub CI/CD stays disabled. See the
[current source status](releases/0.2.0-source-push.json). The earlier successful
checkpoint below and its receipt remain historical, tied to the original source.

Pre-push repairs also make the source fingerprint independent of Git staging and
LF/CRLF text checkout, preserve exact evidence/corpus/WebP bytes under Git, and
allow the approval-timeout test enough request budget to reach the actual form.
The required form observation, TIMEOUT result and unchanged-file assertions remain.

## Limited local release on October 15 2026

The maintainer removed long-running acceptance from the current release scope.
The `0.2.0` candidate uses the separate [Windows local stable profile](LOCAL-STABLE-RELEASE.md).
`release:gate` now runs only short required safety, runtime, installation and
dependency checks, with a six-minute total bound. `release:check` validates its
current-source receipt and artifact/SBOM hashes. A failed gate still blocks
release; merely removing a long test does not repair its failure.

Full production remains `NOT_QUALIFIED`; deferred T31–T35/G4–G6, original
mixed-load timeout and independent-machine limitations remain recorded.
The full checker is `release:check:production`, and its long execution route is
`release:gate:full`. GitHub CI/CD remains disabled. No push or publication occurs
from either gate. October 14 records below describe the earlier release scope.

The local gate completed **PASS in 195,910 ms** on Windows, Node **24.18.0**
and Godot **4.7.2.stable.official.ed1daf0bf**. Core **89/89**, native safety
**60/60**, headless runtime **14/14** and packaged installation **2/2** all
finished with zero failures/skips/cancellations/todos and owned scratch cleanup
PASS. Fresh dependency audit reported **0 known vulnerabilities**. The separate
`release:check` returned PASS against current source, documents and artifact/SBOM
hashes. The runtime tarball contains **109 files**, **238,116 compressed bytes**
and **992,949 unpacked bytes**. These numbers apply only to the local profile.
See the [compact release receipt](releases/0.2.0-windows-local.json).

## Release preparation on October 14 2026

**Stable release and GitHub push are on hold.** The maintainer explicitly chose
to wait for stable gates before pushing. The version stays `0.1.0-preview.2`,
qualification stays **NOT_QUALIFIED**, and GitHub CI/CD stays disabled.

The initial package blockers below have been repaired:

- No consumer install lifecycle. `prepack` builds the runtime; explicit setup
  reuses packaged JavaScript when no development compiler is installed.
- An explicit runtime allowlist produces **109 files**, **238,045 compressed
  bytes** and **992,679 unpacked bytes**. Website, video, vendor, tests and local
  evidence files are excluded. The initial 12 MB package is historical.
- A real tarball with a dependency graph pinned from the source lockfile passed
  both distribution tests: normal lifecycle handling, production dependencies
  only, no TypeScript, no generated host configuration, prebuilt setup, MCP
  discovery/project read and resolution of every emitted relative module import.
  This is a controlled local installation, not a cold-network/independent-machine
  qualification. The first offline attempt lacked cached metadata; failure was
  not counted as a pass or used to change lifecycle assertions.
- SDK/TOML and the URI/IP/proxy/brace dependencies were updated. The four manually
  refreshed lock entries were taken from exact official registry metadata;
  archives were downloaded from that registry, SHA-512 checked, cached and then
  installed with `npm ci --offline --ignore-scripts`. A fresh full `npm audit`
  succeeded with **0 known vulnerabilities**. Intermediate registry connection
  failures are not clean audit results.
- Build, format and lint passed; the core suite passed **85/85**, zero skipped.
  Two new report checks reject a partial per-file summary or a summary hiding a
  failure. This does not retroactively alter the older full-suite failure.

The complete local regression did **not** pass: its 15-minute operator bound
ended before a cumulative summary. The original stream has **182 pass events and
1 fail event**, not an overall test count or a complete passing suite. The failed
native 4,096-record ledger probe reached 3,584 records before its unchanged
80-second child cutoff. The initial failure summary incorrectly displayed the
last four-case file summary; the parser now requires a cumulative summary.
The original diagnostics remain at
`runs/ci/release-prep-full-20261014/` (ignored).

An isolated ledger rerun passed **2/2**, zero skipped, with the original
80-second child cutoff and 4,096 identities/1,000 editor writes unchanged.
It verifies replay/corruption/ownership/storage controls but does not erase the
mixed-load failure or complete T31's separate mixed 1,000-cycle acceptance.
No ledger safety/capacity controls or acceptance deadlines were weakened.

For the incomplete full run, **160 byte-identical engine copies** were removed
after checking original SHA-256, containment, every parent for reparse points
and the absence of active fixture Godot processes: **14,484,563,200 bytes** freed.
Original engines, scenes, journals and key failure evidence remain. This is not
complete scratch cleanup, and the older policy-denied roots were not retried.

The maintainer subsequently confirmed that the website materials were authored
or cleared by the maintainer and authorized their public distribution. This is
recorded as a maintainer declaration, not independently retrieved upstream terms.
Original ThreeUI provenance and Godot licensing remain; the runtime package
still excludes the website. See [third-party notices](../THIRD-PARTY-NOTICES.md).

Remaining stable requirements include current-source full regression and gates,
T31's mixed workload/fault acceptance, T32 installation/upgrade/rollback/uninstall,
T33's independent Windows environment, T34 documentation/migration and T35 final
qualification. An isolated folder on this machine is not an independent Windows
machine. No task or gate has been marked complete by these packaging fixes.

## Initial audit before the October 14 repairs

**Do not publish the current npm artifact or call this a stable/online release.**
Publishing source as an explicitly limited local Windows Preview is a separate
decision from production qualification; it does not require silently completing
every roadmap item, but requires resolving redistribution rights, documenting
known defects and making the intended distribution/install route reproducible.

Fresh local checks on Node **24.18.0**: build, format and lint PASS; core suite
**83/83**, headless Godot smoke **14/14**, targeted installation-fixture/HTTP
security/transaction/crash-recovery suite **44/44**, all zero skipped and with
owned scratch cleanup PASS. These are not a full frozen-source regression,
independent Windows-machine test, human approval UX test or stable qualification.
`verify:roadmap` passed; `release:check` failed with **NOT_QUALIFIED**, incomplete
T31–T35/G4–G6 and non-current-source historical evidence/matrices.

The actual packed artifact contained **689 files**, **12,231,759 compressed
bytes**, **16,555,294 unpacked bytes**: 79 `build/src` files, 154 website/docs
files, 252 source/compiled test files and 21 vendor files. No local `.env`, host
configuration, `runs/` or `.harness/` paths appeared in that inventory. The video
alone is 9,707,748 bytes. There is no explicit `files` allowlist.

An isolated extraction of the real tarball plus the current lockfile successfully
installed 98 production dependency packages offline. Invoking its exact
`postinstall` lifecycle failed (exit 1): `scripts/setup.mjs` always runs
`node_modules/typescript/bin/tsc`, while TypeScript is a development dependency
and absent from production-only installation. The missing local compiler was
independently confirmed as `MODULE_NOT_FOUND`. With lifecycle scripts skipped,
the prebuilt stdio MCP initialized, discovered **71 tools** and read an isolated
project. The earlier online fresh-cache install timed out; it is not PASS, nor is
this offline reproduction an independent clean-machine npm installation. CLI
`--help` is unsupported and its exit 1 is not evidence of missing runtime modules.

Fresh `npm audit --omit=dev --json` reported **5 vulnerable dependency packages:
1 critical, 1 high, 3 moderate**. Full dependency audit additionally flags the
development-only `brace-expansion` (6 packages total). Do not equate advisory
severity with a demonstrated exploitable project endpoint: the SDK's
[OAuth advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h)
explicitly excludes SDK servers/stdio clients, and the
[proxy trust advisory](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h)
depends on proxy-trust configuration. The product uses Node HTTP rather than
an Express proxy-trust endpoint; no affected OAuth client setup was found in
`src/` or `scripts/`. The locked vulnerable dependencies and failing dependency
gate still need remediation/re-audit before package release, not an invented
claim of a current account compromise. No `npm audit fix` was run.

Redistribution permission is **NOT_VERIFIED** for copied ThreeUI source
(`vendor/threeui-predictive-arc/`, `docs/site/threeui/`, Sylva navigation excerpts)
and the supplied website video/brand assets. Root MIT and source hashes do not
establish third-party permission. The official ThreeUI terms page was checked,
but its terms body could not be retrieved by the text browser; no finding of
infringement is asserted. Preserve the Godot demo slice's existing MIT notice.
Resolve rights for historical copies too before making the existing repository
public; removing a current file does not remove it from Git history.

A bounded, high-confidence credential-pattern scan found no matches in 480
publishable worktree text files and 1,245 reachable historical text blobs from
2,647 local Git objects. This is not an exhaustive secret scanner: binary data,
one blob above 4 MiB, arbitrary unprefixed tokens and un-fetched remote history
are not covered. Twenty-four current text files contain local absolute paths;
review intended-public evidence and examples for privacy before disclosure.

The requested independent **Bugbot review is NOT_RUN**: this tool environment
does not expose the required specialized Bugbot subagent. A generic agent was
not substituted. These findings are the local audit, not Bugbot certification.

GitHub CI/CD was paused remotely: `ci`, `godot-smoke`, `release-gate` all
`disabled_manually`, with no in-progress/queued runs. Local `ci.yml` is
manual-dispatch-only. No commit, push, release, public visibility change or
client configuration mutation was performed. Compact local diagnostic evidence
lives in ignored `runs/release-audit-2026-10-14/`; a durable report is also saved
outside the source tree. Core release findings were not silently fixed by this
audit. The resume procedure appears below.

## Current roadmap qualification: NOT_QUALIFIED

The current integrated source is **not production-qualified**. T00–T30 have
historical acceptance within their declared subsets. T31–T35 and G4–G6 remain
incomplete, and every final gate must bind the actual candidate source before
promotion. Final G2 passed on September 26 with 267 full tests, 74 required native checks
and 20 consecutive native authoring/save/reopen/render cycles. The exact source
and mixed real-engine/mock-approval provenance are recorded in
[G2 evidence](production-roadmap/evidence/G2-final-gate.json). Earlier G0/G1
gate results are historical evidence, not acceptance of a changed source tree.
`release:check` now verifies roadmap evidence,
all tasks/gates, the candidate source fingerprint and matrix fingerprints. A
successful baseline or old 19-case matrix alone cannot pass this release check.
The September 14 records below remain historical; they do not override this decision.

## Current decision: September 14, 2026

Package version is **`0.1.0-preview.2`**. The historical release-gate label
**Windows-only stable production candidate** means suitable for supervised,
trusted-project local development; it does **not** promote the package to a
stable numbered release or certify arbitrary autonomous repair.

The validated runtime is **Godot 4.7.2 on Windows**. The local run used Node
`24.19.0`. Linux/macOS full release-gate results remain NOT_RUN; the
`godot-smoke` workflow exercises README smoke + E2E subset on Windows, macOS
and Linux when green. No enterprise
certification, signature or external sign-off is required for this personal
project. Remote TLS/secrets/audit setup depends on your actual deployment;
[the practical guide](PRODUCTION-DEPLOYMENT.md) is not evidence that a public
endpoint has been deployed or tested.

## Version bump criteria

### Preview.2 local gate (September 14, 2026)

- [x] Full local `npm test`: **90/90 pass, 0 skipped** with `GODOT_PATH` set.
- [x] `npm run test:godot-ci`: **6/6 pass, 0 skipped**.
- [x] `npm run matrix:generate`: **19/19 PASS** on bundled fixture.
- [x] `npm run release:check`: PASS.
- [x] `npm run audit:dependencies`: 0 high vulnerabilities.
- [x] CHANGELOG / README / CONTRIBUTING aligned with Wheel-mcp rename and install flow.
- [ ] GitHub Actions `release-gate` / `godot-smoke` green on hosted runners (blocked
      when the repository account has no Actions billing/minutes).

Run the same gate locally with:

```powershell
$env:GODOT_PATH = 'D:\tools\Godot_v4.7.2-stable_win64_console.exe'
$env:REAL_GODOT_PROJECT = 'tests/fixtures/runtime-behavior'
npm run release:gate
```

Preview.2 is a documentation + onboarding milestone, not a stable promotion.

### Promote toward stable (`0.2.0` or first non-preview semver) only when

- [ ] Clean-machine onboarding verified end-to-end: clone → `npm.cmd run go` →
      MCP configs written → README smoke passes locally.
- [ ] `release-gate` artifacts show **19/19** matrix PASS and `release:check`
      PASS generated in CI (not copied from a developer machine).
- [ ] Full test suite **0 skipped** on Windows with Godot 4.7.2 and the bundled
      `tests/fixtures/runtime-behavior` project.
- [ ] Dependency audit and SBOM generated in the same release-gate run.
- [ ] A real client-side model adapter plus explicit review UI is connected and
      measured on a newly curated patch set (not recorded upstream candidates).
- [ ] Longer gameplay scenarios (multi-scene ownership, combat, UI, navigation,
      save/load) have dev-loop/scenario assertions beyond startup smoke.

Until these stable criteria are met, keep the preview version line and treat CI
green on Node-only matrix jobs as necessary but **insufficient** evidence.

## CI coverage

Current policy (October 14, 2026): GitHub execution is paused. Remote workflows
are manually disabled; only `ci.yml` remains locally, on Windows/Node 22, with
`workflow_dispatch` as its sole trigger. The retained checks, when explicitly
re-enabled and manually dispatched, are:

- One `npm run check` builds once, checks format/lint,
  core MCP stdio/HTTP, write approval/rollback, path isolation and site
  assets/links. The test runner has a 90-second deadline; the job has a 10-minute
  deadline and cancels obsolete runs.
- Audit dependencies when manifests/lockfiles change, when the base diff is
  unavailable, or during manual dispatch. Plain code changes do not repeat the
  network audit. This policy does not promise continuous vulnerability monitoring.
- Manual dispatch with `engine=true`: add five small headless native test files,
  bounded to three minutes; no editor/renderer matrix or soak. Missing engines,
  skipped tests or failed process cleanup fail the smoke rather than qualify it.
- Upload only bounded CI failure diagnostics, retained seven days; do not upload
  all `.harness`, private client configuration, engine copies or historical runs.

`godot-smoke.yml` and `release-gate.yml` are removed. Historical results and
qualification criteria are retained; a green quick CI is not full engine,
independent-platform or release qualification.

Deep transaction journals, process-crash recovery, all editor/render cases and
long workloads stay in explicit full/manual acceptance. They are not silently
counted as passed by the fast test allowlist.

## Explicit local release preparation

[`scripts/release-gate-local.mjs`](../scripts/release-gate-local.mjs) is manual.
Use `npm run release:gate -- --plan` to inspect the steps without an engine or
side effects. Execution requires Godot and still enforces current-source
qualification:

1. Validate roadmap state.
2. Run one complete production baseline, which owns build/style/lint, the full
   test suite (including isolated installation fixtures) and its native recheck.
3. Generate the actual release matrix.
4. Run the unchanged strict release qualification check.
5. Audit dependencies and generate SBOM.

No additional `npm test`, large Godot subset or workspace/client setup is run
after the baseline. Removing duplicate execution does not waive any release
criteria or make this local run an independent clean Windows machine.
`runs/` remains gitignored; do not commit generated matrix JSON.

## Documentation follow-up

The [onboarding validation](../benchmarks/documentation-validation-2026-09-13.json)
adds one real MCP README regression: **83/83 tests, 0 skipped**, and a regenerated
**19/19** matrix with release-check PASS. It fixes an invalid NavigationPolygon
index-array value in the bundled fixture discovered by strict first-run checks.
The 82-test figures below describe the earlier implementation snapshot, not the
new total; that evidence is retained unchanged.

## Local verification (original implementation snapshot)

- TypeScript build, Prettier check and ESLint passed using installed CLI entry points.
- Full test suite: **82/82 PASS, 0 skipped**, with GODOT_PATH set. Includes official
  SDK HTTP E2E, real runtime behavior, client candidate verification/rollback,
  strict audio cleanup, deliberate exit faults/orphans, and forced-stop behavior.
- Real matrix regenerated: **19/19 PASS**. Includes stop_project,
  cancel_project-repeat, Scenario and rendered screenshot evidence.
- The matrix now defaults to the checked-in `tests/fixtures/runtime-behavior`
  project, not an absolute path into a developer's separate game checkout.
  GODOT_PATH is required; missing runtime produces BLOCKED evidence, not fake PASS.
- Separate frozen historical evaluation: 3/3 defects reproduced and fixed via
  client-approved **recorded upstream candidates**, with 3/3 ineffective
  controls rejected and source restored. This is not a live-model benchmark.
- Strict shutdown paired result: 4/7 -> 6/7 bridge-only; a separate RPG ownership
  candidate reduces 22 errors to 0 and passes independent strict verification.

The local task invoked Node and installed build/test/lint/script entry points
directly because npm was not on its PATH. Do not read these statements as an
npm installation, clean-machine packaging test or fresh dependency audit.

The final `release:check` entry point returned **PASS**. See the
[validation summary](../benchmarks/validation-results-2026-09-13.json) for the
recorded gate results and hashes; these are local observations, not certification.

## Reproduce the gate locally

On your Windows desktop with a working renderer:

```powershell
npm.cmd run go
npm run format:check
npm run lint
$env:GODOT_PATH = 'D:\tools\Godot_v4.7.2-stable_win64_console.exe'
$env:REAL_GODOT_PROJECT = 'tests/fixtures/runtime-behavior'
npm test
npm run test:godot-ci
npm run matrix:generate
npm run release:check
npm run audit:dependencies
npm run sbom > sbom.json
```

`npm.cmd run go` and `node scripts/install.mjs` are the verified onboarding
entry points on Windows PowerShell. Use `npm.cmd` instead of `npm` when
PowerShell blocks `npm.ps1`. After dependencies are installed, CI and
contributors may rerun `node scripts/install.mjs --skip-npm` to refresh MCP
configs only.

The default matrix fixture is included in Git and captures a real **320 x 180**
framebuffer. `REAL_GODOT_PROJECT` optionally selects another imported project
whose main scene stays running and supports the tested root property/input
operations. The matrix is a lifecycle/protocol smoke check, not a full-game
oracle. Use dev-loop/scenario-specific assertions for gameplay correctness.

`release:check` checks package metadata, documentation and matrix evidence. It
does not run tests, lint, audit or matrix generation. The commands must run in
the stated order; a successful checker is not a substitute for the other gates.
If a prerequisite is missing, preserve the failure rather than substituting
recorded PASS JSON.

## Evidence and upload policy

Keep under version control: source, fixtures, tests, scripts, schemas, small
benchmark manifests/summaries, docs, package files, CI and license.

Do not automatically upload: node_modules, build, dist, .harness, runs, tokens,
logs, edit backups or source-bearing candidate packets. `runs/` is deliberately
ignored. A fresh GitHub reader can reproduce the evaluations but cannot access
this machine's local artifacts through a path printed in a summary. Share a
sanitized, licensed evidence bundle separately if exact-run review is desired.

See [historical methodology and local paths](HISTORICAL-DEFECTS.md),
[client protocol](CLIENT-REPAIR.md) and [README](../README.md).

## Practical remaining work

1. Re-run `npm run release:gate` after material changes; restore GitHub Actions
   minutes before relying on hosted `release-gate` / `godot-smoke` workflows.
2. Connect a real client-side model adapter plus explicit review UI. Measure it
   on a newly curated, undisclosed patch set, not recorded upstream candidates.
3. Add longer multi-scene ownership, combat, UI, navigation completion and
   save/load scenarios. Startup PASS is not full game correctness.
4. Exercise elevated/access-denied process-tree cases and long-running sessions.
5. Only if exposing HTTP remotely: test your actual TLS gateway, token rotation,
   evidence roots, log retention and basic alerts. No corporate certification
   or signatures are needed; working controls and observable tests are useful.

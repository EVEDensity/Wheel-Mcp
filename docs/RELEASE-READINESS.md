# Release readiness (Windows)

## Current decision: September 14, 2026

Package version remains **`0.1.0-preview.1`**. The historical release-gate label
**Windows-only stable production candidate** means suitable for supervised,
trusted-project local development; it does **not** promote the package to a
stable numbered release or certify arbitrary autonomous repair.

The validated runtime is **Godot 4.7.2 on Windows**. The local run used Node
`24.19.0`. Linux/macOS real Godot results remain NOT_RUN. No enterprise
certification, signature or external sign-off is required for this personal
project. Remote TLS/secrets/audit setup depends on your actual deployment;
[the practical guide](PRODUCTION-DEPLOYMENT.md) is not evidence that a public
endpoint has been deployed or tested.

## Version bump criteria

### Stay on `0.1.0-preview.1` until

- [ ] `release-gate` workflow passes on a clean `windows-latest` runner (see
      [.github/workflows/release-gate.yml](../.github/workflows/release-gate.yml)).
- [ ] `windows-godot` workflow passes with **0 skipped** Godot smoke tests.
- [ ] Full local `npm test` reports **0 skipped** with `GODOT_PATH` set.

### Bump to `0.1.0-preview.2` when

All of the above are green **and**:

- [ ] CHANGELOG entries for Wheel-mcp rename and one-click install are released.
- [ ] CONTRIBUTING / README install commands match verified PowerShell paths
      (`npm.cmd run go`, not bare `npm run go` on Windows).
- [ ] Install smoke tests and Godot CI workflows are merged and stable for at
      least one main-branch `release-gate` run.

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

| Workflow | Runner | Godot | Purpose |
| -------- | ------ | ----- | ------- |
| `ci.yml` | Node 20/22 × Windows/Linux/macOS | No | build, install smoke, lint, Node tests (Godot tests skip) |
| `windows-godot.yml` | Windows | Yes (4.7.2 console) | README smoke + E2E subset; **fails on any skip** |
| `release-gate.yml` | Windows | Yes | clean-machine full gate (see below) |

Generic matrix CI is intentionally Node-only. Real Godot coverage lives in the
two Windows workflows above so a green `ci.yml` alone cannot masquerade as a
full runtime gate.

## Clean-machine release gate (CI)

[`.github/workflows/release-gate.yml`](../.github/workflows/release-gate.yml)
runs on `main`/`master` push and `workflow_dispatch`:

1. `npm ci`
2. `npm run build`
3. `node scripts/install.mjs --skip-npm`
4. `npm run format:check`
5. `npm run lint`
6. Download Godot 4.7.2 console → set `GODOT_PATH`
7. `npm test`
8. `npm run matrix:generate`
9. `npm run release:check`
10. `npm run audit:dependencies`
11. `npm run sbom`

Matrix and SBOM artifacts are uploaded from the runner. `runs/` remains
gitignored; do not commit generated matrix JSON.

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

1. Confirm `release-gate` and `windows-godot` workflows pass on GitHub Actions
   before tagging `0.1.0-preview.2`.
2. Connect a real client-side model adapter plus explicit review UI. Measure it
   on a newly curated, undisclosed patch set, not recorded upstream candidates.
3. Add longer multi-scene ownership, combat, UI, navigation completion and
   save/load scenarios. Startup PASS is not full game correctness.
4. Exercise elevated/access-denied process-tree cases and long-running sessions.
5. Only if exposing HTTP remotely: test your actual TLS gateway, token rotation,
   evidence roots, log retention and basic alerts. No corporate certification
   or signatures are needed; working controls and observable tests are useful.

# Release readiness (Windows)

## Current decision: September 13, 2026

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

## Reproduce the gate

On your Windows desktop with a working renderer:

```powershell
npm ci
npm run build
npm run format:check
npm run lint
$env:GODOT_PATH = 'D:\tools\Godot_v4.7.2-stable_win64_console.exe'
npm test
npm run matrix:generate
npm run release:check
npm run audit:dependencies
npm run sbom > sbom.json
```

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

Generic CI covers Node 20/22 build/test jobs on Windows/Linux/macOS, with real
Godot tests skipped when unavailable. The unconditional real release checker
was removed from generic CI: a clean checkout has no ignored runs/matrix, so
claiming a real-runtime gate there was misleading and would fail fresh clones.
Run the real gate locally as above or add a controlled Windows renderer runner
that generates and archives its own matrix before checking it.

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

1. Repeat installation, renderer tests, packaging, audit and SBOM on a clean
   Windows environment before publishing a stable version.
2. Connect a real client-side model adapter plus explicit review UI. Measure it
   on a newly curated, undisclosed patch set, not recorded upstream candidates.
3. Add longer multi-scene ownership, combat, UI, navigation completion and
   save/load scenarios. Startup PASS is not full game correctness.
4. Exercise elevated/access-denied process-tree cases and long-running sessions.
5. Only if exposing HTTP remotely: test your actual TLS gateway, token rotation,
   evidence roots, log retention and basic alerts. No corporate certification
   or signatures are needed; working controls and observable tests are useful.

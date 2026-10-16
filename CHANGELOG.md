# Changelog

## 0.2.2

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

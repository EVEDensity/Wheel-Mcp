# Changelog

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

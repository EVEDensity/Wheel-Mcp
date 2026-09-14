# Changelog

## Unreleased - Wheel-mcp rename and one-click install

- Rename the package from `godot-game-harness-mcp` to **`wheel-mcp`**; update MCP
  host keys, CLI bins (`wheel-mcp`, `wheel-mcp-cli`, `wheel-mcp-http`) and schema
  `$id` domains to `wheel-mcp.invalid`.
- Add one-click onboarding: `npm.cmd run go` (Windows PowerShell) and
  `node scripts/install.mjs` install dependencies, build TypeScript, discover
  Godot when possible, and write `.cursor/mcp.json`, `.vscode/mcp.json`, and
  `.mcp.json`.
- Fix Windows `install.mjs` npm spawn by invoking `cmd.exe /c npm install`.
- Add install smoke tests (`tests/install.test.ts`) and a Godot CI subset runner
  (`npm run test:godot-ci`).
- Add GitHub Actions workflows: `windows-godot.yml` (README smoke + E2E subset)
  and `release-gate.yml` (clean-machine build → test → matrix → release:check →
  audit/sbom).

## Unreleased - GitHub onboarding documentation

- Fix the bundled NavigationPolygon index-array serialization exposed by the
  first-run check; add a real MCP regression that executes both README examples
  under strict diagnostics and validates the decoded 320 x 180 screenshot.
- Expand the English README and add a Chinese entry point with real first-run
  arguments, source-linked measurements, limitations and an acceptance-based roadmap.
- Add a tool catalog from official SDK discovery: 57 tools across five actual
  registration modules; distinguish MCP tool names from internal Bridge methods.
- Expand contribution guidance with implementation/test ownership, immutable
  benchmark data rules, bilingual maintenance and safe evidence-sharing boundaries.

## Unreleased - client repair and strict shutdown

- Add session-local begin_client_repair/submit_repair_candidate tools and an
  external model/approval client helper, fixed validation plans, source hashes,
  bounded candidate budgets, rollback and proposal evidence.
- Preserve runtime vs exit diagnostics, reject leak warnings under strict scope,
  quiesce scene-owned resources and report forced process cleanup explicitly.
- Freeze three traceable upstream historical defects (including a two-file fix)
  with ineffective-candidate controls, revalidation and retained preparation failures.
- Record bridge-only strict success 4/7 to 6/7 and a separate RPG ownership fix;
  do not interpret these as live-model or universal repair metrics.
- Add real client-repair/shutdown tests, portable matrix fixture defaults and
  detailed developer/AI documentation. Package remains preview.

## Unreleased

- Added persistent HTTP request lifecycle cancellation and graceful shutdown propagation.
- Added rotating bearer-token configuration, IP/client rate limiting, concurrency limits, and redacted JSONL audit logging.
- Added official MCP TypeScript Streamable HTTP client end-to-end coverage.
- Added CycloneDX SBOM generation, high-severity dependency auditing, and security threat-model documentation.
- Scoped the first public production target to Windows with validated Godot 4.7.2 runtime evidence.
- Added the external TLS, secret-management, audit, alerting, and operational sign-off checklist.

## 0.1.0-preview.1

- Initial numbered preview release line.

# Contributing

> **Product boundary:** Wheel-mcp provides Godot MCP capabilities for Codex, Cursor and other MCP clients. Planning and candidate generation stay in the client; the server performs bounded, authorized operations and returns diagnostics/evidence. No model-provider or autonomous task orchestration is added. See the [scope and implementation plan](docs/PRODUCTION-MAIN-ASSISTANT-ROADMAP.zh-CN.md).

[Project overview](README.md) | [中文说明](README.zh-CN.md) | [Tool catalog](docs/TOOL-CATALOG.md)

This is a practical personal project. No corporate certification or sign-off is
required. Small changes with a reproducible example, a meaningful test and an
honest description of their limits are welcome.

## Development setup

Work from the repository root. The package declares Node `>=20.19.0`; also meet
the installed lint/toolchain engine requirements. The recorded local evaluation
used Node `24.19.0` and Godot `4.7.2` on Windows. For your own checkout, inspect
`package.json` and the lockfile rather than assuming all Node 20 patch versions
are supported.

### First-time onboarding (install MCP configs)

From a fresh clone, run **one** verified install command. This installs
dependencies, builds TypeScript, discovers Godot when possible, and writes
`.cursor/mcp.json`, `.vscode/mcp.json`, and `.mcp.json`.

Windows PowerShell (`npm run go` is usually blocked by execution policy):

```powershell
npm.cmd run go
```

or:

```powershell
node scripts/install.mjs
```

macOS / Linux:

```bash
npm run go
```

or:

```bash
node scripts/install.mjs
```

After dependencies are already present, contributors can rerun configuration only:

```bash
node scripts/install.mjs --skip-npm
```

Generated MCP configs (`.cursor/mcp.json`, `.vscode/mcp.json`, `.mcp.json`) are
gitignored. Reference copies live under [`examples/mcp/`](examples/mcp/).

Install behavior is covered by `tests/install.test.ts`.

### Verification gates

```powershell
npm run build
npm run format:check
npm run lint
$env:GODOT_PATH = 'D:\tools\Godot_v4.7.2-stable_win64_console.exe'
$env:REAL_GODOT_PROJECT = 'tests/fixtures/runtime-behavior'
npm test
npm run test:godot-ci
```

Godot smoke tests must report **0 skipped** when `GODOT_PATH` is set. Run the
full local gate with `npm run release:gate`. Hosted workflows live in
`.github/workflows/godot-smoke.yml` and `.github/workflows/release-gate.yml`
when Actions minutes are available.

Without Godot, tests that require it can be skipped. Report skipped counts;
a passing Node-only suite is not a real runtime result. Screenshot tests need
an available non-headless renderer. Use the checked-in
[`runtime-behavior` fixture](tests/fixtures/runtime-behavior/project.godot) for
a fresh-clone smoke check; ignored author-local benchmark projects are not a
prerequisite for ordinary development.

## Where to make a change

| Change                                    | Implementation entry points                                                                   | Focused verification                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Tool name, schema or handler              | `src/mcp/tools/{project,runtime,diagnostics,scenario,evidence}.ts`; `src/mcp/tool-context.ts` | `tests/tool-registry.test.ts`, domain behavior tests, discovered input schema                              |
| Permissions, project/evidence paths       | `src/mcp/access-policy.ts`; relevant file/transport service                                   | HTTP access policy tests, traversal/symlink and cross-client rejection                                     |
| HTTP sessions, auth, cancellation, limits | `src/transports/streamable-http.ts`                                                           | `tests/streamable-http.test.ts`, `tests/streamable-http-security.test.ts`                                  |
| Stateful runtime, physics or rendering    | `src/persistent-runtime-bridge.ts`, `godot-plugin/runtime_bridge.gd`                          | `tests/runtime-behavior-e2e.test.ts`, named-target assertions and repeated frames                          |
| Stop, exit diagnostics or ownership       | Bridge files plus `src/development-loop.ts`                                                   | `tests/shutdown.test.ts`; intentional exit faults must continue to fail                                    |
| Development-loop checks and rollback      | `src/development-loop.ts`                                                                     | `tests/development-loop.test.ts`, cancellation, exact-edit and rollback conflicts                          |
| Client repair workflow                    | `src/client-repair.ts`, `src/clients/repair-workflow.ts`                                      | `tests/client-repair.test.ts`; approval refusal, expiry, stale source and failed-candidate evidence        |
| Scene resources or script analysis        | `src/godot-development.ts`, `src/script-analysis.ts`                                          | `tests/scene-resource-graph.test.ts`, `tests/script-analysis.test.ts`, `tests/diagnostics-mapping.test.ts` |
| Screenshot diff                           | `src/godot-development.ts` and its image helpers                                              | `tests/screenshot-diff.test.ts`; decode, dimensions, alpha/threshold and diff bounds                       |
| Benchmark behavior                        | Relevant `scripts/*benchmark*.mjs`, corpus and summaries                                      | Immutable case provenance, controls, separate first run and regression records                             |

The composition root `src/mcp/tool-registry.ts` only wires the five domain
modules together. Do not move tool declarations back into it. Event
subscriptions currently belong to Runtime; Evidence currently owns recent
artifacts and screenshot comparison. The module names are not a claim that all
underlying services are already small or fully typed.

The first-run argument blocks in both READMEs are exercised by
`tests/readme-smoke.test.ts` through the real MCP server. Keep those blocks
schema-valid and runnable against the included fixture with strict diagnostics.

## Definition of done for a feature or fix

1. State the developer-visible problem and provide a minimal reproduction.
2. Add a regression that fails without the fix. For runtime behavior, check
   the actual node, value or collision target, not only interface existence.
3. Keep timeout, cancellation, cleanup and evidence behavior explicit. Do not
   swallow exit errors or relax validation budgets to manufacture PASS.
4. If adding a tool, update its domain registration, access policy, registry
   expectation, catalog and both README counts. Discover it through an MCP
   client. Internal Bridge RPC methods are not standalone MCP tool names.
5. If changing a schema, explain compatibility and update executable examples.
   Keep normal/compact error semantics consistent, including validation FAIL.
6. Run the focused tests, then the available full checks; disclose NOT_RUN or
   skipped cases and platform-specific constraints.
7. Describe remaining risks without promising universal repair accuracy or
   provider token savings from synthetic payload estimates.

## Documentation and data maintenance

- `README.md` is the English entry point; `README.zh-CN.md` is the Chinese entry
  point. Keep release scope, tool count, examples, quantitative claims and
  limitations aligned. Code/schemas and dated evidence are the source of truth.
- Use repository-relative links in GitHub docs, not a maintainer's absolute
  workspace path. Clearly label illustrative Windows paths and local ignored
  run artifacts. Do not link to a nonexistent package or release asset.
- Format documentation explicitly; the ordinary `format:check` script checks
  source/tests/plugin/root JSON, not every Markdown file:

  ```powershell
  npx --no-install prettier --check README.md README.zh-CN.md CONTRIBUTING.md docs/TOOL-CATALOG.md
  ```

- Keep the historical v1 manifest byte-for-byte frozen. Do **not** run a broad
  formatter over `benchmarks/historical-defects.v1.json`. New cases belong in
  a new version/hash, with provenance and registration before evaluation.
- Keep first evaluation results, acquisition failures, ineffective candidates
  and later regressions separate. Do not overwrite an old result with a better
  rerun or merge experiments with different diagnostic scopes.
- Distinguish candidate provenance: recorded upstream patch, manually reviewed
  candidate, or actual client-model generation. They measure different things.
- Quantitative claims need a denominator, date, environment, source summary and
  limits. Char/4 payload estimates are not provider usage. Healthy-control
  outcomes are not a population false-positive rate.

## Release-oriented checks

On Windows with a real renderer, after build/lint/tests:

```powershell
npm run matrix:generate
npm run release:check
npm run audit:dependencies
npm run sbom > sbom.json
```

`release:check` consumes existing matrix evidence; it does not execute the
other checks. A fresh checkout has no ignored `runs/matrix`. Generic Node CI
without Godot must not be presented as a complete runtime release gate.
See [release readiness](docs/RELEASE-READINESS.md).

New dependencies should explain why they are needed and include the lockfile
change, vulnerability review and SBOM impact. For a public remote endpoint,
exercise the actual TLS gateway, secrets, audit retention and alerts rather
than claiming the sample deployment guide proves the deployment is secure.

## What not to upload

Do not commit `node_modules`, `build`, `dist`, `.harness`, `runs`, `.godot`, local
backups, credentials or source-bearing repair packets. Review `git status` and
staged contents: not every local backup filename is necessarily ignored.
A sanitized evidence bundle is a separate deliverable; retain upstream asset
licenses and remove private source, secrets and machine-specific details.

For a pull request or issue, include: expected/actual behavior, Node/Godot/OS,
reproduction steps, tested commands and pass/fail/skip counts, relevant sanitized
evidence, and any compatibility/security implications. Use [SECURITY.md](SECURITY.md)
for security-sensitive reports rather than posting credentials or exploitable
private deployment details in a public issue.

# Release Readiness

## Current decision

The local Windows release gate is currently **PASS** for the package version
`0.1.0-preview.1`. The first public production scope is intentionally
**Windows-only** with a validated Godot 4.7.2 runtime. This is still a numbered
preview build and must not be described as a stable `0.2.0` release. The
current decision is **Windows-only stable production candidate**, conditional on
external deployment security sign-off in
[`docs/PRODUCTION-DEPLOYMENT.md`](PRODUCTION-DEPLOYMENT.md).

## Verified

- Official MCP TypeScript SDK is the packaged server entry point:
  `build/src/mcp-server-sdk.js`.
- `npm run build` passes.
- `npm test` passes with the complete test suite, including the official MCP
  TypeScript client Streamable HTTP E2E.
- `npm run lint` passes.
- `npm run format:check` passes.
- Node 20 and 22 build/test CI jobs exist for Linux, Windows, and macOS.
- Real Godot 4.7.2 runtime evidence exists from a local Windows run.
- The matrix runner executes real CLI and MCP calls and saves raw transcripts.
- Negative invalid-project coverage is present.
- The real Windows matrix has 19/19 passing checks, including
  `stop_project`, repeated `cancel_project`, Scenario cleanup, and screenshot
  evidence at 1920x1080.
- Streamable HTTP integration tests cover bearer authentication, Host/Origin
  validation, session ownership, session deletion, scopes, and path roots.

## Platform scope

- Windows with Godot 4.7.2: validated real runtime matrix, 19/19 PASS.
- Linux and macOS: CI build/test coverage only; real Godot runtime is `NOT_RUN`
  and these platforms are outside the first public release scope.

## Remaining Release Risks

- Linux and macOS have CI build/test coverage, but no real Godot runtime
  capability evidence in this workspace.
- HTTP authentication uses configured bearer tokens with file-backed rotation,
  previous-token overlap, expiry, rate limiting, per-client and global
  concurrency limits, audit logging, request cancellation, and graceful
  shutdown. A managed secret store and external log sink remain deployment
  responsibilities.
- HTTP request timeout is a request-layer upper bound. Tool-level `timeoutMs`
  remains the authoritative operation timeout; the test suite covers
  cancellation of in-flight tools with the packaged SDK/runtime combination.
- Release evidence is local and ignored by Git. A release operator must
  generate and archive it separately.

## Required work for the next AI

1. Validate the release gate on a clean release machine with `npm ci`, then
   run build, test, lint, format check, matrix generation, security checks,
   `npm run release:check`.
2. Repeat process-tree tests in an elevated Windows environment, including
   parent/child/grandchild termination, orphan reclaim, repeated stop, invalid
   PID, and access-denied classification.
3. Obtain controlled real Godot runtime evidence on Linux and macOS, or
   explicitly scope the public release to the verified Windows runtime and
   record the other platforms as `NOT_RUN`.
4. Review the deployment's secret storage, TLS termination, audit retention,
   alerting, and operational ownership before exposing HTTP beyond localhost.
5. Only after the platform evidence and deployment review are complete should
   the preview be promoted to a production-grade public MCP release.

## Upload policy

### Upload and keep under version control

- `src/`, `tests/`, `scripts/`, `godot-plugin/`, `schemas/`
- `README.md`, this document, `LICENSE`
- `package.json`, `package-lock.json`, `tsconfig.json`, lint/format config
- `.github/workflows/`

### Do not upload

- `node_modules/`, `build/`, `dist/`
- `.harness/` and local run registry state
- `runs/` runtime logs, screenshots, transcripts, and process metadata
- `.env` or machine-local credential/configuration files

The `runs/` directory is intentionally ignored. Release evidence must be
archived outside the source package or attached to the release record, not
committed as product source. Historical evidence must not be overwritten.

## Release command sequence

```powershell
npm ci
npm run build
npm test
npm run lint
npm run format:check
npm run matrix:generate
npm run security:check
npm run release:check
```

The final command is the release gate. A zero exit code means the real matrix
and evidence requirements passed; build/test success alone does not authorize
publication.

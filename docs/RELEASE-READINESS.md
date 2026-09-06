# Release Readiness

## Current decision

This repository is **not ready for a public `0.1.0-preview` release**. The
current package version is `0.1.0-preview.1`, but that is only a numbered
preview build. It must not be described as a stable release.

## Verified

- Official MCP TypeScript SDK is the packaged server entry point:
  `build/src/mcp-server-sdk.js`.
- `npm run build` passes.
- `npm test` passes with 44 passing tests and one environment-dependent skip.
- `npm run lint` passes.
- Node 20 and 22 build/test CI jobs exist for Linux, Windows, and macOS.
- Real Godot 4.7.2 runtime evidence exists from a local Windows run.
- The matrix runner executes real CLI and MCP calls and saves raw transcripts.
- Negative invalid-project coverage is present.

## Blocking release failures

The latest real matrix is not release-clean:

- `stop_project` returns a real MCP `TIMEOUT`.
- `cancel_project` returns a real MCP `TIMEOUT`.
- `execute_scenario` has a real cancellation/cleanup failure in the matrix.
- Windows process-tree success is not proven in the restricted environment;
  the taskkill test is correctly skipped on `ACCESS_DENIED`.
- Linux and macOS have CI build/test coverage, but no real Godot runtime
  capability evidence.
- `npm run release:check` intentionally fails unless a complete, passing
  `runs/matrix` artifact is present. `runs/` is local evidence and is ignored
  by Git, so a release operator must generate and archive it separately.

## Required work for the next AI

1. Fix MCP stop/cancel timeout propagation and verify terminal process metadata.
2. Complete `execute_scenario` MCP tests for full steps, timeout, cancellation,
   retry, `onFailure=stop`, `onFailure=continue`, event assertion failure,
   summary evidence, child-process cleanup, and reconnect behavior.
3. Run `npm run matrix:generate` against a real Godot project and inspect all
   four JSON artifacts and every transcript.
4. Repeat process-tree tests in an elevated Windows environment, including
   parent/child/grandchild termination, orphan reclaim, repeated stop, invalid
   PID, and access-denied classification.
5. Obtain real Godot runtime evidence on Linux and macOS, or explicitly keep
   those capabilities marked `NOT_RUN`.
6. Run `npm run release:check`; it must return `PASS` with no failed result,
   no `PENDING_REAL_RUN`, complete tool coverage, negative tests, manifests,
   and platform summary.
7. Only then update the release notes/version and publish `0.1.0-preview`.

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
npm run release:check
```

The final command is the release gate. A zero exit code means the real matrix
and evidence requirements passed; build/test success alone does not authorize
publication.

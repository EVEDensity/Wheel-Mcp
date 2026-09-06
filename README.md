# Godot Game Harness MCP

Current release line: `0.1.0-preview.1`. This is the first numbered preview
of the `0.1.0-preview` release line; it is not a stable `0.2.0` release.

This repository is an independent, CLI-first Godot adapter for AI Game Harness.
It does not copy the B1/B2 benchmark implementations.

## Verification Status

- Node.js 20 and 22 are covered by the CI matrix on Linux, Windows, and macOS
  for build, lint, unit tests, and release checks.
- Real Godot runtime evidence has been collected locally on Windows with Godot
  4.7.2. CI does not claim real Godot runtime coverage unless `GODOT_PATH` and
  `REAL_GODOT_PROJECT` are explicitly configured.
- Windows process-tree testing may be `SKIP` in restricted environments when
  `taskkill /T /F` returns `ACCESS_DENIED`.

## Capability Boundaries

`get_scene_tree` is a static editor-plane parser. It reads `.tscn` files and
returns `runtime: false`.

`get_runtime_scene_tree`, `get_runtime_property`, `set_runtime_property`,
`inject_runtime_input`, and `capture_runtime_screenshot` start a real Godot
runtime bridge and return `runtime: true` or a runtime capability response.

Runtime events have two delivery modes backed by the same persistent
subscription registry:

- Polling: create a subscription, call `poll_event_subscription`, acknowledge
  its cursor, then pause, resume, reconnect, or close it.
- MCP notification: call `subscribe_runtime_events` with `continuous: true`.
  The server creates or reuses a `subscription_id` and sends events through
  MCP logging notifications. Use `ack_event_subscription` for ACK and pass the
  same `subscriptionId` after reconnect.

`execute_scenario` is available through MCP and the `scenario` CLI command.
Both call the same Scenario Executor and share timeout, cancellation, and
evidence behavior.

## CLI

Build first with `npm run build`. Set `GODOT_PATH` to a Godot executable.

```powershell
$env:GODOT_PATH = 'E:\AI\Godot_v4.7.2-stable_win64_console.exe'
node .\build\src\cli.js doctor [--godot PATH] [--timeout MS]
node .\build\src\cli.js list-projects --directory PATH [--recursive true]
node .\build\src\cli.js project-info --project PATH
node .\build\src\cli.js scene-tree --project PATH [--scene res://main.tscn]
node .\build\src\cli.js launch --project PATH [--evidence DIR] [--headless true]
node .\build\src\cli.js logs --evidence DIR
node .\build\src\cli.js runtime-scene-tree --project PATH --bridge PATH [--evidence DIR]
node .\build\src\cli.js runtime-property --project PATH --bridge PATH --property NAME
node .\build\src\cli.js set-runtime-property --project PATH --bridge PATH --property NAME --value JSON
node .\build\src\cli.js inject-input --project PATH --bridge PATH --keycode N [--pressed true]
node .\build\src\cli.js screenshot --project PATH --bridge PATH [--output PATH]
node .\build\src\cli.js scenario --file SCENARIO --bridge PATH [--evidence DIR]
node .\build\src\cli.js context-pack --project PATH [--evidence DIR]
node .\build\src\cli.js stop --pid PID [--timeout MS]
node .\build\src\cli.js cancel --pid PID [--timeout MS]
```

All numeric and boolean CLI values are validated before the operation starts.
Invalid values produce the standard error envelope with `FAILED` or
`INVALID_ARGUMENT`.

## MCP Tools

The stdio server is `build/src/mcp-server-sdk.js`. Every tool accepts optional
`timeoutMs` where applicable and returns JSON text in the official MCP result.

Core tools:

- `get_godot_version({ godotPath, timeoutMs })`
- `list_projects({ directory, recursive, timeoutMs })`
- `get_project_info({ projectPath, timeoutMs })`
- `get_scene_tree({ projectPath, scenePath, timeoutMs })`
- `launch_project({ projectPath, godotPath, evidenceDir, headless, timeoutMs })`
- `get_debug_output({ evidenceDir, timeoutMs })`
- `stop_project({ pid, timeoutMs })`, `cancel_project({ pid, timeoutMs })`
- `get_process_status({ pid, timeoutMs })`
- `get_context_pack({ projectPath, godotPath, evidenceDir, scenePath, timeoutMs })`

Runtime tools:

- `get_runtime_scene_tree({ projectPath, godotPath, bridgePath, evidenceDir, timeoutMs })`
- `get_runtime_property({ projectPath, godotPath, bridgePath, evidenceDir, nodePath, property, timeoutMs })`
- `set_runtime_property({ projectPath, godotPath, bridgePath, evidenceDir, nodePath, property, value, timeoutMs })`
- `inject_runtime_input({ projectPath, godotPath, bridgePath, evidenceDir, keycode, pressed, timeoutMs })`
- `capture_runtime_screenshot({ projectPath, godotPath, bridgePath, evidenceDir, screenshotPath, timeoutMs })`
- `execute_scenario({ scenario, scenarioPath, godotPath, bridgePath, evidenceDir, globalTimeoutMs, retries, onFailure, timeoutMs })`

Event and run-control tools include `create_event_subscription`,
`poll_event_subscription`, `ack_event_subscription`,
`pause_event_subscription`, `cancel_event_subscription`,
`close_event_subscription`, `list_event_subscriptions`, `get_runtime_events`,
`subscribe_runtime_events`, `list_runs`, `list_active_runs`, `stop_run`,
`cancel_run`, and `reclaim_orphan_runs`.

## Event Example

```json
{
  "evidenceDir": "./runs/example",
  "continuous": true,
  "event": ["level_started", "exit_reached"],
  "maxEvents": 10,
  "timeoutMs": 30000
}
```

The result and each logging notification contain `subscription_id` and a
sequence-based cursor. A client acknowledges the delivered cursor with:

```json
{
  "evidenceDir": "./runs/example",
  "subscriptionId": "sub-...",
  "cursor": { "run_id": "run-...", "sequence": 12 }
}
```

## Evidence

New evidence directories contain `manifest.json` with either
`PROCESS_EVIDENCE` or `BRIDGE_EVIDENCE`. The manifest points to the common
request, response, process, stdout, stderr, and events files. Legacy
`envelope.json`, `requests.jsonl`, and `responses.jsonl` are retained for
compatibility and redact credential-like fields.

## Development

```text
npm ci
npm run build
npm test
npm run lint
npm run format:check
npm run release:check
npm run matrix:generate
```

Errors use `TIMEOUT`, `CANCELLED`, `FAILED`, and `INVALID_ARGUMENT` codes.
Successful observations are labelled `REAL`; unsupported capabilities are
labelled `UNAVAILABLE` rather than substituted with CLI behavior.

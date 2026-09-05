# Godot Game Harness MCP

Current release: `0.1.0-preview.1` (developer preview; not yet a stable
release).

Supported and verified in CI: Node.js 20/22 on Linux. Windows is exercised
locally with Godot 4.7.2; macOS has not yet been executed in this environment.

CLI-first Godot runtime adapter for the AI Game Harness project. This is an
independent repository and does not copy B1/B2 source code.

## Current scope

- `doctor`: verify `GODOT_PATH` and read the real Godot version.
- `list_projects`: discover `project.godot` files below a directory.
- `get_project_info`: read project metadata and relative files.
- `get_scene_tree`: parse nodes from a real `.tscn` file. This is a static
  editor-plane query and is explicitly returned with `runtime: false`.
- `get_runtime_scene_tree`: launch Godot with `godot-plugin/runtime_bridge.gd`
  and return nodes from the loaded runtime scene with `runtime: true`.
- `get_runtime_property` / `set_runtime_property`: read and write serializable
  runtime node properties through the bridge.
- `launch`: start a Godot project and write process metadata plus raw stdout/stderr.
- `logs`: read a completed evidence directory without killing its process first.
- `stop`: stop a process and report whether it exited.
- `git_checkpoint`: capture Git HEAD, status, and binary diff evidence.
- `git_recovery`: reverse an explicitly supplied patch after a failed run.

Set `MCP_EVIDENCE_DIR` to append every raw JSON-RPC request and response to an
Evidence Envelope (`envelope.json`, `requests.jsonl`, `responses.jsonl`).
Credential-like fields are redacted before persistence.

Tool failures use the versioned schema in `schemas/error.schema.json`, with
stable `code`, `retryable`, and `timed_out` fields. `stop_project` accepts an
optional `timeoutMs` value.

The MCP server uses the official Model Context Protocol TypeScript SDK and
exposes the same operations over newline-delimited stdio (`initialize`,
`notifications/initialized`, `tools/list`, and `tools/call`). Runtime launch,
logs, stop/cancel, SceneTree, properties, input, screenshots, event cursors,
Scenario Executor, and Context Pack are available when a Godot 4 project and
bridge are configured. Results are always labelled `REAL`, `UNAVAILABLE`, or
`FAIL`; CLI output never substitutes for an MCP capability.

## Usage

```powershell
$env:GODOT_PATH = 'E:\AI\Godot_v4.7.2-stable_win64_console.exe'
node .\build\src\cli.js doctor
node .\build\src\cli.js launch --project 'D:\path\to\godot-project' --evidence '.\runs\example'
node .\build\src\cli.js logs --evidence '.\runs\example'
node .\build\src\cli.js scene-tree --project 'D:\path\to\godot-project' --scene 'res://main.tscn'
node .\build\src\cli.js stop --pid 12345
```

The CLI keeps credentials out of evidence and uses `REAL` labels only for
observations obtained from actual local processes.

The first runtime bridge is read-only. It receives the main scene from the
adapter, writes a JSON response, exits, and leaves stdout/stderr plus request
and response files in the evidence directory.

# Godot Game Harness MCP

CLI-first Godot runtime adapter for the AI Game Harness project. This is an
independent repository and does not copy B1/B2 source code.

## Current scope

- `doctor`: verify `GODOT_PATH` and read the real Godot version.
- `list_projects`: discover `project.godot` files below a directory.
- `get_project_info`: read project metadata and relative files.
- `get_scene_tree`: parse nodes from a real `.tscn` file. This is a static
  editor-plane query and is explicitly returned with `runtime: false`.
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

The MCP server exposes the same operations over newline-delimited JSON-RPC
stdio (`initialize`, `notifications/initialized`, `tools/list`, and
`tools/call`). Runtime launch/log/stop and static project/scene inspection are
available today. Runtime SceneTree mutation, property read/write, input
injection, and MCP screenshots remain `UNAVAILABLE` until a real Godot bridge
and task-linked evidence fixture exist; Godot CLI output cannot substitute for
those capabilities.

## Usage

```powershell
$env:GODOT_PATH = 'E:\AI\Godot_v4.7.2-stable_win64_console.exe'
node .\src\cli.js doctor
node .\src\cli.js launch --project 'D:\path\to\godot-project' --evidence '.\runs\example'
node .\src\cli.js logs --evidence '.\runs\example'
node .\src\cli.js scene-tree --project 'D:\path\to\godot-project' --scene 'res://main.tscn'
node .\src\cli.js stop --pid 12345
```

The CLI keeps credentials out of evidence and uses `REAL` labels only for
observations obtained from actual local processes.

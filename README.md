# Godot Game Harness MCP

CLI-first Godot runtime adapter for the AI Game Harness project. This is an
independent repository and does not copy B1/B2 source code.

## Current scope

- `doctor`: verify `GODOT_PATH` and read the real Godot version.
- `launch`: start a Godot project and write process metadata plus raw stdout/stderr.
- `logs`: read a completed evidence directory without killing its process first.
- `stop`: stop a process and report whether it exited.

The current implementation is intentionally a runtime adapter. MCP JSON-RPC
transport, Scene/Node operations, input injection, screenshots, and Git
recovery will be added only with a task contract, evidence fixture, and
negative control linked to a real Failure ID.

## Usage

```powershell
$env:GODOT_PATH = 'E:\AI\Godot_v4.7.2-stable_win64_console.exe'
node .\src\cli.mjs doctor
node .\src\cli.mjs launch --project 'D:\path\to\godot-project' --evidence '.\runs\example'
node .\src\cli.mjs logs --evidence '.\runs\example'
node .\src\cli.mjs stop --pid 12345
```

The CLI keeps credentials out of evidence and uses `REAL` labels only for
observations obtained from actual local processes.

# AI client compatibility

## What `npm.cmd run go:global` configures

Run this from the repository root on Windows:

```powershell
npm.cmd run go:global
```

The global setup builds Wheel-mcp, detects Godot, and writes the standard `wheel-mcp` stdio entry for the clients currently supported by the installer:

| Client                   | Setup scope        | Installer status                      |
| ------------------------ | ------------------ | ------------------------------------- |
| Codex                    | Global             | Automatically configured              |
| Cursor                   | Global and project | Automatically configured              |
| Claude Desktop           | Global             | Automatically configured              |
| Claude Code              | Project            | Automatically configured              |
| Windsurf                 | Global             | Automatically configured              |
| VS Code / GitHub Copilot | Project            | Automatically configured              |
| Godot                    | Runtime target     | Detected / verified, not an AI client |

After setup, restart the client and call `get_godot_version` to verify the connection.

## Standard MCP entry

Clients that support MCP but are not auto-configured by the installer can use the same command entry manually:

```json
{
  "command": "node",
  "args": ["C:/absolute/path/to/Wheel-mcp/scripts/run-mcp.mjs"]
}
```

Use an absolute path for a global configuration. Keep the server name as `wheel-mcp`. Trae and other MCP clients may require their own UI or configuration location; this static website does not claim automatic Trae configuration until a stable official config contract is available.

The website carousel is a visual compatibility map, not a promise that every logo has an automatic installer adapter.

# AI client compatibility

[Documentation index](README.md) · [First project](GETTING-STARTED.md) · [首次接入](GETTING-STARTED.zh-CN.md)

Installer adapters below describe configuration generation, not a support or
end-to-end acceptance matrix. The stable profile is Windows/local stdio;
other clients' form approval and model-driven workflows need separate validation.
In particular, the earlier Cursor real-client write acceptance was not completed.

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

Setup updates the executable entry while preserving existing JSON environment,
roots/scopes and client settings. Changed JSON and `.env` files have exact backups;
malformed JSON is left unchanged. Keep backups private because they may contain credentials.
Project-scoped entries are written in the Wheel-Mcp
checkout, not automatically in your separate Godot game folder. Global entries
use absolute paths to this checkout. Set explicit project/evidence roots and
least-privilege scopes before opening another project; see the first-project guide.

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

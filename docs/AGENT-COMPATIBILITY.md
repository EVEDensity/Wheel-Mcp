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

## Timeouts, cancellation and reconnects

In the development source after v0.2.8, side-effecting requests returning
`TIMEOUT`, `CANCELLED` or `UNKNOWN` carry `retryable: false` and inspection advice.
The same guidance survives failure pagination. A timeout is not proof of rollback:
never automatically repeat a write, launch or input action merely because its
reply was lost. Read-only timeout behavior is unchanged.

Before a write, retain the explicit `operationId` and relevant session identity.
After uncertainty, use `get_runtime_operation_status`, `get_editor_scene_operation`
or `get_client_repair_status` as appropriate. These are not interchangeable:
editor status needs the original editor session; repair status is held in the
same MCP server session. For disk writes, inspect the exact file hashes and
transaction evidence before deciding the next action. Missing or expired status
does not authorize a retry, rollback or another owner's recovery.

After updating source, rebuild and restart the configured MCP connection. List
tools/resources again; do not reuse resource URIs or repair tickets from the old
server. Changing files on disk does not update an already running server.
No automatic replay of uncertain mutations is performed.

The installed Codex app-server probe uses only an isolated temporary project,
no model turn or permanent client configuration changes. Its exact-plan approvals
are explicit **test doubles**, not human desktop approval acceptance. Desktop
approval visibility, renderer focus and real update UX remain separately unverified.

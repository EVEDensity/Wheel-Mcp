# Connect your first Godot project

[简体中文](GETTING-STARTED.zh-CN.md) · [Documentation](README.md)

Use Windows, Godot 4.7.2 and Node.js 24 for the local stable profile.
Wheel-mcp runs on your computer over stdio; visiting the website does not install
or start it. Only open projects you trust: Godot executes project code with your
OS permissions.

## Install the release source

Install Git, Node.js and Godot first. In PowerShell:

```powershell
git clone --branch v0.2.3 https://github.com/EVEDensity/Wheel-Mcp.git
cd Wheel-Mcp
npm.cmd ci
npm.cmd run build
```

This pins the release rather than a moving main branch. The GitHub Release also
includes a prebuilt runtime archive, SBOM and SHA256SUMS. No npm publication is
part of this release; do not assume `npx wheel-mcp` installs this exact build.

## Choose automatic or manual setup

Automatic setup: back up existing MCP client configuration, then run
`npm.cmd run go:global`. It installs dependencies, builds, discovers Godot and
updates global and checkout-local client entries. Use `npm.cmd run go` if only
checkout-local entries are wanted. Updates preserve JSON environment and client
settings, back up changed JSON/`.env` files and leave malformed JSON unchanged.
Keep configuration backups private; they may contain credentials.
These commands configure the Wheel-Mcp checkout, not each separate game folder.

For manual setup, merge the following **server entry** into the location required
by your client. This is not a complete configuration file. Replace every path;
keep the Wheel-Mcp checkout in place while the client references it.

```json
{
  "command": "node",
  "args": ["D:/tools/Wheel-Mcp/build/src/mcp-server-sdk.js"],
  "env": {
    "GODOT_PATH": "D:/tools/Godot_v4.7.2-stable_win64_console.exe",
    "MCP_STDIO_PROJECT_ROOTS": "D:/games/MyGame",
    "MCP_STDIO_EVIDENCE_ROOTS": "D:/wheel-evidence/MyGame",
    "MCP_STDIO_SCOPES": "read"
  }
}
```

Create the game and evidence directories first; `MyGame` must contain
`project.godot`. Set these roots in the client server environment even after
automatic setup. Separate evidence from the project, do not grant a whole drive,
and separate multiple allowed roots with semicolons. If Node is not on the client's
PATH, use its absolute executable path.

[Client setup locations](../README.md#manual-installation-and-client-configuration)
and [installer coverage](AGENT-COMPATIBILITY.md) describe the existing adapters.
An adapter writing configuration is not proof that a specific client version
supports every tool or approval form.

## Verify read access

Restart the client or reload its MCP servers. Ask it to call `get_godot_version`,
then `get_project_info` with `projectPath` set to `D:/games/MyGame`.
Confirm the returned engine and project match your intended installation before
enabling runtime or write operations.

If access is denied, correct the exact roots or scopes; do not expand permissions
to a whole drive. See [troubleshooting](TROUBLESHOOTING.md).

## Enable runtime verification when needed

Change `MCP_STDIO_SCOPES` to `read,run`, reload the server, and follow
[DEV-LOOP.md](DEV-LOOP.md) or the [bundled README example](../README.md#examples).
Use the bridge bundled with this checkout. `launch_project` and
`open_runtime_bridge` default to headless operation. Reuse the returned session
instead of opening a new engine for each request, and stop it when done.

Rendered screenshots require a graphics-capable run; headless mode has no
screenshot framebuffer. The bundled README example requests a screenshot and
therefore is not a windowless check.

## Enable writes separately

Only add `write` after backing up or committing your game. Normal writes require
an exact transaction approval form from the client; a JSON `approved: true` is
not approval. Unsupported clients fail closed. A local preauthorization manifest
is a separate advanced opt-in, not a general approval bypass. Editor authoring
also needs the [authorized editor plugin](production-roadmap/EDITOR-BRIDGE-CONTRACT.md).

Read the [authorization policy](production-roadmap/AUTHORIZATION-POLICY.md) and
[transaction contract](production-roadmap/TRANSACTION-CONTRACT.md) before enabling writes.

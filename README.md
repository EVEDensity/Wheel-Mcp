<p align="center"><img src="assets/logo.png" alt="Wheel-mcp logo" width="100%"></p>

# Wheel-mcp

**English** | [简体中文](README.zh-CN.md)

> Give your AI a running Godot game—not just source files.

Wheel-mcp is a **Godot MCP server for Codex, Cursor, and other MCP clients**. Connect your assistant to project files and a real game runtime: inspect state, test behavior, collect logs, and verify changes with screenshots and assertions.

**Godot 4 · MCP · MIT · Preview**

[Quick start](#quick-start) · [Examples](#examples) · [Roadmap](#major-roadmap) · [Contributing](#contributing)

If this helps your Godot workflow, **give it a Star**. Bug reports, reproducible examples, and focused PRs are just as welcome.

## Why Wheel-mcp?

| Workflow               | What the server provides                                     |
| ---------------------- | ------------------------------------------------------------ |
| Explore a project      | Scene, script, and resource discovery                        |
| Inspect a running game | Persistent runtime sessions and property inspection          |
| Check behavior         | Inputs, events, physics-frame waits, and explicit assertions |
| Diagnose failures      | Engine diagnostics, runtime logs, and failure evidence       |
| Verify a change        | Screenshots, comparisons, and evidence artifacts             |

**The client plans and writes code; Wheel-mcp executes bounded Godot operations and reports evidence.** This project is not an autonomous game generator, model provider, or replacement for your coding assistant.

## Current status

Release: `0.1.0-preview.2`. This is a preview, not a production-readiness claim. The documented runtime validation scope is Windows with Godot 4.7.2; Linux/macOS real-engine support remains unverified. Client compatibility must be tested per version.

## Quick start

### 1. Build from source

Install Godot and Node.js **>=20.19.0**; also satisfy the installed development toolchain's requirements. On Windows:

```powershell
git clone https://github.com/EVEDensity/Wheel-mcp.git
cd Wheel-mcp
npm.cmd ci
npm.cmd run build
```

### 2. Connect your client

Replace every example path with your own absolute path. Merge these entries into existing configuration rather than overwriting it.

<details>
<summary>Cursor configuration</summary>

Use your game's workspace `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "wheel-mcp": {
      "command": "node",
      "args": ["D:/tools/Wheel-mcp/build/src/mcp-server-sdk.js"],
      "env": { "GODOT_PATH": "D:/tools/Godot_console.exe" }
    }
  }
}
```

</details>

<details>
<summary>Codex configuration</summary>

Use `~/.codex/config.toml`:

```toml
[mcp_servers.wheel-mcp]
command = "node"
args = ["D:/tools/Wheel-mcp/build/src/mcp-server-sdk.js"]

[mcp_servers.wheel-mcp.env]
GODOT_PATH = "D:/tools/Godot_console.exe"
```

</details>

### 3. Check the connection

Reload your client and ask it to call `get_godot_version`. If Node is not on the client's PATH, use its absolute executable path. These are configuration templates, not a claim of validation for every client release. Back up existing configuration before using setup scripts that overwrite entries.

## Examples

Try asking your connected client:

> Inspect this scene and check whether Camera2D is enabled at runtime.

> Run the test scene, send input, and collect logs and a screenshot. Report failed assertions with evidence.

> After applying this patch, run the same checks again and compare the results.

These are client workflow examples, not guarantees of autonomous completion. See the [tool catalog](docs/TOOL-CATALOG.md) for actual interfaces.

<details>
<summary>Reproduce the bundled runtime check</summary>

From the repository root, import the fixture first:

```powershell
$env:GODOT_PATH = 'D:/tools/Godot_console.exe'
$repo = (Get-Location).Path
& $env:GODOT_PATH --headless --path "$repo/tests/fixtures/runtime-behavior" --editor --import
```

Then ask the connected client to call `dev_loop` with the following arguments, replacing the repository prefix. This is a minimal state/physics fixture, not a polished game demo.

```json
{
  "projectPath": "D:/games/Wheel-mcp/tests/fixtures/runtime-behavior",
  "bridgePath": "D:/games/Wheel-mcp/godot-plugin/runtime_bridge.gd",
  "evidenceDir": "D:/games/Wheel-mcp/runs/readme-smoke",
  "scenePath": "res://main.tscn",
  "actions": [{ "method": "wait_physics_frames", "params": { "frames": 12 } }],
  "checks": [
    {
      "id": "camera-enabled",
      "method": "get_property",
      "params": { "nodePath": "Camera2D", "property": "enabled" },
      "path": "value",
      "op": "equals",
      "expected": true
    }
  ],
  "screenshot": true,
  "maxRetries": 0,
  "timeoutMs": 30000,
  "responseMode": "compact"
}
```

Expected result: PASS, zero diagnostic errors, and a 320 × 180 screenshot. The README smoke test reads these arguments directly; an engine test that is skipped is not a successful runtime validation.

</details>

## Know the boundaries

- Runtime property changes do **not** imply a saved editor scene. Native editor editing, undo, and save/reopen verification remain roadmap work.
- Persistent sessions and one-shot runs use separate instances; do not assume they share state.
- Only run trusted projects. Project scripts execute code; this server is not an operating-system sandbox.
- Advanced 3D, animation, and shader workflows are not advertised as complete. See the roadmap before depending on them.

## Major roadmap

All items below are future completion goals, not shipped guarantees. The [implementation plan](docs/PRODUCTION-MAIN-ASSISTANT-ROADMAP.zh-CN.md) and [task state](docs/production-roadmap/tasks.json) contain detailed acceptance criteria.

- [ ] **Reliable execution:** consistent types, errors, events, timeouts, recovery, and verification that new code is actually loaded.
- [ ] **Editor-native editing:** persistent scene/node changes, undo, transactions, and safe save/reopen verification.
- [ ] **Broader Godot workflows:** bounded, tested support for UI, 3D, animation, materials, shaders, and physics.
- [ ] **Project intelligence and context:** semantic resource indexing, structured Resources/Prompts, and predictable context budgets.
- [ ] **Client compatibility and verification:** Codex/Cursor integration tests, reproducible operation sequences, external patch validation, and regression evidence.
- [ ] **Production reliability and safety:** cross-platform validation, installation/upgrades, long-running stability, permission boundaries, and failure recovery.

## Contributing

Help with reproducible bugs, real-engine/client testing, documentation, translations, or authorized demos. For a larger change, open an Issue to agree on scope before implementation. Keep PRs focused and include a minimal fixture when possible.

```powershell
npm.cmd run check
```

Engine-related changes also need real Godot tests with `GODOT_PATH` configured. Include versions and sanitized logs in reports. Never commit secrets, private project content, or assets without permission. Read [CONTRIBUTING.md](CONTRIBUTING.md) before starting.

## Documentation

- [Tool catalog](docs/TOOL-CATALOG.md)
- [Development loop](docs/DEV-LOOP.md)
- [Client repair protocol](docs/CLIENT-REPAIR.md)
- [Deployment](docs/PRODUCTION-DEPLOYMENT.md) and [security boundaries](docs/SECURITY-THREAT-MODEL.md)
- [Implementation roadmap (Chinese)](docs/PRODUCTION-MAIN-ASSISTANT-ROADMAP.zh-CN.md)

## License

[MIT](LICENSE). Independent community project; not an official Godot, OpenAI, or Cursor product.

**Star to follow progress. Fork and open a PR to help build it.**

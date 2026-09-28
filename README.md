<p align="center"><img src="assets/logo.png" alt="Wheel-mcp logo" width="100%"></p>

# Wheel-mcp

**English** | [简体中文](README.zh-CN.md)

> Give your AI a running Godot game—not just source files.

Wheel-mcp is a **Godot MCP server for Codex, Cursor, and other MCP clients**. Connect your assistant to project files and a real game runtime: inspect state, test behavior, collect logs, and verify changes with screenshots and assertions.

**Godot 4 · MCP · MIT · Preview**

[Quick start](#quick-start) · [Examples](#examples) · [Roadmap](#major-roadmap) · [Contributing](#contributing)

If this helps your Godot workflow, **give it a Star**. Bug reports, reproducible examples, and focused PRs are just as welcome.

## Token and interaction efficiency

**Fewer tool exchanges. Leaner context.** In a seven-case test, `dev_loop` reduced estimated payload tokens by **94.61%** and MCP requests by **95.39%** compared with a fine-grained workflow.

![Wheel-mcp test comparison: estimated payload tokens and MCP requests](assets/benchmark-efficiency.svg)

Use `responseMode: "compact"` for concise results and `dev_loop` to combine actions, assertions, and screenshots into one verification call.

Project-file writes and repair candidates now require the client's separate MCP form confirmation of the exact transaction. `approved: true` alone does not authorize edits; clients without form elicitation support fail closed. Each failed candidate rolls back before another is tested. See the [transaction/migration contract](docs/production-roadmap/TRANSACTION-CONTRACT.md).

Optional editor channel: `get_editor_state` reads an already-enabled, privately authorized Godot 4.7.2 editor. Independently opted-in write clients can use exact approved `apply_editor_scene`, bounded resources, native Undo/Redo and `save_editor_scene`. File candidates validate in an isolated project before commit; explicit raw writes report `NOT_RUN`. Native save retains the dirty marker/history. T17 adds bounded UI layouts and flat themes behind the explicit `scene.ui/v1` plugin capability; the user approved the separate human visual review on 2026-09-27. T18 adds bounded 3D physics queries and authoring. T19 adds bounded animation clips, state machines and two-source Blend2 behind `scene.animation/v1`. T20 adds exact shader text/texture-blend templates and a bounded Color/Mix VisualShader graph behind `scene.shader/v1`. T21 adds bounded PNG import, byte-exact transactions and isolated 2D/3D content workflows. The G3 frozen-source gate passed 300 full tests, 105 required Godot-suite checks, 20 native cycles and 18 representative workflow checks; automated approvals were mock. See the [UI boundaries](docs/production-roadmap/UI-AUTHORING-CONTRACT.md), [3D physics boundaries](docs/production-roadmap/PHYSICS-3D-CONTRACT.md), [animation boundaries](docs/production-roadmap/ANIMATION-AUTHORING-CONTRACT.md), [shader boundaries](docs/production-roadmap/SHADER-AUTHORING-CONTRACT.md), [content workflow boundaries](docs/production-roadmap/CONTENT-WORKFLOWS-CONTRACT.md), [manual editor setup](docs/production-roadmap/EDITOR-BRIDGE-CONTRACT.md) and [safe save/migration](docs/production-roadmap/SAFE-SAVE-CONTRACT.md). These are deliberately limited types, not full authoring or online production qualification.

T22 is in progress. `analyze_script_semantics` is explicitly heuristic; the new `query_script_semantics` reads bounded symbols, references, definitions and diagnostics from an authorized local Godot editor/LSP. Godot's raw references can include matching strings and comments, so neither tool authorizes rename. See the [semantic service boundary](docs/production-roadmap/SCRIPT-SEMANTIC-CONTRACT.md).

Seven controlled cases on 2026-09-13; payload tokens estimated as JSON characters / 4, not billable tokens or runtime speedups.

[Test report](docs/REPAIR-BENCHMARK-2026-09-13.md) · [Reproduce](benchmarks/README.md)

With a real `GODOT_PATH`, `npm run benchmark:comparison` reproduces three alternating-order one-shot/persistent SDK query pairs. It records end-to-end time, engine starts, tool calls and serialized bytes, retaining every pair. Actual tokens, billing and whole-workflow efficiency are not measured; these results must not be mixed with the historical estimates above.

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

Release: `0.1.0-preview.2`; production qualification is **NOT_QUALIFIED**. The verified subset is **Windows-only with Godot 4.7.2**, for trusted local projects, not online deployment. T12–T15 passed the historical G2 authoring/save/reopen gate. T16 adds bounded native inheritance/instance overrides, dependency guards and conservative approved scene moves; see the [scene dependency/migration contract](docs/production-roadmap/SCENE-DEPENDENCY-CONTRACT.md). T16–T21 passed G3 on the frozen source; T22–T35/G4–G6 remain pending. Linux/macOS real-engine support, default registry recovery and human client compatibility must be separately qualified. Evidence and exact source identity are in the [task ledger](docs/production-roadmap/tasks.json).

## Quick start

### One-command setup

Install Node.js **>=20.19.0** and Godot, then clone:

```bash
git clone https://github.com/EVEDensity/Wheel-mcp.git
cd Wheel-mcp
npm run go:global
```

Global setup also includes project configuration. The installer installs dependencies, builds, and looks for Godot. Existing Codex configuration is backed up automatically—**no manual backup needed**.

Restart your client and call `get_godot_version` to verify the connection.

- **Windows shortcut:** double-click [install.cmd](install.cmd) for project setup; use the global command for Codex. If PowerShell blocks npm, use `npm.cmd`.
- **Godot not found:** set `GODOT_PATH=/absolute/path/to/godot` in the repository's `.env` and retry. Setup updates this file when Godot is detected.
- **Start the service only:** after installation, `npm run mcp` starts the MCP service, not a game.

### Manual installation and client configuration

Use the following as an alternative to one-command setup.

#### 1. Build from source

Install Godot and Node.js **>=20.19.0**; also satisfy the installed development toolchain's requirements. On Windows:

```powershell
git clone https://github.com/EVEDensity/Wheel-mcp.git
cd Wheel-mcp
npm.cmd ci
npm.cmd run build
```

#### 2. Connect your client

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

#### 3. Check the connection

Reload your client and ask it to call `get_godot_version`. If Node is not on the client's PATH, use its absolute executable path.

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

## Project website (local preview)

The static website and browser playground live in `docs/`. Run
`npm run site:serve` and open `http://127.0.0.1:4173/Wheel-mcp/`.
Run `npm run site:test` for static-link and game-logic checks.
See [website setup and game integration](docs/WEBSITE.md).

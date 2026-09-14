# Godot MCP tool catalog for Codex/Cursor clients

> **Product boundary:** Wheel-mcp provides Godot MCP capabilities for Codex, Cursor and other MCP clients. Planning and candidate generation stay in the client; the server performs bounded, authorized operations and returns diagnostics/evidence. No model-provider or autonomous task orchestration is added. See the [scope and implementation plan](PRODUCTION-MAIN-ASSISTANT-ROADMAP.zh-CN.md).

[English README](../README.md) | [中文说明](../README.zh-CN.md)

Snapshot: **September 14, 2026**, `0.1.0-preview.2`, **57 tools**. Names and descriptions below were read using the official SDK client against this checkout; ownership was checked against the five registration modules.

Use MCP `tools/list` on your running server for current schemas, defaults and required fields. This page is navigation, not a substitute for schema discovery. Tool count is not a gameplay-correctness score.

## Choose the right lifetime

- Static project tools inspect files without a running game.
- `open_runtime_bridge` / `call_runtime_bridge` / `stop_runtime_bridge` keep one live game session; use the returned `sessionId` for interactions that must share state.
- Legacy one-shot runtime tools launch separate work; do not assume a prior call's input or mutation survives.
- `dev_loop` owns a fresh runtime and cleanup for a bounded validation; `run_test_scene` uses the Scenario schema, not the `dev_loop` schema.
- Bridge RPC names such as `get_property` are not standalone MCP tool names. They belong in the appropriate bridge/loop method field.

There are **no standalone `get_script_errors` or `get_runtime_errors` MCP tools in this snapshot**. Use `dev_loop` diagnostic evidence and `get_debug_output` for collected logs; `analyze_script_semantics` is static analysis, not a substitute for Godot parser execution.

## project (14)

Registration: [`src/mcp/tools/project.ts`](../src/mcp/tools/project.ts).

| Tool                 | Purpose                                                               |
| -------------------- | --------------------------------------------------------------------- |
| `analyze_collisions` | Analyze static collision layers, masks and shapes in a Godot project. |
| `get_context_pack`   | Build a read-only context pack.                                       |
| `get_godot_version`  | Read the configured Godot version.                                    |
| `get_node_semantics` | Read semantic labels and recognized components from a Godot scene.    |
| `get_project_info`   | Read project metadata and files.                                      |
| `get_scene_tree`     | Read a static Godot scene tree.                                       |
| `git_checkpoint`     | Capture Git checkpoint evidence.                                      |
| `git_recovery`       | Reverse an explicit patch.                                            |
| `list_projects`      | Find Godot projects below a directory.                                |
| `read_project_file`  | Read a text file inside a Godot project.                              |
| `read_scene_file`    | Read a Godot .tscn scene file.                                        |
| `search_project`     | Search project text files and return compact matching lines.          |
| `write_project_file` | Write a text file inside a Godot project.                             |
| `write_scene_file`   | Save a Godot .tscn scene file after explicit content edits.           |

## runtime (32)

Registration: [`src/mcp/tools/runtime.ts`](../src/mcp/tools/runtime.ts).

| Tool                         | Purpose                                                               |
| ---------------------------- | --------------------------------------------------------------------- |
| `ack_event_subscription`     | Acknowledge a received event cursor for reconnect-safe delivery.      |
| `call_runtime_bridge`        | Send a JSON-RPC request to a persistent Godot runtime bridge session. |
| `call_runtime_method`        | Call a script or engine method on a running Godot node.               |
| `cancel_event_subscription`  | Cancel a persistent runtime event subscription.                       |
| `cancel_project`             | Cancel a process.                                                     |
| `cancel_run`                 | Cancel an isolated run by its run id.                                 |
| `capture_runtime_screenshot` | Capture a runtime PNG.                                                |
| `close_event_subscription`   | Close a runtime event subscription permanently.                       |
| `create_event_subscription`  | Create a resumable runtime event subscription.                        |
| `create_runtime_node`        | Create a node in the running Godot scene.                             |
| `delete_runtime_node`        | Delete a node from the running Godot scene.                           |
| `get_game_state`             | Read selected runtime properties.                                     |
| `get_process_status`         | Inspect process state.                                                |
| `get_runtime_events`         | Read runtime events from a cursor.                                    |
| `get_runtime_property`       | Read a runtime property.                                              |
| `get_runtime_scene_tree`     | Query runtime scene tree.                                             |
| `get_specialized_state`      | Read specialized runtime state.                                       |
| `inject_runtime_input`       | Inject a runtime key event.                                           |
| `launch_project`             | Launch a Godot project.                                               |
| `list_active_runs`           | List currently active isolated runs.                                  |
| `list_event_subscriptions`   | List persisted runtime event subscriptions.                           |
| `list_runs`                  | List isolated runs and detect orphans.                                |
| `open_runtime_bridge`        | Open a persistent Godot runtime bridge session.                       |
| `pause_event_subscription`   | Pause a runtime event subscription.                                   |
| `poll_event_subscription`    | Poll a subscription and advance its persistent cursor.                |
| `query_runtime_collisions`   | Query runtime collisions and history.                                 |
| `reclaim_orphan_runs`        | Reclaim orphaned processes recorded by the run registry.              |
| `set_runtime_property`       | Write and read back a runtime property.                               |
| `stop_project`               | Stop a process.                                                       |
| `stop_run`                   | Stop an isolated run by its run id.                                   |
| `stop_runtime_bridge`        | Stop a persistent Godot runtime bridge session.                       |
| `subscribe_runtime_events`   | Subscribe to runtime events with resumable cursor and filters.        |

## diagnostics (2)

Registration: [`src/mcp/tools/diagnostics.ts`](../src/mcp/tools/diagnostics.ts).

| Tool                       | Purpose                                                   |
| -------------------------- | --------------------------------------------------------- |
| `analyze_script_semantics` | Analyze GDScript structure and state-machine transitions. |
| `get_debug_output`         | Read process evidence.                                    |

## scenario (7)

Registration: [`src/mcp/tools/scenario.ts`](../src/mcp/tools/scenario.ts).

| Tool                      | Purpose                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `begin_client_repair`     | Run strict validation and return failure evidence plus explicitly allowed source files for the client model. Does not apply edits.                                                    |
| `dev_loop`                | Edit existing files, run fresh Godot validation, inspect diagnostics and rendered screenshots, apply approved exact repair patches and revalidate. Not an autonomous patch generator. |
| `execute_scenario`        | Execute a declarative Godot scenario with shared timeout and evidence semantics.                                                                                                      |
| `reload_scene`            | Reload the current or requested scene in a persistent bridge.                                                                                                                         |
| `run_test_scene`          | Run a Godot test scene through the scenario executor.                                                                                                                                 |
| `submit_repair_candidate` | Verify an explicitly approved client-generated patch against the original fixed conditions. Same session required; failed candidates roll back.                                       |
| `wait_for_event`          | Wait for a runtime event in a bridge session.                                                                                                                                         |

## evidence (2)

Registration: [`src/mcp/tools/evidence.ts`](../src/mcp/tools/evidence.ts).

| Tool                  | Purpose                                           |
| --------------------- | ------------------------------------------------- |
| `compare_screenshots` | Compare two PNG screenshots with RGBA pixel diff. |
| `get_recent_evidence` | Read recent evidence artifacts.                   |

## Keep this page aligned

When adding or removing a tool, change its domain module, update [`tool-registry.test.ts`](../tests/tool-registry.test.ts), add behavior tests, refresh this catalog from `tools/list`, and update both README counts. Do not add declarations to the composition root. HTTP policy checks live in [`access-policy.ts`](../src/mcp/access-policy.ts); a newly registered tool also needs an explicit permission decision.

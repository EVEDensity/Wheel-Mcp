# Godot MCP tool catalog for Codex/Cursor clients

> **Product boundary:** Wheel-mcp provides Godot MCP capabilities for Codex, Cursor and other MCP clients. Planning and candidate generation stay in the client; the server performs bounded, authorized operations and returns diagnostics/evidence. No model-provider or autonomous task orchestration is added. See the [scope and implementation plan](PRODUCTION-MAIN-ASSISTANT-ROADMAP.zh-CN.md).

[English README](../README.md) | [中文说明](../README.zh-CN.md)

Current source catalog: **October 17, 2026**, `0.2.7`, **71 tools** (project 23, runtime 33, diagnostics 4, scenario 8, evidence 3). The official SDK discovery test checks the exact tool list, this catalog and permission classification against the five registration modules. Editor authoring/resource/save additions are explicitly opt-in, scoped and approval-controlled; tool count is not production qualification. A read-only discovery profile exposes a smaller subset.

Use MCP `tools/list` on your running server for current schemas, defaults and required fields. This page is navigation, not a substitute for schema discovery. Tool count is not a gameplay-correctness score.

Current transaction migration: project text/scene writes, `dev_loop` edits and client repair candidates require host-mediated approval of the exact plan. `approved:true` is not authorization. Without form elicitation, writes fail closed unless the host separately configures an exact local preauthorization policy. File writers validate engine file candidates by default; explicit raw writes report validation as NOT_RUN. Failed verified candidates roll back. `git_recovery` is limited to regular UTF-8 text patches previewed in a disposable mirror and then applied through the same journal. See [transaction and migration contract](production-roadmap/TRANSACTION-CONTRACT.md) for limits, safe retry parameters and recovery.

## Choose the right lifetime

- Static project tools inspect files without a running game.
- `get_editor_state` inspects an already-enabled, authenticated editor, not a game process. It reports unsaved scenes and selection without saving or mutating them. See [manual authorization and editor plane contract](production-roadmap/EDITOR-BRIDGE-CONTRACT.md).
- `open_runtime_bridge` / `call_runtime_bridge` / `stop_runtime_bridge` keep one live game session; use the returned `sessionId` for interactions that must share state.
- MCP `launch_project` / `open_runtime_bridge` default to `headless: true` (no game window). Screenshots require a real renderer. `capture_runtime_screenshot` and screenshot-enabled `dev_loop` start off-screen and minimize an unfocusable window by default. For persistent screenshots open `headless:false, background:true` and reuse the session; for an intentional visible bridge preview use `headless:false, background:false`. A taskbar entry and OS/driver error dialogs may remain. Existing headless sessions have no screenshot framebuffer.
- Legacy one-shot runtime tools launch separate work; do not assume a prior call's input or mutation survives.
- `dev_loop` owns a fresh runtime and cleanup for a bounded validation; `run_test_scene` uses the Scenario schema, not the `dev_loop` schema.
- Bridge RPC names such as `get_property` are not standalone MCP tool names. They belong in the appropriate bridge/loop method field.

There are **no standalone `get_script_errors` or `get_runtime_errors` MCP tools in this snapshot**. Use `dev_loop` diagnostic evidence and `get_debug_output` for collected logs; `analyze_script_semantics` is heuristic only. `query_script_semantics` requires an authorized local editor with a verified LSP listener and remains read-only.

## project (23)

Registration: [`src/mcp/tools/project.ts`](../src/mcp/tools/project.ts).

| Tool                            | Purpose                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `analyze_collisions`            | Analyze static collision layers, masks and shapes in a Godot project.                                                                      |
| `get_context_pack`              | Build a read-only context pack.                                                                                                            |
| `get_editor_state`              | Read the authorized editor scene, dirty state, selection and filesystem; never auto-enable.                                                |
| `apply_editor_scene`            | Exact approved native batch, bounded UI layout/Container ownership, scoped resources and one Undo/Redo; does not save.                     |
| `import_project_png`            | Exact approved project-local PNG bytes (max 2 MiB), isolated native import/load before commit and optional live-editor confirmation.       |
| `move_project_scene`            | Exact approved scene move and reliable reference impact; isolated engine validation without old source, UID preserved; close editor first. |
| `get_editor_scene_operation`    | Query original-session operation outcome after an uncertain submission; no blind replay.                                                   |
| `manage_editor_resource`        | Manage bounded owner/session handles; 14 declared types including Theme and flat styles; typed Theme items.                                |
| `save_editor_resource`          | Native export/readback and exact approved transactional .tres save; return fresh reference.                                                |
| `save_editor_scene`             | Native scene export + isolated engine validation + approved commit + observable filesystem sync; dirty marker retained.                    |
| `write_validated_project_files` | Validate an exact approved multi-file candidate in isolated res:// context before committing.                                              |
| `get_godot_version`             | Read the configured Godot version.                                                                                                         |
| `get_node_semantics`            | Read semantic labels and recognized components from a Godot scene.                                                                         |
| `get_project_info`              | Read project metadata and files.                                                                                                           |
| `get_scene_tree`                | Read a static Godot scene tree.                                                                                                            |
| `git_checkpoint`                | Capture Git checkpoint evidence.                                                                                                           |
| `git_recovery`                  | Reverse an explicit patch.                                                                                                                 |
| `list_projects`                 | Find Godot projects below a directory.                                                                                                     |
| `read_project_file`             | Read a text file inside a Godot project.                                                                                                   |
| `read_scene_file`               | Read a Godot .tscn scene file.                                                                                                             |
| `search_project`                | Search project text files and return compact matching lines.                                                                               |
| `write_project_file`            | Write a text file inside a Godot project.                                                                                                  |
| `write_scene_file`              | Save a Godot .tscn scene file after explicit content edits.                                                                                |

File writers default to engine validation for `.gd/.tscn/.tres` and require write + run plus an approved Godot executable. Explicit `validationMode:"raw"` requires separate risk approval and returns `validation:NOT_RUN`. Dirty editor scenes cannot be overwritten by ordinary file tools. See [safe-save and migration](production-roadmap/SAFE-SAVE-CONTRACT.md).

## runtime (33)

Registration: [`src/mcp/tools/runtime.ts`](../src/mcp/tools/runtime.ts).

| Tool                           | Purpose                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `ack_event_subscription`       | Acknowledge a received event cursor for reconnect-safe delivery.                       |
| `call_runtime_bridge`          | Send a JSON-RPC request to a persistent Godot runtime bridge session.                  |
| `call_runtime_method`          | Call a script or engine method on a running Godot node.                                |
| `cancel_event_subscription`    | Cancel a persistent runtime event subscription.                                        |
| `cancel_project`               | Cancel a process.                                                                      |
| `cancel_run`                   | Cancel an isolated run by its run id.                                                  |
| `capture_runtime_screenshot`   | Capture a runtime PNG.                                                                 |
| `close_event_subscription`     | Close a runtime event subscription permanently.                                        |
| `create_event_subscription`    | Create a resumable runtime event subscription.                                         |
| `create_runtime_node`          | Create a node in the running Godot scene.                                              |
| `delete_runtime_node`          | Delete a node from the running Godot scene.                                            |
| `get_game_state`               | Read selected runtime properties.                                                      |
| `get_process_status`           | Inspect process state.                                                                 |
| `get_runtime_events`           | Read runtime events from a cursor.                                                     |
| `get_runtime_operation_status` | Read the owning session's write receipt without repeating a mutation.                  |
| `get_runtime_property`         | Read a runtime property.                                                               |
| `get_runtime_scene_tree`       | Query runtime scene tree.                                                              |
| `get_specialized_state`        | Read bounded native state, including Camera3D and read-only NavigationAgent3D.         |
| `inject_runtime_input`         | Inject a runtime key event.                                                            |
| `launch_project`               | Launch in the background by default; explicit `headless:false` previews.               |
| `list_active_runs`             | List currently active isolated runs.                                                   |
| `list_event_subscriptions`     | List persisted runtime event subscriptions.                                            |
| `list_runs`                    | List isolated runs and detect orphans.                                                 |
| `open_runtime_bridge`          | Open a persistent Godot runtime bridge session.                                        |
| `pause_event_subscription`     | Pause a runtime event subscription.                                                    |
| `poll_event_subscription`      | Poll a subscription and advance its persistent cursor.                                 |
| `query_runtime_collisions`     | Query legacy 2D or physics-scheduled 3D overlap/ray/shape samples; not contact events. |
| `reclaim_orphan_runs`          | Reclaim orphaned processes recorded by the run registry.                               |
| `set_runtime_property`         | Write and read back a runtime property.                                                |
| `stop_project`                 | Stop a process.                                                                        |
| `stop_run`                     | Stop an isolated run by its run id.                                                    |
| `stop_runtime_bridge`          | Stop a persistent Godot runtime bridge session.                                        |
| `subscribe_runtime_events`     | Subscribe to runtime events with resumable cursor and filters.                         |

## diagnostics (4)

Registration: [`src/mcp/tools/diagnostics.ts`](../src/mcp/tools/diagnostics.ts).

| Tool                       | Purpose                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analyze_script_semantics` | Heuristic GDScript structure/state summary; no parser diagnostics or safe refactor authority.                                                               |
| `query_script_semantics`   | Authorized local Godot LSP symbols, references, definitions and syntax diagnostics; raw references can include comments/strings and never authorize rename. |
| `get_debug_output`         | Read process evidence.                                                                                                                                      |
| `preview_script_rename`    | Read-only definition-checked LSP rename candidate and impact review; never writes or authorizes a refactor.                                                 |

## scenario (8)

Registration: [`src/mcp/tools/scenario.ts`](../src/mcp/tools/scenario.ts).

| Tool                       | Purpose                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `begin_client_repair`      | Run strict validation and return failure evidence plus explicitly allowed source files for the client model. Does not apply edits.                                                    |
| `get_client_repair_status` | Read same-session repair/candidate status after an uncertain response; never applies or retries a patch.                                                                              |
| `dev_loop`                 | Edit existing files, run fresh Godot validation, inspect diagnostics and rendered screenshots, apply approved exact repair patches and revalidate. Not an autonomous patch generator. |
| `execute_scenario`         | Execute a declarative Godot scenario with shared timeout and evidence semantics.                                                                                                      |
| `reload_scene`             | Reload the current or requested scene in a persistent bridge.                                                                                                                         |
| `run_test_scene`           | Run a Godot test scene through the scenario executor.                                                                                                                                 |
| `submit_repair_candidate`  | Verify an explicitly approved client-generated patch against the original fixed conditions. Same session required; failed candidates roll back.                                       |
| `wait_for_event`           | Wait for a runtime event in a bridge session.                                                                                                                                         |

## evidence (3)

Registration: [`src/mcp/tools/evidence.ts`](../src/mcp/tools/evidence.ts).

| Tool                  | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `compare_screenshots` | Compare two PNG screenshots with RGBA pixel diff.         |
| `get_recent_evidence` | Read recent evidence artifacts.                           |
| `get_response_page`   | Read the next owner-bound response page using its cursor. |

## Keep this page aligned

For a Chinese feature-by-feature summary, explicit unsupported cases and proposed priorities, see [功能现状与后续计划](FEATURE-STATUS.zh-CN.md).

When adding or removing a tool, change its domain module, update [`tool-registry.test.ts`](../tests/tool-registry.test.ts), add behavior tests, refresh this catalog from `tools/list`, and update both README counts. Do not add declarations to the composition root. HTTP policy checks live in [`access-policy.ts`](../src/mcp/access-policy.ts); a newly registered tool also needs an explicit permission decision.

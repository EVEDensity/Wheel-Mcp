# dev_loop: bounded development verification and repair

`dev_loop` is a high-level MCP tool, not an alias for `execute_scenario`.
It applies exact edits, starts a private persistent Godot runtime, waits for an
event, performs actions, evaluates assertions, captures/compares a screenshot,
reads diagnostics, stops the runtime, and optionally tries an approved repair.
It does **not** generate arbitrary fixes using a model.

## Example MCP arguments

Replace the example absolute paths with your own. Import the project in Godot
first so its imported resources are available. The bridge is the repository's
`godot-plugin/runtime_bridge.gd` file.

```json
{
  "projectPath": "D:/games/example",
  "godotPath": "D:/tools/Godot_v4.7.2-stable_win64_console.exe",
  "bridgePath": "D:/tools/mcp/godot-plugin/runtime_bridge.gd",
  "evidenceDir": "D:/evidence/example",
  "scenePath": "res://main.tscn",
  "checks": [
    {
      "id": "health",
      "method": "get_property",
      "params": { "nodePath": ".", "property": "health" },
      "path": "value",
      "op": "equals",
      "expected": 100
    }
  ],
  "repairs": [
    {
      "id": "restore-starting-health",
      "whenFailedCheckId": "health",
      "edits": [{ "path": "main.gd", "find": "health = 0", "replace": "health = 100" }]
    }
  ],
  "maxRetries": 1,
  "screenshot": true,
  "diagnosticsScope": "including-shutdown",
  "rollbackOnFailure": true,
  "timeoutMs": 120000,
  "responseMode": "compact"
}
```

This example assumes `main.gd` has the exact text `health = 0`, attached to the
scene root. Supply checks and edits appropriate to your game; it is not a
universal repair recipe.

## Execution and validation

- `edits`: optional initial edits before the first run. Each `find` must identify
  an unambiguous exact occurrence. `expectedSha256` can guard the original text.
- `waitEvent`: runtime event to await; defaults to `level_started`.
- `actions`: ordered bridge operations: `inject_input`, `wait_physics_frames`,
  or `call_method`. Use tagged vectors for method arguments, e.g.
  `{ "type": "Vector2", "x": 260, "y": 126 }`.
- `checks`: at least one explicit assertion. Read with `get_property`,
  `get_scene_tree`, `get_specialized_state`, `get_game_state`, or
  `query_collisions`. `path` selects a dot-separated response field; operators
  are `equals`, `includes`, `greater`, and `exists`.
- `repairs`: caller-approved exact patches selected by failed check ID.
  Reserved failure IDs `diagnostics` and `screenshot` can also select a repair.
  Each candidate is used at most once, with a fresh runtime for verification.
- `maxRetries`: additional attempts, not total attempts; default 1, maximum 10.
- `screenshot`: uses a non-headless runtime and validates the decoded PNG.
  A real available renderer is required. Static/low-power scenes explicitly
  request a render before waiting for the framebuffer. Capture is bounded.
- `baselinePath`: enables pixel comparison against an existing PNG.
  `threshold` defaults to 8; `maxDifferenceRatio` defaults to 0.
- `diagnosticsScope`: defaults to `including-shutdown`. `runtime` excludes
  exit-phase errors from the PASS gate, but retains them in `allDiagnostics`.
  Do not use the latter to claim resource-leak-free shutdown.
- `maxErrors`: diagnostic error budget, default zero.

## Failure, ownership, and evidence

Only existing valid UTF-8 files up to 8 MiB are editable. Traversal, symlinks,
Windows alternate streams and reserved internal directories are rejected.
An edit batch validates before writing. A canonical project lease prevents
concurrent `dev_loop` calls in the same server process; it is not an OS-wide
lock and does not block an external editor or other tool.

On final failure, timeout, or cancellation, rollback is enabled by default.
If another writer changed a file, rollback preserves that file and reports a
conflict instead of overwriting it. Inspect the full result after any failure.
A separate cleanup budget stops the private Godot process. Cancellation
cleanup and project-lease release are covered by real Godot tests.

Each `evidenceDir/dev-loop-<id>/` contains full `result.json`, edit backups,
and per-attempt logs, checks, bridge evidence and screenshots/diffs. Compact
responses reduce payload size; they do not replace full evidence. In particular,
consult `rolledBack`, `rollbackConflicts`, `error`, `attempts`, and `cleanup`
in the saved result. Keep evidence private: backups and logs can contain source
code and project data.

This is **not a sandbox** for untrusted Godot projects: project scripts and
explicit method calls execute native application behavior. HTTP callers need
both write and run authorization; project, scene, baseline and evidence paths
must satisfy the configured client policy.

## Compatibility and remaining boundaries

The former scenario-shaped alias is replaced by the schema above. Use
`execute_scenario` for existing scenario documents. This loop does not include
an LLM patch generator, editor import automation, arbitrary file creation, or
proof that assertions cover all game behavior. The external MCP client chooses
requirements, diagnosis strategy, assertions and patch candidates.

For measured results and project locations, see
`docs/REPAIR-BENCHMARK-2026-09-13.md` and
`benchmarks/repair-results-2026-09-13.json`.

## Client model integration and strict exit diagnostics

For model-generated proposals use [the client repair protocol](CLIENT-REPAIR.md),
not an unbounded list of server-generated edits. Each approved candidate is
verified with the original plan and no internal retries.

Each attempt now records runtimeDiagnostics before stopping, allDiagnostics
after process close, shutdownDiagnostics as an occurrence-count delta, and
shutdown metadata (forced, exitCode, signal). The reserved shutdown check rejects
ObjectDB/resource/RID leak warnings in strict mode. Forced/nonzero exits make
cleanup fail; they are not presented as graceful success. Startup failure and
final output drainage are bounded and logs remain available.

The bridge stops audio, animation and timers before freeing scene-owned nodes.
It does not blanket-free arbitrary detached project objects or suppress exit
errors. See [paired results and the RPG ownership fix](HISTORICAL-DEFECTS.md).

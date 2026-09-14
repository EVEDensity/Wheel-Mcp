# Controlled upstream game repair benchmark - 2026-09-13

## What was actually tested

Official MCP SDK Client -> stdio MCP Server -> Persistent Runtime Bridge ->
real Windows Godot, with a windowed renderer and decoded PNG evidence.
Seven upstream game/demo projects received one deliberately seeded defect each.
A caller supplied an exact inverse repair; the tool detected assertion failure,
applied that approved patch, restarted Godot, and rechecked behavior.
This is a bounded repair loop, not arbitrary autonomous patch synthesis.
The upstream projects were NOT authored by this MCP.

The corpus was also used to calibrate/debug the harness. It is not a held-out
set of unknown historical bugs. Results must not be extrapolated to all games.

## Reproducibility

- Godot: `4.7.2.stable.official.ed1daf0bf`, Windows.
- Upstream: `https://github.com/godotengine/godot-demo-projects`, MIT.
- Revision: `a3b5c113112f77291d5f3d1360f33a882fdc52f7`.
- Raw report: `runs\repair-benchmark\2026-09-13T10-30-29.327Z/report.json`.
- Actual MCP requests/responses: `runs\repair-benchmark\2026-09-13T10-30-29.327Z/mcp-transcript.json`.
- Implementation hashes: `runs\repair-benchmark\2026-09-13T10-30-29.327Z/code-hashes.json`.
- Source license: `runs\repair-benchmark\2026-09-13T10-30-29.327Z/UPSTREAM-LICENSE.md`.
- Trackable summary: `benchmarks/repair-results-2026-09-13.json`.

## Results

Each category has healthy PASS, broken FAIL (detected), approved repair PASS,
independent rerun PASS, rejected ineffective repair FAIL, and granular repair
PASS. There is exactly one seeded defect per category.

| Category     | Repair | Loop time (ms) | Granular time (ms) | Granular calls | Loop calls | PNG size   |
| ------------ | -----: | -------------: | -----------------: | -------------: | ---------: | ---------- |
| Platformer   |    1/1 |           4083 |               3882 |             22 |          1 | 1600 x 960 |
| Top-down RPG |    1/1 |           4902 |               4719 |             22 |          1 | 1280 x 720 |
| 2D action    |    1/1 |           4188 |               3905 |             24 |          1 | 480 x 720  |
| UI intensive |    1/1 |           3341 |               3335 |             18 |          1 | 1152 x 648 |
| Navigation   |    1/1 |           4117 |               3855 |             24 |          1 | 1152 x 648 |
| Audio        |    1/1 |           3728 |               3066 |             20 |          1 | 1152 x 648 |
| Multi-scene  |    1/1 |           4056 |               3991 |             22 |          1 | 1152 x 648 |

- Verified known repairs: **7/7**. Independent rechecks: **7/7**.
- Healthy sample false alarms: **0/7**; seeded defects missed: **0/7**.
- Ineffective repairs incorrectly accepted: **0/7**.
- Repair retries: **7 total**, one additional attempt for each known fix.
- MCP requests: **152 -> 7**, a **95.39%** reduction in this scripted comparison.
- Serialized JSON payload token estimate: **94.61%** lower for compact dev_loop
  versus the fine-grained known-fix workflow.
- Compact versus normal responses for equivalent healthy loops: **75.13%**
  lower estimated payload tokens.
- Mean automatic wall time: **4.06 s** for dev_loop versus **3.82 s** granular.
  No runtime speedup was demonstrated. This is not human/LLM debugging time.

The token estimate is serialized MCP request/response JSON characters / 4.
It includes text and structuredContent representations, but excludes tool
discovery, prompts, conversation history, reasoning and billing. A client may
only expose one response representation to its model. These are payload-size
estimates, NOT an accurate percentage of total model tokens saved.
Universal repair success, population false-positive rate, and exact billable
token savings remain unknown (`null` where applicable in the report).

## Behavioral oracles

- Platformer: zero walk speed -> right input produces horizontal velocity > 50.
- RPG: forced zero direction -> right input moves the player past x = 224.
- Action: zero speed -> new game and input move the player past x = 270.
- UI: disabled button -> the target button's disabled property is false.
- Navigation: zero speed -> reachable target and actual movement past x = 220.
- Audio: inaudible volume -> volume > -40 dB and a real stream is playing.
  This checks engine state, not acoustic output from a speaker.
- Multi-scene: wrong destination -> an actual transition reaches scene_b.

## Important diagnostics qualification

The final benchmark explicitly uses `diagnosticsScope: "runtime"`.
Exit-phase diagnostics are retained in `allDiagnostics` and logs, but do not
fail the gameplay repair oracle. Some upstream demos emitted resource-leak
errors at shutdown; these have NOT been repaired by this benchmark.
The tool default remains `including-shutdown`, which is stricter.

The earlier failed/calibration run is preserved at:
`runs\repair-benchmark\2026-09-13T09-50-45.328Z\report.json`.
That run exposed shutdown diagnostics, static-render screenshot hangs and a
navigation target outside the usable polygon. The final run fixes forced-frame
capture and the target, and explicitly narrows the diagnostic gate as above.

## Open and verify the actual projects

Import a `project.godot` below in Godot. Open the specified scene and press F6
(run current scene), matching the benchmark rather than assuming F5's default.
Sibling `healthy`, `broken`, `wrong-repair`, and `granular` folders preserve the
controls. `repaired` is the copy patched through MCP dev_loop; `granular` was
patched through fine-grained MCP calls. Evidence lives beside those folders.
These large local artifacts are ignored by Git; clone users must regenerate.

### Platformer

- Project: `runs\repair-benchmark\2026-09-13T10-30-29.327Z\platformer\repaired\project.godot`
- Scene: `res://game_singleplayer.tscn`
- Screenshot: `runs\repair-benchmark\2026-09-13T10-30-29.327Z\platformer\evidence\repaired\dev-loop-313917ba-8da7-4629-ae24-24cebb35045d\attempt-1\screenshot.png`

### Top-down RPG

- Project: `runs\repair-benchmark\2026-09-13T10-30-29.327Z\rpg\repaired\project.godot`
- Scene: `res://game.tscn`
- Screenshot: `runs\repair-benchmark\2026-09-13T10-30-29.327Z\rpg\evidence\repaired\dev-loop-ea46748f-b522-4652-a3e9-d0cd6cc9b9c4\attempt-1\screenshot.png`

### 2D action

- Project: `runs\repair-benchmark\2026-09-13T10-30-29.327Z\action\repaired\project.godot`
- Scene: `res://main.tscn`
- Screenshot: `runs\repair-benchmark\2026-09-13T10-30-29.327Z\action\evidence\repaired\dev-loop-7cc5f88f-19cf-40fe-9eab-7bb042e2663f\attempt-1\screenshot.png`

### UI intensive

- Project: `runs\repair-benchmark\2026-09-13T10-30-29.327Z\ui\repaired\project.godot`
- Scene: `res://control_gallery.tscn`
- Screenshot: `runs\repair-benchmark\2026-09-13T10-30-29.327Z\ui\evidence\repaired\dev-loop-1fe05d5b-5f4e-45ef-86af-08b7ed29dd6b\attempt-1\screenshot.png`

### Navigation

- Project: `runs\repair-benchmark\2026-09-13T10-30-29.327Z\navigation\repaired\project.godot`
- Scene: `res://navigation.tscn`
- Screenshot: `runs\repair-benchmark\2026-09-13T10-30-29.327Z\navigation\evidence\repaired\dev-loop-03510a7f-e0f8-4afe-ac2a-29c3871973a9\attempt-1\screenshot.png`

### Audio

- Project: `runs\repair-benchmark\2026-09-13T10-30-29.327Z\audio\repaired\project.godot`
- Scene: `res://generator.tscn`
- Screenshot: `runs\repair-benchmark\2026-09-13T10-30-29.327Z\audio\evidence\repaired\dev-loop-068962a5-4287-4675-bea3-b5f63a364da3\attempt-1\screenshot.png`

### Multi-scene

- Project: `runs\repair-benchmark\2026-09-13T10-30-29.327Z\multi-scene\repaired\project.godot`
- Scene: `res://scene_a.tscn`
- Screenshot: `runs\repair-benchmark\2026-09-13T10-30-29.327Z\multi-scene\evidence\repaired\dev-loop-01b20c21-b7ef-4aa5-9984-db5db3c19be9\attempt-1\screenshot.png`

## Repeat the experiment

Set `GODOT_PATH`, obtain the pinned demo checkout, then run
`npm run benchmark:repair`. See `benchmarks/README.md` for prerequisites.
If npm is unavailable but dependencies are installed, run the same underlying
build and benchmark scripts with your Node executable:

```powershell
& $node node_modules/typescript/bin/tsc
& $node scripts/repair-benchmark.mjs
```

This machine used the latter form; npm was not available on the task PATH.
The package remains `0.1.0-preview.1`; this experiment does not independently
justify a stable public release or broad compatibility claims.

## Final local quality gates

Rechecked on 2026-09-13 after the implementation and documentation work:

- TypeScript build: PASS.
- Prettier (`src tests godot-plugin *.json`): PASS.
- ESLint (`src tests`): PASS.
- Full Node test run with `GODOT_PATH` and `--test --test-concurrency=1`:
  **74 passed, 0 failed, 0 skipped**.
- Real runtime matrix: PASS, including `stop_project`,
  `cancel_project-repeat`, `scenario`, and `screenshot`.
- Release-check script: PASS for **0.1.0-preview.1**.
- All seven implementation/evidence hash entries still match the benchmark.
- All seven repaired `project.godot` files exist. The platformer screenshot
  was also visually inspected; it contains the rendered game, not a blank image.

The task environment had no npm on PATH, so build/format/lint/tests and
`scripts/release-check.mjs` were invoked with the installed Node executable
rather than claiming literal `npm run` execution. Local final logs:
`.harness/final-test-results.txt` and `.harness/final-release-check.json`.
Release-check validates this preview's configured gate, not arbitrary game
correctness, every security property, or stable-release readiness.

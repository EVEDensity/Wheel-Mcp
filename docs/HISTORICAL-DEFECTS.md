# Historical defect evaluation and strict shutdown follow-up

## Independence and frozen conditions

The manifest [historical-defects.v1.json](../benchmarks/historical-defects.v1.json)
was registered at `2026-09-13T11:27:51.332643Z`, before runtime evaluation.
Its exact SHA-256 is:

```text
ad411bab40b841018fd413e1145a83ce4156ff52f8ca232b7929c3c29031ffab
```

Do not format or edit this frozen file to improve a result. A changed corpus
needs a new version/hash and separate results. The three projects were excluded
from the earlier seven seeded categories. Their real upstream commits were
source-reviewed to establish provenance: **not blind to the developer and not
a held-out model-generation benchmark**. Claims of stronger independence would
require a separate curator/model experiment that has not been performed.

Source: [godotengine/godot-demo-projects](https://github.com/godotengine/godot-demo-projects),
MIT license. Every case pins both a buggy commit and its historical fixing
commit. The runner reads project blobs by the object IDs of those pinned Git
trees; it does not synthesize a known reverse patch in the latest game.

| Case            | Historical fix                                                                                                 | Reproduction and allowed candidate files                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Tween parser    | [9ed97d10](https://github.com/godotengine/godot-demo-projects/commit/9ed97d10cac6750ec2f84441d2a7c64b3f527a08) | Closing-parenthesis indentation; `main.gd`                                                                  |
| FSM empty start | [8847de9c](https://github.com/godotengine/godot-demo-projects/commit/8847de9ca00dad9b56f4a2552c9e2e54d915edd6) | Empty start-state configuration, applied identically to buggy/fixed scene; `state_machine/state_machine.gd` |
| Custom drawing  | [045a68c5](https://github.com/godotengine/godot-demo-projects/commit/045a68c51b5b8691ab15880467fff87e18dd065f) | Missing script declaration and project main-scene UID; **`meshes.gd` and `project.godot`**                  |

Frozen checks require the scene to load; the FSM also requires an initialized
current state. Actions wait 12 physics frames. All runtime verdicts use
including-shutdown diagnostics and maxErrors=0. Screenshots require non-headless
rendering. Custom drawing does not override the entry scene: project.godot's
actual entry is part of what must work. These are targeted regression oracles,
not full-game correctness or gameplay-quality tests.

## Per-case procedure

1. Materialize separate buggy and upstream-fixed directories; retain upstream
   license and editor import logs. Apply the frozen reproduction to both.
2. Call `begin_client_repair` on buggy, requiring NEEDS_REPAIR with clean process
   cleanup; call strict `dev_loop` on the fixed control, requiring PASS.
3. Submit an explicitly approved **ineffective whitespace candidate**, requiring
   FAIL and byte/hash restoration of all selected files.
4. Submit the client-approved recorded upstream fix, requiring PASS.
5. Independently call `dev_loop` again, requiring PASS with valid screenshot.

The proposal source says `upstream-commit:<hash>`, not a live model name.
Two submissions are used per reproduced case: the first intentionally fails.
Do not call this “zero failures” or “one-shot model repair.” The negative
controls demonstrate rejection/rollback, not every possible incorrect patch.

## Results and preparation failures

First attempts preserved:

| Timestamp (UTC)     | Outcome                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| 2026-09-13 11:38:19 | 3 preparation failures: git archive triggered unavailable promisor blob fetch; **no runtime started**           |
| 2026-09-13 11:49:02 | 3 preparation failures: direct project blob fetch still failed via GitHub Git transport; **no runtime started** |
| 2026-09-13 11:53:47 | First actual runtime evaluation: all three controls/candidates completed                                        |

The GitHub codeload endpoint was reachable. Complete project blobs recovered
from an exact-commit archive were put in the local Git object store. Even though
the large archive download ended early, only fully read blobs were cached; the
runner required the exact object IDs in the pinned trees. No manifest, source
assertion, error budget or historical patch was tuned after a failed runtime.

| Case              | Buggy        | Fixed control | Ineffective candidate | Upstream candidate | Independent rerun |
| ----------------- | ------------ | ------------- | --------------------- | ------------------ | ----------------- |
| Tween             | NEEDS_REPAIR | PASS          | FAIL + rollback       | PASS               | PASS              |
| FSM               | NEEDS_REPAIR | PASS          | FAIL + rollback       | PASS               | PASS              |
| Drawing (2 files) | NEEDS_REPAIR | PASS          | FAIL + rollback       | PASS               | PASS              |

**Runtime denominator: 3 completed cases; 3/3 verified historical fixes; 3/3
ineffective candidates rejected.** Preparation failures are retained separately,
not called model failures and not erased by the successful source retry.
There is no live-provider success rate, general false-positive rate, human
repair-time estimate or billing-token measurement in this evaluation.

See [portable summary](../benchmarks/historical-results-2026-09-13.json) for
sizes, durations, paths and hashes. Full local evidence:
`runs/historical-repair/2026-09-13T11-53-47.424Z/` contains report, transcript,
frozen manifest, projects, import logs and per-candidate evidence. Prior failed
reports remain under their original timestamp directories.

## Reproduce on Windows

1. Build this repository with `npm ci` and `npm run build`.
2. Prepare a Git checkout containing the six pinned commits **and their blobs**.
   A full upstream clone is simplest; a shallow/promisor clone may require
   fetching historical commits and missing objects. The runner does not change
   source-checkout HEAD or silently substitute a newer revision.
3. Set the executable and source checkout, with a working desktop renderer:

```powershell
$env:GODOT_PATH = 'D:\tools\Godot_v4.7.2-stable_win64_console.exe'
$env:GODOT_DEMO_SOURCE = 'D:\sources\godot-demo-projects'
npm run benchmark:historical
```

Default source location is `.harness/benchmark-sources/godot-demo-projects`.
Each run creates a fresh timestamp directory and verifies the frozen hash.
The report distinguishes preparation errors from completed runtime failures;
harness/preparation errors set a nonzero process exit code. A completed
experiment can record non-PASS behavior: inspect every report verdict, not just
the command's exit code. Do not discard a failing fixed control or weaken its
checks to make the aggregate look better.

The original first runner lacked the improved preparation-error count/exit
code. Its complete failed report is preserved as originally written, and the
small published summary correctly labels it as a preparation failure.

## Strict cleanup: separate seven-project paired evaluation

The earlier seeded benchmark used runtime-only diagnostics. To test the actual
exit phase, `scripts/strict-shutdown-benchmark.mjs` replayed the original gameplay
assertions and windowed screenshots on the same seven already-repaired projects.
Only the bridge teardown changed: the old bridge is pinned to commit `abfc3fb`,
not a moving HEAD. The current Node server used identical strict interpretation
for both bridges. Each run retained exit errors and explicit cleanup outcomes.

| Project     | Old bridge       | New bridge       |
| ----------- | ---------------- | ---------------- |
| Platformer  | FAIL             | PASS             |
| RPG         | FAIL (22 errors) | FAIL (22 errors) |
| Action      | FAIL             | PASS             |
| UI          | PASS             | PASS             |
| Navigation  | PASS             | PASS             |
| Audio       | PASS             | PASS             |
| Multi-scene | PASS             | PASS             |

**4/7 -> 6/7**, without filtering shutdown diagnostics. The bridge quiesces
players/animations/timers, disables process work, releases scene-owned nodes,
waits for deferred release, then quits. Node waits for process close/output
completion; non-exit after stop acknowledgment is force-reaped and reported.
Intentional `_exit_tree` errors and true orphan leaks still fail dedicated tests.

Data: [paired summary](../benchmarks/strict-shutdown-results-2026-09-13.json).
Local raw pairs: `runs/strict-shutdown/2026-09-13T11-35-45.230Z/`.
Reproduction requires the earlier seeded projects and transcript referenced by
`benchmarks/repair-results-2026-09-13.json` (or a reproduced summary with matching
paths), plus the pinned baseline commit. Then `npm run benchmark:shutdown`.
It is a paired cleanup experiment, not the independent historical corpus.

## RPG: diagnose project ownership, then verify an explicit candidate

The RPG removes `combat_screen` from the scene tree while retaining its Node
reference. `remove_child` does not transfer its lifetime to the bridge. The
project lacked cleanup for its detached screen subtree. A separate assistant-
reviewed candidate added `_exit_tree` cleanup **only for the two owned screens
when detached**. It did not free every orphan object or suppress any logs.

`scripts/client-repair-rpg.mjs` copies the existing repaired RPG into a new
output directory, diagnoses it through `begin_client_repair`, submits that
explicit candidate, and independently verifies it with the original movement
check, screenshot and strict shutdown. Result: **22 -> 0 errors, PASS and PASS**.
The rendered screenshot is **1280 x 720**. Earlier projects/evidence are unchanged.

Run `npm run benchmark:client-repair-rpg` with the earlier benchmark artifacts
available. Inspect [summary](../benchmarks/client-repair-rpg-2026-09-13.json) and
`runs/client-repair-rpg/2026-09-13T11-57-13.618Z/project/project.godot` locally.
This is disclosed follow-up engineering, **not a fourth independent case or a
reason to rewrite the bridge-only result as 7/7**.

## Next evaluation improvements

- Have a separate curator freeze new bugs and withhold patch content from the
  development/model workflow; keep provenance and independence auditable.
- Use a real client model adapter and record generated failures, approval
  refusals, budgets and complete replays separately from historical controls.
- Add valid-but-wrong semantic patches, import/plugin failures, longer multi-scene
  interactions, and unresolved defects; small startup oracles are insufficient.
- Publish a sanitized evidence bundle with licenses if independent readers must
  validate the exact recorded run without reproducing it on their own machine.

## Final regression (kept separately from the first evaluation)

The completed runner was re-executed against the same immutable manifest at
`runs/historical-repair/2026-09-13T12-22-38.799Z/report.json`. It again recorded
3/3 reproduced defects, 3/3 verified repairs and 3/3 rejected ineffective
candidates, with no preparation or runtime harness errors. This regression
retains both stdout and stderr from editor imports, including imports that
exit zero while emitting parser errors. It does not replace the first runtime
report or remove the earlier acquisition failures.

The [final validation summary](../benchmarks/validation-results-2026-09-13.json)
links this run with the 82/82 default-concurrency test run and the regenerated
19/19 real Windows matrix. Raw logs remain local and ignored; the summary
contains hashes rather than source-bearing transcripts.

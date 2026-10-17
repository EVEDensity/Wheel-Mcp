# Bounded CharacterBody2D gravity and jump

Main development, trusted Windows / Godot 4.7.2 / stdio. This extends the
[native character contract](CHARACTER-2D-CONTRACT.md), not a permanent controller,
keyboard consumption, arbitrary script attachment or CharacterBody3D support.

## Stage 1: host contract and fail-closed capability

`step_character_2d` retains its original three-field behavior when no gravity
is specified. New optional fields require an independently announced
`character.gravity2d/v1` runtime capability in addition to `character.step2d/v1`.
Runtime 0.3.2 and older do not announce gravity: the new host rejects these
requests before dispatch. Upgrade host and runtime plugin explicitly to 0.3.3
for this extension. Editor bridge remains 0.3.7 / 27 capabilities; no implicit
plugin installation, update or script attachment is performed.

- `gravity`: explicit finite acceleration in world +Y, 0..4000 px/s².
- `jumpSpeed`: explicit finite upward impulse, >0..1000 px/s; requires positive
  gravity and zero initial `velocity.y`. No implicit project gravity is read.
- Existing canonical scene-local nodePath, velocity components +/-1000,
  1..30 frames, run/write scope, owned session and operation ID rules remain.
- Result metadata describes actual integration time, requested gravity/impulse,
  whether a jump happened and whether terminal speed was clamped. Normal and
  late replies must match the original path, frame count and dynamics request.
  A metadata-free older result must not masquerade as integrated gravity.

Three fast contract cases supplement all existing tests; no new automatic
engine matrix or longer deadlines. Scope remains 144 core, 73 safety,
19 engine, 2 package cases (238 total).

## Stage 2: bounded native integration

Runtime 0.3.3 integrates gravity before native `move_and_slide` on each commanded
physics frame: y velocity is the previous native result plus gravity times
actual delta, clamped to +/-1000 px/s. Horizontal velocity remains the requested
value. The original world-axis unit transforms, shape-owner identity, ownership,
script/callback refusal and collision/position limits all remain. Gravity mode
additionally requires grounded motion and exactly `Vector2.UP`.

A jump requires both the cached native floor flag and a fresh nonmoving native
`test_move` probe in the first actual physics frame: 0.25 px downward, the body's
safe_margin, recovery_as_collision=false, normal.y <= -0.99. This deliberately
supports flat floors, not arbitrary slopes. Airborne or stale-floor requests
fail before moving; the probe itself does not teleport or move the character.
Jump seeds vertical velocity with -jumpSpeed, then applies the same integration.

Response `dynamics` includes gravity, jumpSpeed (zero when absent), jumped,
speedClamped and actual elapsedSeconds. Delta remains >0..0.1 seconds per frame,
with at most 30 frames / 3 seconds per command. Velocity resets to zero after
each frame. There is no gravity between commands: to continue an arc, explicitly
seed the next request's velocity.y with the previous returned velocity.y.

```json
{"sessionId":"<owned-session>","method":"step_character_2d","operationId":"jump-001","params":{"nodePath":"Player","velocity":{"x":120,"y":0},"frames":6,"gravity":600,"jumpSpeed":200}}
```

Timeout/cancellation is still not rollback; partial motion may remain. Inspect
the original operation ID after UNKNOWN. Exact replay returns the original
result without a second jump; a new ID is not a safe retry. Late results must
match the original dynamics, path and frame count before COMPLETED is recorded.
Only the small closed character request is retained for this correlation, not
arbitrary generic write payloads.

The existing shared native/render fixture now verifies exact freefall
integration, no idle gravity, floor/ceiling normals, jump/landing, fresh-contact
refusal after teleport, impulse/bounds/mode refusal, speed clamping, UNKNOWN
completion, exact replay, unchanged authored bytes and actual restored pixels.
There are no extra engine startups, daily matrices, workers or longer budgets.
Approval remains MOCK; rendered checks are local background-renderer evidence,
not headless screenshots or human approval/focus UX qualification.

Two development failures are retained: initial assertions incorrectly treated
native contact recovery as freeflight and assumed subpixel floor coordinates
would repeat exactly. Freefall still requires the exact integration oracle
(0.001); floor/jump positions are bounded by independently authored geometry
and safe_margin=0.125, with real contact normals and zero restored pixel diff.
Engine settings and deadlines were not loosened to make these assertions pass.
Final qualification must bind this source and its separately recorded CI result;
an earlier stage's green run does not qualify subsequent modifications.

Accepted integration source `bc374af` passed 238/238 hosted bounded checks,
short CI, Pages, installed Codex representative interface probe and independent
downloaded artifact verification. Final local safety 73/73, engine 19/19 and
render/resource checks 3/3 passed; these are not a complete final-source local
release gate. The first hosted safety phase timed out at its unchanged 240s
budget. The corrective stage reuses only this live Node process's successful
OS identity for transaction lock creation, never foreign PID/recovery/stop
reads, and keeps independent OS identity regression assertions. All test cases,
two workers and deadlines remain. See the [stage and failure record](../releases/main-character-gravity-verification.json).
No new tag, Release or npm publication; public v0.2.8 remains unchanged.

References: [CharacterBody2D](https://docs.godotengine.org/en/stable/classes/class_characterbody2d.html)
and [PhysicsBody2D.test_move](https://docs.godotengine.org/en/stable/classes/class_physicsbody2d.html#class-physicsbody2d-method-test-move).

# Bounded native CharacterBody2D

Trusted local Windows / Godot 4.7.2 / stdio development on main, not included in
the immutable public v0.2.8 package. This extends the native scene allowlist,
not arbitrary scripts, CharacterBody3D, RigidBody, navigation or a complete
character/game generator.

## Stage 1: authored native configuration

Upgrade host and editor plugin explicitly together to editor bridge 0.3.7,
`scene.character2d/v1`, maximum 27 capabilities. Read-only remains two. Missing
private write opt-in fails FORBIDDEN first; absent character capability fails
PROTOCOL_MISMATCH. Frame, private metadata, handle, operation and scene limits
are unchanged. No plugin is silently installed or enabled.

Create `CharacterBody2D` via `apply_editor_scene`, then `character_set` with a
nonempty subset of these six fields only:

- `collision_layer`, `collision_mask`: uint32, including zero.
- `motion_mode`: 0 (grounded) or 1 (floating).
- `safe_margin`: finite 0.001..10.
- `max_slides`: integer 1..8.
- `floor_snap_length`: finite 0..100.

Native setters must read back exactly; engine normalization is an error, not
silent success. Transform/visibility edits use the existing `set` operation.
Existing scoped shape handles assign to child CollisionShape2D; Sprite2D is a
separate optional visual child with its own texture/callback contract. Creating
a body does not imply it already has a collision shape or controller.

Velocity is runtime state and is not accepted by `character_set`. A live editor
body with nonzero velocity, drawing/geometry callbacks, scripts or material
dependencies is refused. Native character property/transform writes preserve
signal blocking across Undo/Redo. Approval rechecks the live document, including
callbacks attached or configuration changed while a form is open.

Changes are one native Undo/Redo action, initially unsaved. Separate exact save
approval compares stored character configuration through native packing; actual
editor close/reopen tests compare every stored node/property, shape storage,
visual child and owner, normalizing only ephemeral node/resource identities.
Decline, invalid input, wrong node type and partially invalid batches must leave
the original scene bytes and document unchanged.

Tests: `character-schema.test.ts` (two fast grammar cases) and
`character-native.test.ts` (real Godot/SDK stdio, MOCK exact-plan approval).
All old tests remain; daily CI stays bounded, with native acceptance explicit.
The first development failure was an assertion attempting to read
`structuredContent.code` from an SDK schema error that correctly has only an
error content body. The test now requires the SDK error, the failing field and
unchanged scene/document; it does not reinterpret it as an engine error.

## Stage 2: bounded native runtime command

The fixed-velocity stage below was accepted on runtime 0.3.2. Current runtime
0.3.3 preserves that behavior and adds separately capability-gated finite gravity
and flat-floor jumps; see the [extension contract](CHARACTER-GRAVITY-CONTRACT.md).
Upgrade explicitly; older fixed-motion evidence is not gravity qualification.

Upgrade the runtime bridge explicitly to 0.3.2. Its `step_character_2d` method
requires `character.step2d/v1`, plus existing run/write scope and owned session.
It is a short commanded motion, not keyboard consumption, automatic gravity,
jump logic, a permanent controller or arbitrary script attachment.

```json
{"sessionId":"<owned-session>","method":"step_character_2d","operationId":"move-001","params":{"nodePath":"Player","velocity":{"x":120,"y":0},"frames":6}}
```

Velocity is finite pixels/second, each component within +/-1000; frames is an
integer 1..30. Both the host and native runtime reject extra/invalid fields.
Targets must be canonical scene-local relative paths (or `.` for the scene
root); absolute paths, empty/dot/traversal components, subnames, unique-name
paths and backslashes are rejected. Native containment is checked independently.
Old runtime capabilities fail before dispatch. The command is classified as a
write, binding its exact content to operationId. Same ID/content returns the
original result without movement; different content conflicts.

Execution uses the existing bounded 16-entry physics queue, binds scene and
native node identity, and calls native `move_and_slide` on consecutive physics
frames. Recheck the script-free body, stationary between steps, processing
enabled, finite position within +/-100000 and delta 0..0.1 seconds (zero
excluded), 1..8 slides and margin 0.001..10. Only world-axis unit body/shape
transforms, 1..8 direct native rectangle/circle/capsule shape owners, no one-way
shape, script or geometry callbacks and at least one enabled shape are accepted.
Shape size/radius/height and local offsets are bounded by 10000. Native
shape-owner identity, resource, transform, disabled and one-way settings must
also match their actual CollisionShape2D node; checking inspector fields alone
is insufficient after raw native owner API changes. Those divergences are
refused before moving, with real native regression coverage.
The collision environment is the trusted running project, not frozen or
certified geometry.

The response contains before/after *local* position, actual last-slide velocity,
exact completed/start/end physics frame counts, floor/wall/ceiling flags and up
to eight *last-frame* native contact positions/normals in world space. Contacts
are not an all-frame event history. Velocity resets to zero after each movement
frame; no autonomous process, held input or authored file write is installed.

Timeout/cancellation is not rollback. A submitted command may complete its
bounded remaining frames; query `get_runtime_operation_status` with the original
ID and do not submit a new movement. Scene replacement, pause or invalid state
can abort after partial movement, without undoing prior frames. Never claim a
failed runtime command left the world unchanged. Stopping the owned session
ends the run; replay records are session-local, not durable after restart.

Tests add three fast grammar/observation/permission cases, a real stdio native
author/save/run case and a separate local rendered pixel case. Tests verify
free motion, wall/floor normals, exact duplicate replay, conflict, invalid
parameters, wrong target, disabled/scaled body refusal, idle stability, UNKNOWN
then late completion lookup, unchanged authored bytes, and reversible pixels.
Approval for authoring remains MOCK. Native stepping does not require rendering
and does not pop up a game window; local pixel acceptance uses the existing
minimized background renderer, not headless screenshots.

Development failure evidence is retained: the first runtime test exposed a
GDScript inferred-Variant parse error in the shape-owner lookup (fixed with an
explicit Variant declaration), and a new non-finite-output assertion expected
PROTOCOL_MISMATCH even though the existing shared Variant guard returns
UNSUPPORTED first. That guard was preserved. The first complete local gate
passed before the later scene-local path tightening; it is not reused as the
final source's complete gate. Final evidence must bind the tightened source.

Hosted run 39070022126 later hit the unchanged 240s safety deadline without a
final summary. Character cases passed, but remaining original cases had not
finished. Keep that failed run. Rebalance sprite/character native checks into
the existing 60s engine phase, retaining every required case exactly once,
two workers in each sequential phase, 240s safety and 600s total gate. This
does not raise deadlines, enlarge automatic CI or turn individual passes into
qualification. Final counts: 141 core, 73 safety, 19 engine, 2 package (235).

Accepted integration source `d888453` passed all 235 hosted bounded checks,
short CI, Pages, installed Codex interface probe and independent downloaded
artifact verification. Final local engine checks were 19/19, rendered/resource
checks 3/3; earlier local gates are not relabeled current-source gates. See the
[complete stage and failure record](../releases/main-character-verification.json).

Primary references: [Godot CharacterBody2D](https://docs.godotengine.org/en/stable/classes/class_characterbody2d.html)
and [CollisionObject2D shape-owner APIs](https://docs.godotengine.org/en/stable/classes/class_collisionobject2d.html).
Full production qualification, all platforms, human approval UX and complete
character workflows remain NOT_QUALIFIED.

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

## Stage 2: pending runtime control

Stage 1 alone does not move a body or consume player input. The next separately
verified step is a bounded, physics-frame scheduled native movement command
with run/write permissions, session ownership, operation replay and collision
readback. No arbitrary script attachment is authorized by this contract.

Primary reference: [Godot CharacterBody2D](https://docs.godotengine.org/en/stable/classes/class_characterbody2d.html).
Full production qualification, all platforms, human approval UX and complete
character workflows remain NOT_QUALIFIED.

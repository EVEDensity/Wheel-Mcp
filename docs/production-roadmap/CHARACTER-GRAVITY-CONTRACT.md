# Bounded CharacterBody2D gravity and jump

Main development, trusted Windows / Godot 4.7.2 / stdio. This extends the
[native character contract](CHARACTER-2D-CONTRACT.md), not a permanent controller,
keyboard consumption, arbitrary script attachment or CharacterBody3D support.

## Stage 1: host contract and fail-closed capability

`step_character_2d` retains its original three-field behavior when no gravity
is specified. New optional fields require an independently announced
`character.gravity2d/v1` runtime capability in addition to `character.step2d/v1`.
The existing 0.3.2 runtime does not announce gravity: the new host must reject
these requests before dispatch until the separately tested native stage lands.

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

## Stage 2: native implementation and acceptance (not yet implemented)

Implement and test native gravity integration and fresh floor-contact jump
preflight on actual physics frames. Preserve zero held velocity after each
command, explicit continuation from returned velocity, bounded terminal speed,
native collision observations, operation replay and late-result inspection.
Reject airborne/stale-floor jumps without moving. Verify fall, jump, landing,
clamping, ceiling contact, no implicit continued simulation and real pixels.
Until that stage is implemented and its evidence recorded, this section grants
no runtime feature or release qualification.

References: [CharacterBody2D](https://docs.godotengine.org/en/stable/classes/class_characterbody2d.html)
and [PhysicsBody2D.test_move](https://docs.godotengine.org/en/stable/classes/class_physicsbody2d.html#class-physicsbody2d-method-test-move).

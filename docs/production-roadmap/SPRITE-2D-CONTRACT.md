# Bounded native Sprite2D authoring

Main development, trusted local Windows / Godot 4.7.2 / stdio only. This is a
single-frame native sprite subset, not a character controller, arbitrary image
importer, animation sheet, atlas, skeletal workflow or full 2D game generator.
Public v0.2.8 packages do not contain this later main integration.

## Explicit upgrade and operations

Upgrade host and editor plugin together: editor bridge 0.3.7 retains
`scene.sprite2d/v1`, with at most 27 capabilities (read-only remains two).
Sprite support was introduced in 0.3.6; the later character capability is
described in the [character contract](CHARACTER-2D-CONTRACT.md).
Creation and `sprite_set` without this capability fail `PROTOCOL_MISMATCH`;
missing independent private write opt-in still fails `FORBIDDEN` first. Frame,
private metadata, operation/node and handle quotas are unchanged. The product
does not install, replace or enable a user's plugin implicitly.

`apply_editor_scene` supports local `create type:"Sprite2D"` and
`sprite_set` with 1..4 declared properties:

```json
{"kind":"sprite_set","path":"Sprite","properties":{"centered":false,"flip_h":true,"flip_v":false,"offset":{"type":"Vector2","x":-2,"y":3}}}
```

Flags are booleans; offset requires a finite Vector2 with each component within
-100000..100000. Node2D transforms/visibility continue through the existing `set`
operation and its bounds. `ui_set` is not a sprite API. Wrong node types, unknown
fields, raw image paths, script/material/region/frame fields and malformed
vectors fail without a partial batch. Container layout behavior is not added.

## Texture and document boundaries

- Assign through a scoped `ResourceRef` and explicit `shared` or `make_unique`
  policy, never a texture path. Existing `scene.texture/v1` and PNG snapshot
  capability checks remain. No new resource class is added: the 16 declared
  types remain unchanged.
- Only closed, script-free native GradientTexture2D -> Gradient or
  ImageTexture -> Image graphs from the [bounded texture/PNG contract](UI-AUTHORING-CONTRACT.md)
  are admitted. PNG limits, CRC/native/host pixel comparison and source hashes
  through approval and final native commit remain unchanged. Once embedded,
  PNG pixels are independent snapshots, not live importer-cache references.
- Memory/current-scene inline resources may be shared or uniquely copied.
  External `.tres` references require explicit `make_unique` before embedding;
  pre-existing external sprite texture dependencies fail closed. No external
  texture-file CAS, arbitrary imported PNG, AtlasTexture or CompressedTexture2D
  loading is introduced. Native resource export remains independently approved.
- `hframes=vframes=1`, `frame=0`, region disabled, default empty region rectangle,
  region filtering disabled, no material/use-parent-material. Nondeclared live
  sprite settings are refused for both editing and saving, not silently dropped.
  Sprite drawing/texture/frame callbacks (`texture_changed`, `frame_changed`,
  `item_rect_changed`, `draw`) require a separate policy and are rejected.
- Live document checks run again at commit. Native sprite property and texture
  application temporarily blocks signals, preserving the previous blocking
  state, including Undo/Redo after a late texture callback is attached. This is
  not approval for arbitrary scripts or a guarantee about arbitrary user changes
  made after an accepted action.

## Persistence and evidence

The batch remains one native Undo/Redo action, separate from saving. Snapshot
hashes retain actual stored properties and full texture storage. Native packed
reload checks compare sprite flags, offsets, single-frame/region settings,
canvas paint fields and full texture data as well as existing transforms and
ownership. Do not ignore pixel content or sharing to pass save/reopen.

`sprite-native.test.ts` uses real Godot, official SDK stdio and MOCK exact-plan
approval: readonly/capability limits, declined/changed-source plans, shared and
unique textures, partial failures without leftover nodes, callback refusal and
Undo/Redo suppression, frame/region/material refusal, external texture refusal,
native resource export, actual scene save and same-project editor reopen.
Object IDs and current-scene inline resource path identity are normalized after
reopen; authored values, pixel storage, ownership and resource sharing are not.

`sprite-render.test.ts` separately renders an MCP-authored saved scene with a
four-quadrant native PNG. It checks red/blue/green pixel samples, horizontal and
vertical flipping, offset and centering changes, then zero pixel difference
after restoration. It runs locally, not as a headless/GPU matrix or human visual
approval. These checks do not certify every transform/filter/project setting.

The native case joins the existing bounded safety suite; two schema cases join
short CI. Every previous test, two-worker concurrency and original deadlines
remain. Declared coverage counts are 136 core, 74 safety, 16 engine and 2 package
tests. Full production qualification and the broad future engine wishlist remain
`NOT_QUALIFIED`/unimplemented, not release blockers for the personal local scope.

Primary references: [Sprite2D](https://docs.godotengine.org/en/stable/classes/class_sprite2d.html)
and [Godot 4.7.2 native implementation](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/2d/sprite_2d.cpp).

Accepted main source `588d653` passed the hosted 228-case bounded gate and
independent downloaded artifact verification. The first hosted timeout remains
recorded alongside the unchanged-budget queue repair; see the
[verification record](../releases/main-sprite-verification.json) for exact source,
local rendering, MOCK approval and unchanged public-release boundaries.

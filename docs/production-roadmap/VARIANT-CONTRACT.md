# Runtime Variant JSON contract (T03)

The runtime bridge accepts JSON primitives (`null`, boolean, safe integer, finite number, string), arrays, and string-key dictionaries. It decodes typed values **only** from explicit `type` objects. A string such as `"Vector2(1,2)"` remains a string. This contract applies to `set_property.value`, `create_node.properties`, and `call_method.args`; legacy one-shot property writes use the same Godot decoder.

| Type               | JSON shape                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| Vector2 / Vector2i | `{ "type": "Vector2", "x": 1, "y": 2 }` (integer components for `Vector2i`)                               |
| Vector3 / Vector3i | `{ "type": "Vector3", "x": 1, "y": 2, "z": 3 }` (integer components for `Vector3i`)                       |
| Color              | `{ "type": "Color", "r": 0.2, "g": 0.4, "b": 0.6, "a": 1 }`; input alpha may be omitted and defaults to 1 |
| NodePath           | `{ "type": "NodePath", "path": "Child" }`                                                                 |
| Quaternion         | `{ "type": "Quaternion", "x": 0, "y": 0, "z": 0, "w": 1 }`                                                |
| Basis              | `{ "type": "Basis", "x": Vector3, "y": Vector3, "z": Vector3 }`                                           |
| Transform2D        | `{ "type": "Transform2D", "x": Vector2, "y": Vector2, "origin": Vector2 }`                                |
| Transform3D        | `{ "type": "Transform3D", "basis": Basis, "origin": Vector3 }`                                            |

`Vector2`, `Vector3`, and `Basis` in the nested examples mean the corresponding tagged JSON object, not a string. Outbound values use the same tags; no MCP formatting layer guesses a type from plain text. Property writes validate against Godot property metadata, including declared numeric ranges, and read back before reporting success. Method calls validate argument count and metadata types before invocation. Initial properties are all checked before a new node is added to the scene tree; a failure leaves no new node.

JSON cannot encode NaN, infinity, or cyclic graphs. Values deeper than 32 levels, unsafe 64-bit integers, PackedArrays, unknown objects, and unreferenced Resources return `INVALID_ARGUMENT` or `UNSUPPORTED` rather than a successful lossy value. Resource **input** is unsupported until the controlled resolver in T13; Resource **output** is descriptive only and requires a `res://` path. This bridge does not instantiate a class from a client-provided name outside the existing, separately checked `create_node.type` operation.

Validation uses a relative float tolerance of at most `1e-6 × max(1, |requested|)` for scalar floats; Godot's `is_equal_approx` applies to Vector2/Vector3/Color. Other structured values are compared for equality after assignment. A mismatch attempts to restore the prior property and reports `CONFLICT`; it is never treated as successful validation. The initial-node transaction checks the detached node before insertion.

Real-engine contract tests: `tests/runtime-property-roundtrip.test.ts`; malformed and unsupported JSON boundary tests: `tests/variant-codec.test.ts`; D01 replay: `npm run baseline:defects` with `GODOT_PATH`.

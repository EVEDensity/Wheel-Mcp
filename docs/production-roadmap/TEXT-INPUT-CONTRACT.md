# Bounded committed text input

Main development for trusted Windows / Godot 4.7.2 / stdio. Not included in the
immutable public v0.2.8 package. This is single-scalar committed runtime input,
not IME composition, grapheme batching, paste, shortcuts, system keyboard
automation, automatic focus targeting or a permanent gameplay controller.

## Stage 1: host contract

`call_runtime_bridge`, method `inject_input`, params `{type:"text",text:"中"}`
requires the independent `input.text_scalar/v1` capability. Existing run/write,
owned-session and exact operation-ID rules apply. Runtime 0.3.3 and older do not
advertise this extension and must fail before dispatch; this stage alone does
not implement native Unicode input. Existing key/motion/wheel behavior remains.

- Exactly one Unicode scalar (one or two UTF-16 units, 1..4 UTF-8 bytes).
- Reject C0/C1 controls, DEL, surrogates and U+2028/U+2029. No normalization,
  keycode, pressed/modifier flags, nodePath or composition fields.
- The response acknowledges the exact scalar as `unicode`, not raw text or
  `consumed:true`. Both normal and late responses require exact correlation.
  It must not masquerade as a legacy accepted key/wheel reply, or vice versa.
- UNKNOWN/cancellation is not rollback. Inspect the original operation ID;
  exact replay must not input a second character. Never blindly retry a new ID.
- The one-scalar request is retained for late correlation, not generic payloads.

Three fast cases extend core to 147; safety 73, engine 19 and package 2 remain
required (241 total). No longer deadlines, workers, automatic engine matrix or
required organization permissions.

## Stage 2: native input and consumption evidence (planned)

Explicitly upgrade host and runtime plugin to the subsequently tested version.
Create a Unicode-only native InputEventKey with no physical/key label/keycode,
echo or modifiers, and feed it to the game's Input pipeline. It follows current
viewport/GUI focus, not a named node or OS focus. Do not assign LineEdit.text as
the implementation or automatically grab focus. Acceptance alone proves neither
focus nor consumption; independently read actual GUI state after native frames.
Project callbacks remain trusted code and may handle/redirect/reject input.

Reuse the existing wheel author/save/runtime fixture for native and local pixel
checks, without extra engine startup: Latin/CJK/non-BMP storage, focus routing,
noneditable/max-length/no-focus behavior, duplicate/reused IDs, invalid-input
no-op, no held physical keys, exact late result and unchanged authored bytes.
Rendered Latin glyph changes/restoration are separate local evidence, not CJK
font coverage, hosted GPU or human approval UX. Approval remains MOCK.

References: [InputEventKey.unicode](https://docs.godotengine.org/en/stable/classes/class_inputeventkey.html#class-inputeventkey-property-unicode),
[Input.parse_input_event](https://docs.godotengine.org/en/stable/classes/class_input.html#class-input-method-parse-input-event),
[Godot 4.7.2 Input state](https://github.com/godotengine/godot/blob/4.7.2-stable/core/input/input.cpp)
and [native LineEdit consumption](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/gui/line_edit.cpp).

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

## Stage 2: native input and consumption evidence

Explicitly upgrade host and runtime plugin to runtime bridge 0.3.4. The editor
bridge remains 0.3.7 / 27 capabilities. No implicit installation/update occurs.
Create a Unicode-only native InputEventKey press/release pair with no physical
key/label/keycode, echo or modifiers, and feed it to the game's Input pipeline.
The release retains the scalar to release matching custom Unicode InputMap
actions, while LineEdit only inserts on the pressed event. It follows current
viewport/GUI focus, not a named node or OS focus. Do not assign LineEdit.text as
the implementation or automatically grab focus. Acceptance alone proves neither
focus nor consumption; independently read actual GUI state after native frames.
Project callbacks remain trusted code and may handle/redirect/reject input.

Reuse the existing wheel author/save/runtime fixture for native and local pixel
checks, without extra engine startup: Latin/CJK/non-BMP storage, focus routing,
noneditable/max-length/hidden/no-focus behavior, duplicate/reused IDs even after
focus changes, invalid-input no-op, no held physical keys or fixture Unicode
action, exact late result and unchanged authored bytes. A TEST-ONLY observer
autoload reads actual events and supplies a 500ms blocked-main-loop barrier for
UNKNOWN/late completion; it does not insert text or attach product scripts.
Rendered Latin glyph changes/restoration are separate local evidence, not CJK
font coverage, hosted GPU or human approval UX. Approval remains MOCK.

The first new contract run failed one expected-code assertion: NaN was already
rejected by the shared Variant UNSUPPORTED guard before the text-specific
protocol schema. That guard stays in place; the corrected test explicitly
requires it rather than relaxing validation. Native integration and final CI
evidence must be source-bound separately from the stage-1 host-only green run.

Accepted integration source `14ec2d9` passed 241/241 hosted bounded checks,
short CI, Pages, installed Codex representative interface probe and independent
downloaded artifact verification. The probe does not itself call Unicode input
through Codex or certify human UX. Final local engine checks passed 19/19, and
workspace-owned render/resource checks 4/4 with cleanup. Two system-TEMP runs
had all four functional checks pass but cleanup EPERM; both remain FAIL, their
data/permissions were not erased/changed, and the precise cause remains unproven.
This is a new workspace-isolated validation, not a system-TEMP permission fix
or a complete final-source local release gate. See the [stage and failure
record](../releases/main-text-input-verification.json). No new tag, Release or
npm publication; public v0.2.8 remains unchanged.

References: [InputEventKey.unicode](https://docs.godotengine.org/en/stable/classes/class_inputeventkey.html#class-inputeventkey-property-unicode),
[Input.parse_input_event](https://docs.godotengine.org/en/stable/classes/class_input.html#class-input-method-parse-input-event),
[Godot 4.7.2 Input state](https://github.com/godotengine/godot/blob/4.7.2-stable/core/input/input.cpp)
and [native LineEdit consumption](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/gui/line_edit.cpp).

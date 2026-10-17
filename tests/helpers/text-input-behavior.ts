import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { waitUntil } from './editor-fixture.js';
import { wireEditor } from './editor-mcp.js';
import { compareScreenshots } from '../../src/godot-development.js';

// TEST ONLY: observes the real Input pipeline and supplies a deterministic late
// response barrier. It never changes LineEdit.text or installs product scripts.
export const inputProbeScript = `extends Node
var presses: int = 0
var releases: int = 0
var last_unicode: int = 0
var last_keycode: int = 0
var last_physical: int = 0
var last_label: int = 0
var last_echo: bool = false
var last_modifiers: int = 0
func _ready() -> void:
\tInputMap.add_action("text_probe")
\tvar binding := InputEventKey.new()
\tbinding.unicode = 65
\tInputMap.action_add_event("text_probe", binding)
func _input(event: InputEvent) -> void:
\tif event is InputEventKey and event.unicode > 0:
\t\tif event.pressed: presses += 1
\t\telse: releases += 1
\t\tlast_unicode = event.unicode
\t\tlast_keycode = event.keycode
\t\tlast_physical = event.physical_keycode
\t\tlast_label = event.key_label
\t\tlast_echo = event.echo
\t\tlast_modifiers = event.get_modifiers_mask()
func snapshot() -> Dictionary:
\treturn {"presses": presses, "releases": releases, "unicode": last_unicode, "keycode": last_keycode, "physical": last_physical, "label": last_label, "echo": last_echo, "modifiers": last_modifiers, "held": Input.is_anything_pressed(), "actionHeld": Input.is_action_pressed("text_probe")}
func stall() -> void:
\tvar file := FileAccess.open("res://.harness/text-blocked", FileAccess.WRITE)
\tfile.store_string("blocked")
\tfile.close()
\tOS.delay_msec(500)
`;

type Rpc = (method: string, params?: Record<string, unknown>, id?: string) => Promise<any>;
type Call = (name: string, args?: Record<string, unknown>) => Promise<any>;

export async function exerciseTextInput(options: {
  rpc: Rpc;
  call: Call;
  rawCall: Call;
  root: string;
  sessionId: string;
  render: boolean;
  capture: (name: string) => Promise<string>;
}) {
  const { rpc, call, rawCall, root, sessionId, render, capture } = options;
  const get = async (nodePath: string, property: string) => (await rpc('get_property', { nodePath, property })).value;
  const method = async (nodePath: string, method: string) =>
    (await rpc('call_method', { nodePath, method, args: [] })).value;
  const set = (nodePath: string, property: string, value: unknown) =>
    rpc('set_property', { nodePath, property, value });
  const wait = () => rpc('wait_physics_frames', { frames: 3 });
  const snapshot = () => method('../InputProbe', 'snapshot');
  const inject = async (text: string, id?: string) => {
    const result = await rpc('inject_input', { type: 'text', text }, id);
    assert.equal(result.accepted, true);
    assert.equal(result.type, 'text');
    assert.equal(result.unicode, text.codePointAt(0));
    await wait();
    return result;
  };
  await method('Entry', 'grab_focus');
  assert.equal(await method('Entry', 'has_focus'), true);
  await set('Entry', 'caret_blink', false);
  await wait();
  const baseline = render ? await capture('text-empty') : '';
  const a = await inject('A', 'text-exact-once');
  assert.equal(await get('Entry', 'text'), 'A');
  const first = await snapshot();
  assert.deepEqual(first, {
    presses: 1,
    releases: 1,
    unicode: 65,
    keycode: 0,
    physical: 0,
    label: 0,
    echo: false,
    modifiers: 0,
    held: false,
    actionHeld: false,
  });
  assert.deepEqual(await inject('A', 'text-exact-once'), a);
  assert.deepEqual(await snapshot(), first, 'Exact replay must not emit a second input pulse');
  const conflict = await rawCall('call_runtime_bridge', {
    sessionId,
    method: 'inject_input',
    operationId: 'text-exact-once',
    params: { type: 'text', text: 'B' },
  });
  assert.equal(conflict.structuredContent.code, 'CONFLICT');
  for (const text of ['中', '🚀', 'é', ' ']) await inject(text);
  assert.equal(await get('Entry', 'text'), 'A中🚀é ');
  assert.equal(await get('Entry', 'caret_column'), 5, 'Non-BMP scalar is one Godot character, not two UTF-16 units');
  // Visual qualification is Latin only; native Unicode storage is tested above.
  await set('Entry', 'text', '');
  await inject('W');
  if (render)
    assert.ok(
      (await compareScreenshots(baseline, await capture('text-inserted'), { threshold: 0 })).differentPixels > 20,
    );
  // Native Backspace press/release, not a property write, restores the pixels.
  await rpc('inject_input', { keycode: 4194308, pressed: true });
  await rpc('inject_input', { keycode: 4194308, pressed: false });
  await wait();
  assert.equal(await get('Entry', 'text'), '');
  if (render)
    assert.equal(
      (await compareScreenshots(baseline, await capture('text-restored'), { threshold: 0 })).differentPixels,
      0,
    );
  await method('Other', 'grab_focus');
  await inject('B');
  assert.equal(await get('Entry', 'text'), '');
  assert.equal(await get('Other', 'text'), 'B');
  const routed = await snapshot();
  assert.deepEqual(await inject('A', 'text-exact-once'), a);
  assert.deepEqual(await snapshot(), routed, 'Replay must not route old text to the newly focused control');
  assert.equal(await get('Other', 'text'), 'B');
  await method('Other', 'release_focus');
  await inject('N');
  assert.equal(await get('Other', 'text'), 'B', 'Acceptance with no GUI focus is not consumption');
  await method('Entry', 'grab_focus');
  await set('Entry', 'editable', false);
  await inject('X');
  assert.equal(await get('Entry', 'text'), '', 'Noneditable control must reject Unicode input natively');
  await set('Entry', 'editable', true);
  await set('Entry', 'max_length', 1);
  await inject('C');
  await inject('D');
  assert.equal(await get('Entry', 'text'), 'C', 'Native max_length must constrain real event consumption');
  await set('Entry', 'visible', false);
  await inject('H');
  assert.equal(await get('Entry', 'text'), 'C', 'Hidden controls must not receive text through implicit targeting');
  await set('Entry', 'visible', true);
  await method('Entry', 'grab_focus');
  const beforeInvalid = await snapshot();
  for (const params of [
    { type: 'text', text: 'AB' },
    { type: 'text', text: '\n' },
    { type: 'text', text: '\ud800' },
    { type: 'text', text: 'Z', keycode: 90 },
  ]) {
    const r = await rawCall('call_runtime_bridge', { sessionId, method: 'inject_input', params });
    assert.equal(r.structuredContent.code, 'INVALID_ARGUMENT');
    assert.deepEqual(await snapshot(), beforeInvalid);
    assert.equal(await get('Entry', 'text'), 'C');
  }
  for (const scopes of [['read'], ['read', 'write', 'run']] as const) {
    const other = await wireEditor(root, { transport: 'stdio', scopes: [...scopes] });
    try {
      const r = await other.call('call_runtime_bridge', {
        sessionId,
        method: 'inject_input',
        params: { type: 'text', text: 'Z' },
      });
      assert.equal((r.structuredContent as any).code, 'FORBIDDEN');
      assert.equal(await get('Entry', 'text'), 'C');
    } finally {
      await other.close();
    }
  }
  await set('Entry', 'max_length', 0);
  await set('Entry', 'text', '');
  const blocking = method('../InputProbe', 'stall');
  await waitUntil(async () =>
    (await readFile(path.join(root, '.harness/text-blocked'), 'utf8').catch(() => '')) === 'blocked' ? true : undefined,
  );
  const lateId = 'text-late-acceptance';
  const late = await rawCall('call_runtime_bridge', {
    sessionId,
    method: 'inject_input',
    operationId: lateId,
    timeoutMs: 150,
    params: { type: 'text', text: 'L' },
  });
  assert.equal(late.structuredContent.code, 'UNKNOWN');
  await blocking;
  await wait();
  const status = await call('get_runtime_operation_status', { sessionId, operationId: lateId });
  assert.equal(status.status, 'COMPLETED');
  assert.equal(status.result.unicode, 76);
  assert.equal(await get('Entry', 'text'), 'L');
  const beforeReplay = await snapshot();
  assert.deepEqual(await inject('L', lateId), status.result);
  assert.deepEqual(await snapshot(), beforeReplay);
  assert.equal(await get('Entry', 'text'), 'L');
  assert.equal(beforeReplay.held, false);
  assert.equal(beforeReplay.actionHeld, false);
}

import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { startEditorFixture } from './editor-fixture.js';
import { wireEditor } from './editor-mcp.js';
import { compareScreenshots } from '../../src/godot-development.js';
import { exerciseTextInput, inputProbeScript } from './text-input-behavior.js';

export async function exerciseWheel(render: boolean) {
  const f = await startEditorFixture(process.env.GODOT_PATH!, {
    writeEnabled: true,
    scene: '[gd_scene format=3]\n[node name="Main" type="Control"]\n',
    files: { 'input_probe.gd': inputProbeScript }, // TEST ONLY observer, not product script attachment.
  });
  const c = await wireEditor(f.root, { transport: 'stdio' }); // MOCK exact-plan approval; no human UX claim.
  let sessionId = '';
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await c.call(name, args);
    assert.notEqual(r.isError, true, name + ': ' + JSON.stringify(r));
    return r.structuredContent as Record<string, any>;
  };
  const ui = (node: string, properties: Record<string, unknown>) => ({ kind: 'ui_set', path: node, properties });
  const v2 = (x: number, y: number) => ({ type: 'Vector2', x, y });
  try {
    await call('apply_editor_scene', {
      operations: [
        { kind: 'create', parent: '.', name: 'Scroll', type: 'ScrollContainer' },
        ui('Scroll', {
          offset_left: 24,
          offset_top: 24,
          offset_right: 344,
          offset_bottom: 224,
          horizontal_scroll_mode: 1,
          vertical_scroll_mode: 1,
        }),
        { kind: 'create', parent: 'Scroll', name: 'Content', type: 'VBoxContainer' },
        ui('Scroll/Content', { custom_minimum_size: v2(600, 900) }),
        { kind: 'create', parent: 'Scroll/Content', name: 'Top', type: 'Label' },
        ui('Scroll/Content/Top', {
          text: 'TOP / WHEEL INPUT\nNative viewport response',
          custom_minimum_size: v2(600, 80),
        }),
        { kind: 'create', parent: 'Scroll/Content', name: 'Bottom', type: 'Label' },
        ui('Scroll/Content/Bottom', { text: 'BOTTOM / NATIVE GUI', custom_minimum_size: v2(600, 820) }),
        { kind: 'create', parent: '.', name: 'Entry', type: 'LineEdit' },
        ui('Entry', { offset_left: 24, offset_top: 260, offset_right: 344, offset_bottom: 300 }),
        { kind: 'create', parent: '.', name: 'Other', type: 'LineEdit' },
        ui('Other', { offset_left: 380, offset_top: 260, offset_right: 620, offset_bottom: 300 }),
      ],
    });
    assert.equal((await call('save_editor_scene')).persisted, true);
    const saved = await readFile(path.join(f.root, 'main.tscn'));
    await f.command('quit');
    await f.exited;
    // Test-only observer autoload; the MCP-authored scene stays byte-identical.
    await writeFile(
      path.join(f.root, 'project.godot'),
      f.project + '\n[autoload]\nInputProbe="*res://input_probe.gd"\n',
    );
    const evidenceDir = path.join(f.root, '.harness/wheel-runtime');
    sessionId = (
      await call('open_runtime_bridge', {
        headless: !render,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        evidenceDir,
      })
    ).session_id;
    const rpc = async (method: string, params: Record<string, unknown> = {}, operationId?: string) =>
      (await call('call_runtime_bridge', { sessionId, method, params, ...(operationId ? { operationId } : {}) }))
        .response;
    const wait = () => rpc('wait_physics_frames', { frames: 3 });
    const get = async (property: string) => (await rpc('get_property', { nodePath: 'Scroll', property })).value;
    const wheel = async (direction: string, position = { x: 80, y: 80 }, factor = 1, operationId?: string) => {
      const result = await rpc('inject_input', { type: 'mouse_wheel', direction, position, factor }, operationId);
      assert.equal(result.accepted, true);
      assert.equal(result.type, 'mouse_wheel');
      await wait();
      return result;
    };
    const capture = async (name: string) => {
      const file = path.join(evidenceDir, name + '.png');
      await rpc('capture_screenshot', { path: file });
      return file;
    };
    await wait();
    const baseline = await get('scroll_vertical');
    assert.equal(baseline, 0);
    const before = render ? await capture('before') : '';
    await wheel('down', undefined, 1, 'wheel-exactly-once');
    const down = await get('scroll_vertical');
    assert.ok(down > 0, 'Native GUI must consume the event, not direct property assignment');
    if (render)
      assert.ok((await compareScreenshots(before, await capture('down'), { threshold: 0 })).differentPixels > 100);
    await wheel('down', undefined, 1, 'wheel-exactly-once');
    assert.equal(await get('scroll_vertical'), down, 'Same operation ID must not inject twice');
    await wheel('up');
    assert.equal(await get('scroll_vertical'), baseline);
    if (render)
      assert.equal((await compareScreenshots(before, await capture('restored'), { threshold: 0 })).differentPixels, 0);
    await wheel('right');
    assert.ok((await get('scroll_horizontal')) > 0);
    await wheel('left');
    assert.equal(await get('scroll_horizontal'), 0);
    await wheel('down', { x: 500, y: 300 });
    assert.equal(await get('scroll_vertical'), 0, 'Outside coordinates must not target Scroll');
    for (const params of [
      { type: 'mouse_wheel', direction: 'down', position: { x: 80, y: 80 }, factor: 0 },
      { type: 'mouse_wheel', direction: 'down', position: { x: -1, y: 80 } },
    ]) {
      const r = await c.call('call_runtime_bridge', { sessionId, method: 'inject_input', params });
      assert.equal((r.structuredContent as { code: string }).code, 'INVALID_ARGUMENT');
      assert.equal(await get('scroll_vertical'), 0);
    }
    await rpc('set_property', { nodePath: 'Scroll', property: 'visible', value: false });
    await wait();
    await wheel('down');
    assert.equal(await get('scroll_vertical'), 0, 'Hidden control cannot consume input');
    await rpc('set_property', { nodePath: 'Scroll', property: 'visible', value: true });
    await wait();
    for (let i = 0; i < 4; i++) await wheel('down', undefined, 8);
    const end = await get('scroll_vertical');
    assert.ok(end > down);
    await wheel('down', undefined, 8);
    assert.equal(await get('scroll_vertical'), end, 'Native scroll must clamp at its limit');
    await wheel('up');
    assert.ok((await get('scroll_vertical')) < end);
    await exerciseTextInput({ rpc, call, rawCall: c.call, root: f.root, sessionId, render, capture });
    assert.deepEqual(
      await readFile(path.join(f.root, 'main.tscn')),
      saved,
      'Runtime GUI input must not save authored files',
    );
    await call('stop_runtime_bridge', { sessionId });
    sessionId = '';
    assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
  } finally {
    if (sessionId) await c.call('stop_runtime_bridge', { sessionId });
    await c.close();
    await f.stop();
  }
}

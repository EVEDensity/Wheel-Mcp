import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';

const controller = `@tool
extends EditorPlugin
const Core = preload("res://addons/wheel_mcp/scene_service.gd")
var callbacks := 0
var native_callback: Callable
func _changed(_value: float) -> void: callbacks += 1
func _enter_tree() -> void: set_process(true)
func _process(_delta: float) -> void:
\tvar root := EditorInterface.get_edited_scene_root()
\tif root == null or not FileAccess.file_exists("res://.harness/fixture-command.json"): return
\tvar c: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://.harness/fixture-command.json"))
\tDirAccess.remove_absolute(ProjectSettings.globalize_path("res://.harness/fixture-command.json"))
\tvar history := get_undo_redo().get_history_undo_redo(get_undo_redo().get_object_history_id(root))
\tif c.action == "undo": history.undo()
\tif c.action == "redo": history.redo()
\tvar scroll := root.get_node_or_null("Scroll") as ScrollContainer
\tif c.action == "watch": scroll.get_v_scroll_bar().value_changed.connect(_changed)
\tif c.action == "unwatch": scroll.get_v_scroll_bar().value_changed.disconnect(_changed)
\tif c.action == "detach-native":
\t\tnative_callback = scroll.get_v_scroll_bar().get_signal_connection_list("value_changed")[0].callable
\t\tscroll.get_v_scroll_bar().value_changed.disconnect(native_callback)
\tif c.action == "restore-native": scroll.get_v_scroll_bar().value_changed.connect(native_callback)
\tvar reply := {"id": c.id, "document": Core.document(root), "callbacks": callbacks}
\tif scroll != null:
\t\treply["config"] = {"horizontal_scroll_mode": scroll.horizontal_scroll_mode, "vertical_scroll_mode": scroll.vertical_scroll_mode, "follow_focus": scroll.follow_focus}
\t\treply["internal"] = [str(root.get_path_to(scroll.get_h_scroll_bar())), str(root.get_path_to(scroll.get_v_scroll_bar()))]
\tvar file := FileAccess.open("res://.harness/fixture-result.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify(reply))
\tfile.close()
\tif c.action == "quit": get_tree().call_deferred("quit")
`;

test(
  'real stdio ScrollContainer native guards, undo/redo, saved reopen and GUI Tab follow-focus',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 },
  async () => {
    let f = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      writeEnabled: true,
      scene: '[gd_scene format=3]\n[node name="Main" type="Control"]\n',
    });
    let attachOnApproval = false;
    const c = await wireEditor(f.root, {
      transport: 'stdio',
      approval: async () => {
        if (attachOnApproval) {
          await f.command('watch');
          attachOnApproval = false;
        }
        return { action: 'accept', content: { confirm: true } }; // MOCK exact-plan host, not human UX.
      },
    });
    let sessionId = '';
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await c.call(name, args);
      assert.notEqual(r.isError, true, JSON.stringify(r));
      return r.structuredContent as Record<string, any>;
    };
    const ui = (node: string, properties: Record<string, unknown>) => ({ kind: 'ui_set', path: node, properties });
    const v2 = (x: number, y: number) => ({ type: 'Vector2', x, y });
    try {
      const originalBytes = await readFile(path.join(f.root, 'main.tscn'));
      const initial = (await f.command('inspect')).document;
      const readOnly = await wireEditor(f.root, { transport: 'stdio', scopes: ['read'] });
      try {
        const denied = await readOnly.call('apply_editor_scene', {
          operations: [{ kind: 'create', parent: '.', name: 'Scroll', type: 'ScrollContainer' }],
        });
        assert.equal((denied.structuredContent as { code: string }).code, 'FORBIDDEN');
      } finally {
        await readOnly.close();
      }
      const endpointPath = path.join(f.root, '.harness/editor-endpoint.json');
      const bytes = await readFile(endpointPath);
      const endpoint = JSON.parse(bytes.toString());
      assert.equal(endpoint.capabilities.length, 28);
      assert.ok(endpoint.capabilities.includes('scene.scroll/v1'));
      try {
        for (const capabilities of [
          endpoint.capabilities.filter((x: string) => x !== 'scene.scroll/v1'),
          [...endpoint.capabilities, 'overflow'],
        ]) {
          await writeFile(endpointPath, JSON.stringify({ ...endpoint, capabilities })); // Explicit metadata TEST DOUBLE.
          const refused = await c.call('apply_editor_scene', {
            operations: [{ kind: 'create', parent: '.', name: 'Scroll', type: 'ScrollContainer' }],
          });
          assert.equal((refused.structuredContent as { code: string }).code, 'PROTOCOL_MISMATCH');
        }
      } finally {
        await writeFile(endpointPath, bytes);
      }
      await call('apply_editor_scene', {
        operations: [
          { kind: 'create', parent: '.', name: 'Scroll', type: 'ScrollContainer' },
          ui('Scroll', {
            offset_left: 24,
            offset_top: 24,
            offset_right: 344,
            offset_bottom: 224,
            horizontal_scroll_mode: 3,
            vertical_scroll_mode: 1,
            follow_focus: true,
          }),
          { kind: 'create', parent: 'Scroll', name: 'Content', type: 'VBoxContainer' },
          ui('Scroll/Content', { custom_minimum_size: v2(600, 900) }),
          { kind: 'create', parent: 'Scroll/Content', name: 'Top', type: 'Button' },
          ui('Scroll/Content/Top', { text: 'First', custom_minimum_size: v2(600, 40) }),
          { kind: 'create', parent: 'Scroll/Content', name: 'Space', type: 'Control' },
          ui('Scroll/Content/Space', { custom_minimum_size: v2(600, 720) }),
          { kind: 'create', parent: 'Scroll/Content', name: 'Bottom', type: 'Button' },
          ui('Scroll/Content/Bottom', { text: 'Last', custom_minimum_size: v2(600, 40) }),
        ],
      });
      const created = await f.command('inspect');
      assert.equal(created.document.nodes.length, 6, 'Internal bars and focus helpers are not authored nodes');
      assert.deepEqual((await f.command('undo')).document, initial);
      assert.deepEqual((await f.command('redo')).document, created.document);
      await call('apply_editor_scene', { operations: [{ kind: 'delete', path: 'Scroll' }] });
      assert.equal((await f.command('inspect')).document.nodes.length, 1);
      assert.deepEqual((await f.command('undo')).document, created.document);
      assert.equal((await f.command('redo')).document.nodes.length, 1);
      assert.deepEqual((await f.command('undo')).document, created.document);
      for (const mode of [0, 2, 3, 4]) {
        await call('apply_editor_scene', {
          operations: [ui('Scroll', { horizontal_scroll_mode: mode, vertical_scroll_mode: mode, follow_focus: false })],
        });
        const configured = await f.command('inspect');
        assert.deepEqual(configured.config, {
          horizontal_scroll_mode: mode,
          vertical_scroll_mode: mode,
          follow_focus: false,
        });
        assert.deepEqual((await f.command('undo')).document, created.document);
        assert.deepEqual((await f.command('redo')).document, configured.document);
        assert.deepEqual((await f.command('undo')).document, created.document);
      }
      const expectRefusal = async (operations: Record<string, unknown>[], code: string) => {
        const r = await c.call('apply_editor_scene', { operations });
        assert.equal((r.structuredContent as { code: string }).code, code, JSON.stringify(r));
        assert.deepEqual((await f.command('inspect')).document, created.document);
        assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), originalBytes);
      };
      await expectRefusal([ui('Scroll/Content', { offset_top: 40 })], 'CONFLICT');
      await expectRefusal([ui('Scroll/Content/Top', { follow_focus: true })], 'UNSUPPORTED');
      await expectRefusal(
        [
          { kind: 'create', parent: '.', name: 'MustNotRemain', type: 'Control' },
          ui('Scroll/Content/Top', { vertical_scroll_mode: 1 }),
        ],
        'UNSUPPORTED',
      );
      await expectRefusal([{ kind: 'reparent', path: 'Scroll/Content/Top', parent: '.' }], 'CONFLICT');
      for (const internal of created.internal) {
        await expectRefusal([{ kind: 'delete', path: internal }], 'NOT_FOUND');
        await expectRefusal([ui(internal, { value: 200 })], 'NOT_FOUND');
        await expectRefusal(
          [{ kind: 'create', parent: internal, name: 'UnsafeChild', type: 'Control' }],
          'INVALID_ARGUMENT',
        );
      }
      await expectRefusal([{ kind: 'delete', path: 'Scroll/_focus' }], 'NOT_FOUND');
      await f.command('watch');
      let refused = await c.call('apply_editor_scene', { operations: [ui('Scroll', { follow_focus: false })] });
      assert.equal((refused.structuredContent as { code: string }).code, 'CONFLICT');
      await f.command('unwatch');
      assert.deepEqual((await f.command('inspect')).document, created.document);
      attachOnApproval = true;
      refused = await c.call('apply_editor_scene', { operations: [ui('Scroll', { follow_focus: false })] });
      assert.equal((refused.structuredContent as { code: string }).code, 'CONFLICT', JSON.stringify(refused));
      await f.command('unwatch');
      assert.deepEqual((await f.command('inspect')).document, created.document);
      assert.equal((await f.command('inspect')).callbacks, 0);
      await f.command('detach-native'); // Explicit native-connection corruption TEST DOUBLE.
      refused = await c.call('apply_editor_scene', { operations: [ui('Scroll', { follow_focus: false })] });
      assert.equal((refused.structuredContent as { code: string }).code, 'CONFLICT');
      await f.command('restore-native');
      assert.deepEqual((await f.command('inspect')).document, created.document);
      assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), originalBytes);
      const saved = await call('save_editor_scene');
      assert.equal(saved.persisted, true);
      assert.equal(saved.validation, 'PASS');
      const root = f.root;
      await f.command('quit');
      await f.exited;
      f = await startEditorFixture(process.env.GODOT_PATH!, { existingRoot: root, controller, writeEnabled: true });
      const reopened = await f.command('inspect');
      assert.deepEqual(reopened.config, created.config);
      // Native object IDs change after reopen; normalize only identities to
      // authored paths, retaining every property/group/signal and owner.
      const authored = (d: any) => {
        const paths = new Map(d.nodes.map((n: any) => [n.id, n.path]));
        return d.nodes.map((n: any) => ({
          ...n,
          id: n.path,
          owner: paths.get(n.owner) ?? null,
          signals: n.signals.map((s: any) => ({ ...s, target: paths.get(s.target) })),
        }));
      };
      assert.deepEqual(authored(reopened.document), authored(created.document));
      await f.command('quit');
      await f.exited;
      sessionId = (
        await call('open_runtime_bridge', {
          headless: true,
          bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
          evidenceDir: path.join(root, '.harness/scroll-runtime'),
        })
      ).session_id;
      const rpc = async (method: string, params: Record<string, unknown>) =>
        (await call('call_runtime_bridge', { sessionId, method, params })).response;
      const get = async (nodePath: string, property: string) =>
        (await rpc('get_property', { nodePath, property })).value;
      const method = (nodePath: string, method: string) => rpc('call_method', { nodePath, method, args: [] });
      const wait = () => rpc('wait_physics_frames', { frames: 3 });
      const tab = async () => {
        await rpc('inject_input', { keycode: 4194306, pressed: true });
        await rpc('inject_input', { keycode: 4194306, pressed: false });
        await wait();
      };
      const top = 'Scroll/Content/Top',
        bottom = 'Scroll/Content/Bottom';
      await wait();
      assert.equal(await get('Scroll', 'clip_contents'), true);
      assert.equal(await get('Scroll', 'follow_focus'), true);
      assert.equal(await get('Scroll', 'horizontal_scroll_mode'), 3);
      await method(top, 'grab_focus');
      await wait();
      assert.equal((await method(top, 'has_focus')).value, true);
      const beforeScroll = await get('Scroll', 'scroll_vertical');
      await tab();
      assert.equal((await method(bottom, 'has_focus')).value, true, 'Real Tab input must advance native GUI focus');
      assert.ok((await get('Scroll', 'scroll_vertical')) > beforeScroll, 'Native follow_focus must move the viewport');
      const p = await get('Scroll', 'global_position'),
        size = await get('Scroll', 'size');
      const bp = await get(bottom, 'global_position'),
        bs = await get(bottom, 'size');
      assert.ok(bp.y >= p.y && bp.y + bs.y <= p.y + size.y, JSON.stringify({ p, size, bp, bs }));
      await rpc('set_property', { nodePath: 'Scroll', property: 'follow_focus', value: false });
      await rpc('set_property', { nodePath: 'Scroll', property: 'scroll_vertical', value: 0 });
      await method(top, 'grab_focus');
      await wait();
      await tab();
      assert.equal((await method(bottom, 'has_focus')).value, true);
      assert.equal(await get('Scroll', 'scroll_vertical'), 0, 'Disabling follow_focus must not scroll on Tab');
      await call('stop_runtime_bridge', { sessionId });
      sessionId = '';
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
    } finally {
      if (sessionId) await c.call('stop_runtime_bridge', { sessionId });
      await c.close();
      await f.stop();
    }
  },
);

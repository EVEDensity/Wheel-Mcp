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
func _finished() -> void: callbacks += 1
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
\tvar label := root.get_node_or_null("Description") as RichTextLabel
\tif c.action == "watch": label.finished.connect(_finished)
\tif c.action == "unwatch": label.finished.disconnect(_finished)
\tif c.action == "watch-bar": label.get_v_scroll_bar().value_changed.connect(_changed)
\tif c.action == "unwatch-bar": label.get_v_scroll_bar().value_changed.disconnect(_changed)
\tif c.action == "watch-timer":
\t\tfor child in label.get_children(true):
\t\t\tif child is Timer: child.timeout.connect(_finished)
\tif c.action == "unwatch-timer":
\t\tfor child in label.get_children(true):
\t\t\tif child is Timer: child.timeout.disconnect(_finished)
\tif c.action == "detach-native":
\t\tnative_callback = label.get_v_scroll_bar().get_signal_connection_list("value_changed")[0].callable
\t\tlabel.get_v_scroll_bar().value_changed.disconnect(native_callback)
\tif c.action == "restore-native": label.get_v_scroll_bar().value_changed.connect(native_callback)
\tif c.action == "flag": label.set(c.property, c.value)
\tif c.action == "append": label.add_text("UNSAVED TAG STACK")
\tif c.action == "restore-text":
\t\tlabel.text = ""
\t\tlabel.text = c.text
\tvar reply := {"id": c.id, "document": Core.document(root), "callbacks": callbacks}
\tif label != null:
\t\treply["config"] = {"text": label.text, "parsed": label.get_parsed_text(), "bbcode_enabled": label.bbcode_enabled, "fit_content": label.fit_content, "scroll_active": label.scroll_active, "autowrap_mode": label.autowrap_mode}
\t\treply["internal"] = []
\t\tfor child in label.get_children(true): reply.internal.append(str(root.get_path_to(child)))
\tvar file := FileAccess.open("res://.harness/fixture-result.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify(reply))
\tfile.close()
\tif c.action == "quit": get_tree().call_deferred("quit")
`;

test(
  'real stdio plain RichTextLabel guards, native undo/redo, saved reopen and runtime wrapping',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 },
  async () => {
    let f = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      writeEnabled: true,
      scene: '[gd_scene format=3]\n[node name="Main" type="Control"]\n',
    });
    let watchOnApproval = false;
    const c = await wireEditor(f.root, {
      transport: 'stdio',
      approval: async () => {
        if (watchOnApproval) {
          await f.command('watch');
          watchOnApproval = false;
        }
        return { action: 'accept', content: { confirm: true } }; // MOCK approval, not human client UX.
      },
    });
    let sessionId = '';
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await c.call(name, args);
      assert.notEqual(r.isError, true, JSON.stringify(r));
      return r.structuredContent as Record<string, any>;
    };
    const ui = (properties: Record<string, unknown>, node = 'Description') => ({
      kind: 'ui_set',
      path: node,
      properties,
    });
    const create = { kind: 'create', parent: '.', name: 'Description', type: 'RichTextLabel' };
    const text =
      'Literal [img]res://never-load.png[/img]\nA plain description that wraps into multiple lines at a narrow width.';
    try {
      const originalBytes = await readFile(path.join(f.root, 'main.tscn'));
      const initial = (await f.command('inspect')).document;
      const readOnly = await wireEditor(f.root, { transport: 'stdio', scopes: ['read'] });
      try {
        assert.equal(
          ((await readOnly.call('apply_editor_scene', { operations: [create] })).structuredContent as { code: string })
            .code,
          'FORBIDDEN',
        );
      } finally {
        await readOnly.close();
      }
      const endpointPath = path.join(f.root, '.harness/editor-endpoint.json');
      const bytes = await readFile(endpointPath);
      const endpoint = JSON.parse(bytes.toString());
      assert.equal(endpoint.capabilities.length, 24);
      assert.ok(endpoint.capabilities.includes('scene.rich_text/v1'));
      try {
        for (const capabilities of [
          endpoint.capabilities.filter((x: string) => x !== 'scene.rich_text/v1'),
          [...endpoint.capabilities, 'overflow'],
        ]) {
          await writeFile(endpointPath, JSON.stringify({ ...endpoint, capabilities })); // Metadata TEST DOUBLE.
          const r = await c.call('apply_editor_scene', { operations: [create] });
          assert.equal((r.structuredContent as { code: string }).code, 'PROTOCOL_MISMATCH');
        }
      } finally {
        await writeFile(endpointPath, bytes);
      }
      await call('apply_editor_scene', {
        operations: [
          create,
          ui({
            text,
            offset_left: 24,
            offset_top: 24,
            offset_right: 664,
            offset_bottom: 324,
            fit_content: false,
            scroll_active: false,
            autowrap_mode: 3,
          }),
        ],
      });
      const created = await f.command('inspect');
      assert.equal(created.document.nodes.length, 2, 'Internal bar/timer must not become authored nodes');
      assert.equal(created.config.parsed, text, 'BBCode-looking input must remain literal, without resource loading');
      assert.deepEqual((await f.command('undo')).document, initial);
      assert.deepEqual((await f.command('redo')).document, created.document);
      for (const properties of [
        { text: '' },
        { text: 'x'.repeat(512) },
        { fit_content: true, scroll_active: true },
        { autowrap_mode: 0 },
        { autowrap_mode: 1 },
        { autowrap_mode: 2 },
      ]) {
        await call('apply_editor_scene', { operations: [ui(properties)] });
        const changed = await f.command('inspect');
        for (const [key, value] of Object.entries(properties)) assert.equal(changed.config[key], value);
        assert.deepEqual((await f.command('undo')).document, created.document);
        assert.deepEqual((await f.command('redo')).document, changed.document);
        assert.deepEqual((await f.command('undo')).document, created.document);
      }
      await call('apply_editor_scene', { operations: [{ kind: 'delete', path: 'Description' }] });
      assert.equal((await f.command('inspect')).document.nodes.length, 1);
      assert.deepEqual((await f.command('undo')).document, created.document);
      const refuse = async (operations: Record<string, unknown>[], code: string) => {
        const r = await c.call('apply_editor_scene', { operations });
        assert.equal((r.structuredContent as { code: string }).code, code, JSON.stringify(r));
        assert.deepEqual((await f.command('inspect')).document, created.document);
        assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), originalBytes);
      };
      await refuse([ui({ fit_content: true }, '.')], 'UNSUPPORTED');
      await refuse(
        [{ kind: 'create', parent: '.', name: 'NoResidue', type: 'Control' }, ui({ scroll_active: true }, '.')],
        'UNSUPPORTED',
      );
      for (const internal of created.internal) {
        await refuse([{ kind: 'delete', path: internal }], 'NOT_FOUND');
        await refuse([ui({ value: 20 }, internal)], 'NOT_FOUND');
      }
      await refuse([{ kind: 'create', parent: 'Description', name: 'NotALeaf', type: 'Control' }], 'CONFLICT');
      for (const action of ['watch', 'watch-bar', 'watch-timer', 'detach-native', 'append']) {
        await f.command(action);
        const r = await c.call('apply_editor_scene', { operations: [ui({ text: 'Must not commit' })] });
        assert.equal((r.structuredContent as { code: string }).code, 'CONFLICT', JSON.stringify(r));
        const save = await c.call('save_editor_scene');
        assert.equal((save.structuredContent as { code: string }).code, 'CONFLICT', JSON.stringify(save));
        assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), originalBytes);
        if (action === 'append') await f.command('restore-text', { text });
        else
          await f.command(
            (
              {
                watch: 'unwatch',
                'watch-bar': 'unwatch-bar',
                'watch-timer': 'unwatch-timer',
                'detach-native': 'restore-native',
              } as Record<string, string>
            )[action],
          );
        assert.deepEqual((await f.command('inspect')).document, created.document);
      }
      for (const property of [
        'bbcode_enabled',
        'threaded',
        'selection_enabled',
        'context_menu_enabled',
        'scroll_following',
      ]) {
        await f.command('flag', { property, value: true }); // Unsafe live settings TEST DOUBLE.
        const r = await c.call('apply_editor_scene', { operations: [ui({ text: 'No implicit conversion' })] });
        assert.equal((r.structuredContent as { code: string }).code, 'CONFLICT');
        await f.command('flag', { property, value: false });
        assert.deepEqual((await f.command('inspect')).document, created.document);
      }
      watchOnApproval = true;
      const late = await c.call('apply_editor_scene', { operations: [ui({ text: 'Must not commit after approval' })] });
      assert.equal((late.structuredContent as { code: string }).code, 'CONFLICT');
      await f.command('unwatch');
      assert.deepEqual((await f.command('inspect')).document, created.document);
      assert.equal((await f.command('inspect')).callbacks, 0);
      const saved = await call('save_editor_scene');
      assert.equal(saved.persisted, true);
      assert.equal(saved.validation, 'PASS');
      const root = f.root;
      await f.command('quit');
      await f.exited;
      f = await startEditorFixture(process.env.GODOT_PATH!, { existingRoot: root, controller, writeEnabled: true });
      const reopened = await f.command('inspect');
      assert.deepEqual(reopened.config, created.config);
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
          evidenceDir: path.join(root, '.harness/text-runtime'),
        })
      ).session_id;
      const rpc = async (method: string, params: Record<string, unknown>) =>
        (await call('call_runtime_bridge', { sessionId, method, params })).response;
      const method = async (method: string) =>
        (await rpc('call_method', { nodePath: 'Description', method, args: [] })).value;
      await rpc('wait_physics_frames', { frames: 3 });
      assert.equal(await method('get_parsed_text'), text);
      const wideLines = await method('get_line_count');
      assert.ok(wideLines >= 2);
      await rpc('set_property', {
        nodePath: 'Description',
        property: 'size',
        value: { type: 'Vector2', x: 180, y: 300 },
      });
      await rpc('wait_physics_frames', { frames: 3 });
      assert.ok((await method('get_line_count')) > wideLines, 'Native text must actually reflow at a narrower width');
      assert.ok((await method('get_content_height')) > 0);
      assert.equal(await method('get_parsed_text'), text);
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

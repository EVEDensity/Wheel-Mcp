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
var rejected := 0
func _rejected(_text: String) -> void: rejected += 1
func _enter_tree() -> void: set_process(true)
func _process(_delta: float) -> void:
\tvar root := EditorInterface.get_edited_scene_root()
\tif root == null or not FileAccess.file_exists("res://.harness/fixture-command.json"): return
\tvar c: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://.harness/fixture-command.json"))
\tDirAccess.remove_absolute(ProjectSettings.globalize_path("res://.harness/fixture-command.json"))
\tvar history := get_undo_redo().get_history_undo_redo(get_undo_redo().get_object_history_id(root))
\tif c.action == "undo": history.undo()
\tif c.action == "redo": history.redo()
\tvar entry := root.get_node_or_null("Input") as LineEdit
\tif c.action == "watch" and entry != null: entry.text_change_rejected.connect(_rejected)
\tif c.action == "unwatch" and entry != null: entry.text_change_rejected.disconnect(_rejected)
\tif c.action == "block" and entry != null: entry.set_block_signals(true)
\tif c.action == "unblock" and entry != null: entry.set_block_signals(false)
\tvar reply := {"id": c.id, "document": Core.document(root), "rejected": rejected}
\tif entry != null: reply["signalsBlocked"] = entry.is_blocking_signals()
\tif entry != null: reply["input"] = {"text": entry.text, "placeholder_text": entry.placeholder_text, "editable": entry.editable, "max_length": entry.max_length}
\tvar file := FileAccess.open("res://.harness/fixture-result.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify(reply))
\tfile.close()
\tif c.action == "quit": get_tree().call_deferred("quit")
`;
test(
  'real stdio LineEdit native approval, invalid no-op, atomic limits, undo/redo and saved reopen preserve exact input state',
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
        return { action: 'accept', content: { confirm: true } }; // MOCK host, never human UX.
      },
    });
    let sessionId = '';
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const response = await c.call(name, args);
      assert.notEqual(response.isError, true, JSON.stringify(response));
      return response.structuredContent as Record<string, any>;
    };
    const ui = (properties: Record<string, unknown>, node = 'Input') => ({ kind: 'ui_set', path: node, properties });
    try {
      const bytes = await readFile(path.join(f.root, 'main.tscn'));
      const initial = (await f.command('inspect')).document;
      const readOnly = await wireEditor(f.root, { transport: 'stdio', scopes: ['read'] });
      try {
        const denied = await readOnly.call('apply_editor_scene', {
          operations: [{ kind: 'create', parent: '.', name: 'Denied', type: 'LineEdit' }],
        });
        assert.equal((denied.structuredContent as { code: string }).code, 'FORBIDDEN');
      } finally {
        await readOnly.close();
      }
      // Explicit metadata TEST DOUBLE: simulate a missing new capability and an
      // over-budget advertisement. Restore the fixture's exact private bytes.
      const endpointPath = path.join(f.root, '.harness/editor-endpoint.json');
      const endpointBytes = await readFile(endpointPath);
      const endpoint = JSON.parse(endpointBytes.toString());
      assert.ok(endpoint.capabilities.includes('scene.line_edit/v1'));
      try {
        for (const capabilities of [
          endpoint.capabilities.filter((item: string) => item !== 'scene.line_edit/v1'),
          [...endpoint.capabilities, 'overflow'],
        ]) {
          await writeFile(endpointPath, JSON.stringify({ ...endpoint, capabilities }));
          const denied = await c.call('apply_editor_scene', {
            operations: [{ kind: 'create', parent: '.', name: 'Unsupported', type: 'LineEdit' }],
          });
          assert.equal((denied.structuredContent as { code: string }).code, 'PROTOCOL_MISMATCH');
        }
      } finally {
        await writeFile(endpointPath, endpointBytes);
      }
      assert.deepEqual((await f.command('inspect')).document, initial);
      const made = await call('apply_editor_scene', {
        operations: [
          { kind: 'create', parent: '.', name: 'Input', type: 'LineEdit' },
          ui({
            text: 'original',
            placeholder_text: 'Player name',
            editable: true,
            max_length: 12,
            offset_right: 320,
            offset_bottom: 40,
          }),
        ],
      });
      assert.equal(made.undoSteps, 1);
      assert.deepEqual((await f.command('undo')).document, initial);
      const created = await f.command('redo');
      assert.deepEqual(created.input, {
        text: 'original',
        placeholder_text: 'Player name',
        editable: true,
        max_length: 12,
      });
      for (const properties of [{ text: 'new\nline' }, { placeholder_text: 'bad\tname' }, { max_length: 2 }]) {
        const refused = await c.call('apply_editor_scene', { operations: [ui(properties)] });
        assert.equal((refused.structuredContent as { code: string }).code, 'INVALID_ARGUMENT', JSON.stringify(refused));
        assert.deepEqual((await f.command('inspect')).document, created.document);
        assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), bytes);
      }
      watchOnApproval = true;
      await call('apply_editor_scene', { operations: [ui({ max_length: 2, text: 'ok' })] });
      const changed = await f.command('inspect');
      assert.equal(changed.rejected, 0, 'Native authoring must not run a callback attached after preview');
      assert.equal(changed.input.text, 'ok');
      assert.equal(changed.input.max_length, 2);
      assert.equal(changed.signalsBlocked, false);
      assert.deepEqual((await f.command('undo')).input, created.input);
      assert.equal((await f.command('redo')).input.text, 'ok');
      assert.equal((await f.command('inspect')).rejected, 0);
      const callbackDenied = await c.call('apply_editor_scene', { operations: [ui({ editable: false })] });
      assert.equal((callbackDenied.structuredContent as { code: string }).code, 'CONFLICT');
      await f.command('unwatch');
      await f.command('block');
      await call('apply_editor_scene', { operations: [ui({ editable: false, placeholder_text: 'Choose a name' })] });
      assert.equal((await f.command('inspect')).signalsBlocked, true, 'Preserve an already-blocked native node');
      await f.command('unblock');
      const saved = await call('save_editor_scene');
      assert.equal(saved.persisted, true);
      assert.equal(saved.validation, 'PASS');
      const beforeReopen = (await f.command('inspect')).input;
      const root = f.root;
      await f.command('quit');
      await f.exited;
      f = await startEditorFixture(process.env.GODOT_PATH!, { existingRoot: root, controller, writeEnabled: true });
      assert.deepEqual((await f.command('inspect')).input, beforeReopen);
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
      await f.command('quit');
      await f.exited;
      sessionId = (
        await call('open_runtime_bridge', {
          headless: true,
          bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
          evidenceDir: path.join(root, '.harness/input-runtime'),
        })
      ).session_id;
      const rpc = async (method: string, params: Record<string, unknown>) =>
        (await call('call_runtime_bridge', { sessionId, method, params })).response;
      assert.equal((await rpc('get_property', { nodePath: 'Input', property: 'editable' })).value, false);
      await rpc('set_property', { nodePath: 'Input', property: 'editable', value: true });
      await rpc('call_method', { nodePath: 'Input', method: 'grab_focus', args: [] });
      assert.equal((await rpc('call_method', { nodePath: 'Input', method: 'has_focus', args: [] })).value, true);
      assert.equal((await rpc('call_method', { nodePath: 'Input', method: 'is_editing', args: [] })).value, true);
      await rpc('set_property', { nodePath: 'Input', property: 'caret_column', value: 2 });
      assert.equal((await rpc('get_property', { nodePath: 'Input', property: 'caret_column' })).value, 2);
      await rpc('inject_input', { keycode: 4194308, pressed: true });
      await rpc('inject_input', { keycode: 4194308, pressed: false });
      await rpc('wait_physics_frames', { frames: 2 });
      assert.equal(
        (await rpc('get_property', { nodePath: 'Input', property: 'text' })).value,
        'o',
        'Actual GUI Backspace must edit the focused LineEdit',
      );
      await rpc('set_property', { nodePath: 'Input', property: 'editable', value: false });
      await rpc('inject_input', { keycode: 4194308, pressed: true });
      await rpc('inject_input', { keycode: 4194308, pressed: false });
      await rpc('wait_physics_frames', { frames: 2 });
      assert.equal((await rpc('get_property', { nodePath: 'Input', property: 'text' })).value, 'o');
      await call('stop_runtime_bridge', { sessionId });
      sessionId = '';
    } finally {
      if (sessionId) await c.call('stop_runtime_bridge', { sessionId });
      await c.close();
      await f.stop();
    }
  },
);

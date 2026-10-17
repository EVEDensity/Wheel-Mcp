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
func _changed() -> void: callbacks += 1
func _enter_tree() -> void: set_process(true)
func _process(_delta: float) -> void:
\tvar root := EditorInterface.get_edited_scene_root()
\tif root == null or not FileAccess.file_exists("res://.harness/fixture-command.json"): return
\tvar c: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://.harness/fixture-command.json"))
\tDirAccess.remove_absolute(ProjectSettings.globalize_path("res://.harness/fixture-command.json"))
\tvar player := root.get_node_or_null("Player") as CharacterBody2D
\tvar history := get_undo_redo().get_history_undo_redo(get_undo_redo().get_object_history_id(root))
\tif c.action == "watch": player.item_rect_changed.connect(_changed)
\tif c.action == "unwatch": player.item_rect_changed.disconnect(_changed)
\tif c.action == "velocity-on": player.velocity = Vector2(1, 0)
\tif c.action == "velocity-off": player.velocity = Vector2.ZERO
\tif c.action == "human-change": player.collision_mask = 8
\tif c.action == "undo": history.undo()
\tif c.action == "redo": history.redo()
\tvar result := {"id":c.id, "document":Core.document(root), "callbacks":callbacks}
\tvar file := FileAccess.open("res://.harness/fixture-result.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify(result)); file.close()
\tif c.action == "quit": get_tree().call_deferred("quit")
`;
const create = (parent: string, name: string, type: string) => ({ kind: 'create', parent, name, type });
const config = (properties: Record<string, unknown>, node = 'Player') => ({
  kind: 'character_set',
  path: node,
  properties,
});
const v2 = (x: number, y: number) => ({ type: 'Vector2', x, y });
function authored(doc: any) {
  const paths = new Map(doc.nodes.map((n: any) => [n.id, n.path]));
  return doc.nodes.map((n: any) => ({
    ...n,
    id: n.path,
    owner: paths.get(n.owner) ?? null,
    properties: Object.fromEntries(
      Object.entries(n.properties).map(([key, value]: [string, any]) => [
        key,
        value?.resourceType
          ? { resourceType: value.resourceType, properties: value.properties, storage: value.storage }
          : value,
      ]),
    ),
  }));
}

test(
  'real stdio CharacterBody2D exact plans, shape/visual composition, native undo and saved reopen',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 },
  async () => {
    let f = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      writeEnabled: true,
      scene: '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n',
    });
    let decline = false,
      duringApproval = '';
    const c = await wireEditor(f.root, {
      transport: 'stdio',
      approval: async () => {
        if (duringApproval) {
          const action = duringApproval;
          duringApproval = '';
          await f.command(action);
        }
        return { action: decline ? 'decline' : 'accept', content: { confirm: !decline } }; // MOCK.
      },
    });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await c.call(name, args);
      assert.notEqual(r.isError, true, JSON.stringify(r));
      return r.structuredContent as Record<string, any>;
    };
    try {
      const originalBytes = await readFile(path.join(f.root, 'main.tscn'));
      const original = (await f.command('inspect')).document;
      const first = create('.', 'Player', 'CharacterBody2D');
      const ro = await wireEditor(f.root, { transport: 'stdio', scopes: ['read'] });
      try {
        assert.equal((await ro.call('apply_editor_scene', { operations: [first] })).isError, true);
      } finally {
        await ro.close();
      }
      const endpointFile = path.join(f.root, '.harness/editor-endpoint.json');
      const bytes = await readFile(endpointFile),
        endpoint = JSON.parse(bytes.toString());
      assert.equal(endpoint.capabilities.length, 29);
      try {
        for (const capabilities of [
          endpoint.capabilities.filter((v: string) => v !== 'scene.character2d/v1'),
          [...endpoint.capabilities, 'overflow'],
        ]) {
          await writeFile(endpointFile, JSON.stringify({ ...endpoint, capabilities })); // Metadata TEST DOUBLE.
          assert.equal(
            ((await c.call('apply_editor_scene', { operations: [first] })).structuredContent as any).code,
            'PROTOCOL_MISMATCH',
          );
        }
      } finally {
        await writeFile(endpointFile, bytes);
      }
      const shape = await call('manage_editor_resource', {
        request: { action: 'create', resourceType: 'RectangleShape2D', properties: { size: v2(20, 30) } },
      });
      const operations = [
        first,
        config({
          collision_layer: 2,
          collision_mask: 5,
          motion_mode: 1,
          safe_margin: 0.125,
          max_slides: 6,
          floor_snap_length: 3,
        }),
        { kind: 'set', path: 'Player', property: 'position', value: v2(40, 50) },
        create('Player', 'Collider', 'CollisionShape2D'),
        { kind: 'resource_assign', path: 'Player/Collider', property: 'shape', ref: shape.ref, policy: 'make_unique' },
        create('Player', 'Visual', 'Sprite2D'),
        { kind: 'sprite_set', path: 'Player/Visual', properties: { flip_h: true } },
      ];
      decline = true;
      assert.equal(((await c.call('apply_editor_scene', { operations })).structuredContent as any).code, 'FORBIDDEN');
      decline = false;
      assert.deepEqual((await f.command('inspect')).document, original);
      assert.equal((await call('apply_editor_scene', { operations })).undoSteps, 1);
      const created = (await f.command('inspect')).document;
      assert.deepEqual((await f.command('undo')).document, original);
      assert.deepEqual((await f.command('redo')).document, created);
      const refuse = async (ops: Record<string, unknown>[], code: string) => {
        const reply = await c.call('apply_editor_scene', { operations: ops });
        assert.equal((reply.structuredContent as any).code, code, JSON.stringify(reply));
        assert.deepEqual((await f.command('inspect')).document, created);
        assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), originalBytes);
      };
      const invalid = await c.call('apply_editor_scene', { operations: [config({ max_slides: 0 })] });
      assert.equal(invalid.isError, true, JSON.stringify(invalid));
      assert.match(JSON.stringify(invalid), /max_slides/);
      assert.deepEqual((await f.command('inspect')).document, created);
      assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), originalBytes);
      await refuse([config({ motion_mode: 0 }, 'Player/Visual')], 'UNSUPPORTED');
      await refuse([create('.', 'MustNotRemain', 'Node2D'), config({ max_slides: 4 }, '.')], 'UNSUPPORTED');
      await f.command('velocity-on');
      assert.equal(((await c.call('save_editor_scene')).structuredContent as any).code, 'CONFLICT');
      await f.command('velocity-off');
      duringApproval = 'watch';
      assert.equal(
        ((await c.call('apply_editor_scene', { operations: [config({ max_slides: 4 })] })).structuredContent as any)
          .code,
        'CONFLICT',
      );
      await f.command('unwatch');
      assert.deepEqual((await f.command('inspect')).document, created);
      duringApproval = 'human-change';
      assert.equal(
        ((await c.call('apply_editor_scene', { operations: [config({ max_slides: 4 })] })).structuredContent as any)
          .code,
        'CONFLICT',
      );
      await call('apply_editor_scene', { operations: [config({ collision_mask: 5 })] });
      assert.deepEqual((await f.command('inspect')).document, created);
      await call('apply_editor_scene', {
        operations: [{ kind: 'set', path: 'Player', property: 'position', value: v2(60, 50) }],
      });
      await f.command('watch');
      await f.command('undo');
      await f.command('redo');
      assert.equal((await f.command('unwatch')).callbacks, 0);
      await f.command('undo');
      assert.deepEqual((await f.command('inspect')).document, created);
      assert.equal((await call('save_editor_scene')).validation, 'PASS');
      const saved = await readFile(path.join(f.root, 'main.tscn'));
      await f.command('quit');
      await f.exited;
      f = await startEditorFixture(process.env.GODOT_PATH!, { existingRoot: f.root, controller, writeEnabled: true });
      assert.deepEqual(authored((await f.command('inspect')).document), authored(created));
      assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), saved);
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|ERROR:/);
    } finally {
      await c.close();
      await f.stop();
    }
  },
);

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';

const controller = `@tool
extends EditorPlugin
const Core = preload("res://addons/wheel_mcp/scene_service.gd")
func _enter_tree() -> void: set_process(true)
func _process(_delta: float) -> void:
\tvar root := EditorInterface.get_edited_scene_root()
\tif root == null or not FileAccess.file_exists("res://.harness/fixture-command.json"): return
\tvar c: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://.harness/fixture-command.json"))
\tDirAccess.remove_absolute(ProjectSettings.globalize_path("res://.harness/fixture-command.json"))
\tvar manager := get_undo_redo()
\tvar history := manager.get_history_undo_redo(manager.get_object_history_id(root))
\tif c.action == "undo": history.undo()
\tif c.action == "redo": history.redo()
\tvar file := FileAccess.open("res://.harness/fixture-result.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify({"id":c.id, "document":Core.document(root)}))
\tfile.close()
\tif c.action == "quit": get_tree().call_deferred("quit")
`;
const v3 = (x: number, y: number, z: number) => ({ type: 'Vector3', x, y, z });
const create = (parent: string, name: string, type: string) => ({ kind: 'create', parent, name, type });
const physics = (nodePath: string, properties: Record<string, unknown>) => ({
  kind: 'physics_set',
  path: nodePath,
  properties,
});
function authored(doc: any) {
  const paths = new Map(doc.nodes.map((n: any) => [n.id, n.path]));
  return doc.nodes.map((n: any) => ({
    path: n.path,
    type: n.type,
    owner: paths.get(n.owner) ?? null,
    properties: Object.fromEntries(
      Object.entries(n.properties).map(([key, value]: [string, any]) => [
        key,
        value?.resourceType
          ? { resourceType: value.resourceType, properties: value.properties, storage: value.storage }
          : value,
      ]),
    ),
    signals: n.signals,
  }));
}

test(
  'T18 real native physics authoring: handles, exact batch, undo, save/reopen and runtime readback',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 120000 },
  async () => {
    let f = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      writeEnabled: true,
      scene: '[gd_scene format=3]\n[node name="Main" type="Node3D"]\n',
    });
    let c = await wireEditor(f.root);
    const directory = path.resolve('runs/production-roadmap/T18', new Date().toISOString().replaceAll(':', '-'));
    await mkdir(directory, { recursive: true });
    const calls: unknown[] = [];
    let sessionId = '';
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const reply: any = await c.call(name, args);
      calls.push({ name, args, reply });
      assert.equal(reply.isError, undefined, JSON.stringify(reply));
      return reply.structuredContent;
    };
    try {
      const original = (await f.command('inspect')).document;
      const ref = (
        await call('manage_editor_resource', {
          request: { action: 'create', resourceType: 'BoxShape3D', properties: { size: v3(8, 0.3, 8) } },
        })
      ).ref;
      const made = await call('apply_editor_scene', {
        operations: [
          create('.', 'Rig', 'Node3D'),
          { kind: 'set', path: 'Rig', property: 'position', value: v3(10, 2, -3) },
          { kind: 'set', path: 'Rig', property: 'rotation', value: v3(0, 0.4, 0) },
          { kind: 'set', path: 'Rig', property: 'scale', value: v3(1.5, 1.5, 1.5) },
          create('Rig', 'Slab', 'StaticBody3D'),
          { kind: 'set', path: 'Rig/Slab', property: 'rotation', value: v3(0, 0, 0.25) },
          physics('Rig/Slab', { collision_layer: 2, collision_mask: 4 }),
          create('Rig/Slab', 'Shape', 'CollisionShape3D'),
          { kind: 'resource_assign', path: 'Rig/Slab/Shape', property: 'shape', ref, policy: 'shared' },
          create('Rig', 'Ray', 'RayCast3D'),
          { kind: 'set', path: 'Rig/Ray', property: 'position', value: v3(0, 4, 0) },
          physics('Rig/Ray', {
            target_position: v3(0, -8, 0),
            collision_mask: 2,
            enabled: true,
            collide_with_areas: false,
          }),
          create('Rig', 'Area', 'Area3D'),
          physics('Rig/Area', { collision_layer: 8, collision_mask: 2, monitoring: true, monitorable: false }),
          create('Rig/Area', 'Shape', 'CollisionShape3D'),
          { kind: 'resource_assign', path: 'Rig/Area/Shape', property: 'shape', ref, policy: 'make_unique' },
          physics('Rig/Area/Shape', { disabled: false }),
        ],
      });
      assert.equal(made.undoSteps, 1);
      const changed = (await f.command('inspect')).document;
      assert.notEqual(
        changed.nodes.find((n: any) => n.path === 'Rig/Slab/Shape').properties.shape.id,
        changed.nodes.find((n: any) => n.path === 'Rig/Area/Shape').properties.shape.id,
        'make_unique must detach the physical resource identity',
      );
      assert.deepEqual((await f.command('undo')).document, original);
      assert.deepEqual((await f.command('redo')).document, changed);
      for (const op of [
        physics('Rig/Slab', { collision_mask: -1 }),
        physics('Rig', { collision_mask: 4 }),
        physics('Rig/Ray', { arbitrary_property: true }),
        { kind: 'set', path: 'Rig', property: 'scale', value: v3(1, 2, 1) },
        { kind: 'set', path: 'Rig/Area', property: 'scale', value: v3(0.00001, 0.00002, 0.00001) },
      ]) {
        const refused: any = await c.call('apply_editor_scene', { operations: [op] });
        calls.push({ negative: op, refused });
        assert.equal(refused.isError, true);
        assert.deepEqual((await f.command('inspect')).document, changed);
      }
      assert.equal((await call('save_editor_scene')).validation, 'PASS');
      const bytes = await readFile(path.join(f.root, 'main.tscn'), 'utf8');
      assert.match(bytes, /collision_mask = 2/);
      assert.match(bytes, /monitorable = false/);
      const root = f.root;
      await f.command('quit');
      await f.exited;
      await c.close();
      f = await startEditorFixture(process.env.GODOT_PATH!, { existingRoot: root, controller, writeEnabled: true });
      c = await wireEditor(root);
      const reopened = (await f.command('inspect')).document;
      assert.deepEqual(
        authored(reopened),
        authored(changed),
        'every authored physics/storage property and owner survives native save/reopen',
      );
      await f.command('quit');
      await f.exited;
      sessionId = (
        await call('open_runtime_bridge', {
          bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
          headless: true,
        })
      ).session_id;
      await call('call_runtime_bridge', { sessionId, method: 'wait_physics_frames', params: { frames: 4 } });
      const ray = (await call('query_runtime_collisions', { sessionId, nodePath: 'Rig/Ray' })).response;
      assert.equal(ray.overlaps[0].name, 'Slab');
      assert.ok(Math.abs(ray.overlaps[0].point.y - (2 + (1.5 * 0.15) / Math.cos(0.25))) < 0.0001);
      const unsupported: any = await c.call('query_runtime_collisions', { sessionId, nodePath: 'Rig/Area' });
      calls.push({ negative: 'non-monitorable native overlaps', unsupported });
      assert.equal(unsupported.isError, true);
      assert.equal(unsupported.structuredContent.code, 'UNSUPPORTED');
      assert.equal(
        (await call('query_runtime_collisions', { sessionId, nodePath: 'Rig/Area', queryMode: 'intersect_shape' }))
          .response.overlaps[0].name,
        'Slab',
      );
      await call('call_runtime_bridge', {
        sessionId,
        method: 'set_property',
        params: { nodePath: 'Rig/Area', property: 'monitorable', value: true },
      });
      await call('call_runtime_bridge', { sessionId, method: 'wait_physics_frames', params: { frames: 4 } });
      const overlaps = (await call('query_runtime_collisions', { sessionId, nodePath: 'Rig/Area' })).response;
      assert.equal(overlaps.overlaps[0].name, 'Slab');
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|ERROR:/);
    } finally {
      if (sessionId) await c.call('stop_runtime_bridge', { sessionId }).catch(() => undefined);
      await c.close().catch(() => undefined);
      await f.stop();
      await writeFile(
        path.join(directory, 'physics-authoring.json'),
        JSON.stringify({ source: 'REAL', approval: 'MOCK', root: f.root, calls }, null, 2),
      );
    }
  },
);

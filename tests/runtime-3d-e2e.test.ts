import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { wireEditor } from './helpers/editor-mcp.js';
import { validateBridgeResult } from '../src/bridge-protocol.js';
import { validateCollisionQuery } from '../src/runtime/physics-query.js';

test('T18 query schema and response semantics reject invalid, opaque and counterfeit 3D success', () => {
  for (const params of [
    { nodePath: '.', collisionMask: -1 },
    { nodePath: '.', collisionMask: 0x100000000 },
    { nodePath: '.', historyLimit: 0 },
    { nodePath: '.', queryMode: 'contact' },
    { nodePath: '.', arbitraryFilter: true },
  ]) {
    assert.throws(() => validateCollisionQuery(params));
  }
  assert.equal(validateCollisionQuery({ nodePath: '.', collisionMask: 0xffffffff }).collisionMask, 0xffffffff);
  assert.throws(
    () =>
      validateBridgeResult('query_collisions', {
        schema_version: '0.1',
        source: 'REAL',
        dimension: '3D',
        overlaps: [],
        history: [],
      }),
    /Invalid 3D/,
  );
});

const godotPath = process.env.GODOT_PATH ?? '';
const bridgePath = path.resolve('godot-plugin/runtime_bridge.gd');
const scene = `[gd_scene load_steps=4 format=3]
[sub_resource type="BoxShape3D" id="Slab"]
size = Vector3(8, 0.3, 8)
[sub_resource type="SphereShape3D" id="Sensor"]
radius = 0.6
[sub_resource type="BoxShape3D" id="Probe"]
size = Vector3(0.4, 0.4, 0.4)
[node name="World" type="Node3D"]
[node name="Rig" type="Node3D" parent="."]
position = Vector3(10, 2, -3)
rotation = Vector3(0, 0.4, 0)
scale = Vector3(1.5, 1.5, 1.5)
[node name="Slab" type="StaticBody3D" parent="Rig"]
rotation = Vector3(0, 0, 0.25)
collision_layer = 2
collision_mask = 4
[node name="Shape" type="CollisionShape3D" parent="Rig/Slab"]
shape = SubResource("Slab")
[node name="Probe" type="StaticBody3D" parent="Rig"]
position = Vector3(2, 0, 0)
collision_layer = 4
collision_mask = 2
[node name="Shape" type="CollisionShape3D" parent="Rig/Probe"]
position = Vector3(-2, 0, 0)
shape = SubResource("Probe")
[node name="Disabled" type="CollisionShape3D" parent="Rig/Probe"]
position = Vector3(8, 0, 0)
shape = SubResource("Probe")
disabled = true
[node name="Area" type="Area3D" parent="Rig"]
collision_layer = 8
collision_mask = 2
[node name="Shape" type="CollisionShape3D" parent="Rig/Area"]
shape = SubResource("Sensor")
[node name="Ray" type="RayCast3D" parent="Rig"]
position = Vector3(0, 4, 0)
target_position = Vector3(0, -8, 0)
collision_mask = 2
enabled = true
[node name="Camera" type="Camera3D" parent="Rig"]
position = Vector3(0, 3, 10)
current = true
fov = 62.0
near = 0.2
far = 400.0
[node name="Agent" type="NavigationAgent3D" parent="Rig"]
target_position = Vector3(14, 2, -3)
`;

function data(result: any) {
  return result.structuredContent ?? JSON.parse(result.content.find((c: any) => c.type === 'text').text);
}
function closeTo(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 0.0001, `${actual} != ${expected} (world-space, epsilon 1e-4)`);
}

test(
  'T18 real 3D physics: slope/world coordinates, owner transforms, filters and sample cache',
  { skip: !existsSync(godotPath), timeout: 60000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-physics3d-'));
    const artifactDir = path.resolve('runs/production-roadmap/T18', new Date().toISOString().replaceAll(':', '-'));
    await mkdir(artifactDir, { recursive: true });
    await writeFile(
      path.join(root, 'project.godot'),
      '[application]\nrun/main_scene="res://main.tscn"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n',
    );
    await writeFile(path.join(root, 'main.tscn'), scene);
    const c = await wireEditor(root);
    const calls: unknown[] = [];
    let sessionId = '';
    const call = async (name: string, args: Record<string, unknown>) => {
      const result: any = await c.call(name, args);
      calls.push({ name, args, result });
      return result;
    };
    const query = async (nodePath: string, params: Record<string, unknown> = {}) => {
      const result = await call('query_runtime_collisions', { sessionId, nodePath, ...params });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return data(result).response;
    };
    try {
      const opened = await call('open_runtime_bridge', { godotPath, bridgePath, headless: true });
      assert.equal(opened.isError, undefined, JSON.stringify(opened));
      sessionId = data(opened).session_id;
      await call('call_runtime_bridge', { sessionId, method: 'wait_physics_frames', params: { frames: 4 } });
      const ray = await query('Rig/Ray');
      assert.equal(ray.dimension, '3D');
      assert.equal(ray.queryMode, 'ray');
      assert.equal(ray.coordinateSpace, 'world');
      assert.equal(ray.schedule, 'physics_process');
      assert.ok(ray.physicsFrame > 0);
      assert.equal(ray.overlaps[0].name, 'Slab');
      closeTo(ray.overlaps[0].point.x, 10);
      closeTo(ray.overlaps[0].point.y, 2 + (1.5 * 0.15) / Math.cos(0.25));
      closeTo(ray.overlaps[0].point.z, -3);
      closeTo(ray.overlaps[0].normal.x, -Math.sin(0.25) * Math.cos(0.4));
      closeTo(ray.overlaps[0].normal.y, Math.cos(0.25));
      closeTo(ray.overlaps[0].normal.z, Math.sin(0.25) * Math.sin(0.4));
      assert.equal((await query('Rig/Ray', { queryMode: 'ray', collisionMask: 16 })).overlaps.length, 0);
      const excluded = await query('Rig/Ray', { queryMode: 'ray', collisionMask: 6, exclude: ['Rig/Slab'] });
      assert.equal(excluded.overlaps[0].name, 'Probe');
      assert.equal(excluded.filterPolicy, 'explicit_query');
      const unknownOption = await call('query_runtime_collisions', {
        sessionId,
        nodePath: 'Rig/Ray',
        unknownFilter: true,
      });
      assert.equal(unknownOption.isError, true, 'named tool must reject rather than silently strip unknown filters');
      assert.equal((await query('Rig/Area')).overlaps[0].name, 'Slab');
      const shapes = await query('Rig/Probe', { queryMode: 'intersect_shape' });
      assert.equal(shapes.overlaps[0].name, 'Slab');
      assert.equal(shapes.shapeOwners.length, 1);
      assert.equal(shapes.shapeOwners[0].localTransform.origin.x, -2);
      assert.ok(shapes.overlaps.every((hit: any) => !('point' in hit) && !('normal' in hit)));
      assert.equal(shapes.historyMode, 'query_samples');
      assert.equal(shapes.contactHistory, 'NOT_IMPLEMENTED');
      const cached = await query('Rig/Probe', { queryMode: 'intersect_shape', refresh: false });
      assert.deepEqual(cached.history, shapes.history);
      assert.equal(cached.physicsFrame, shapes.physicsFrame);
      const missingCache = await call('query_runtime_collisions', {
        sessionId,
        nodePath: 'Rig/Probe',
        queryMode: 'intersect_shape',
        collisionMask: 128,
        refresh: false,
      });
      assert.equal(missingCache.isError, true);
      assert.equal(data(missingCache).code, 'CONFLICT');
      const overlapFilter = await call('query_runtime_collisions', {
        sessionId,
        nodePath: 'Rig/Area',
        queryMode: 'overlap',
        collisionMask: 4,
      });
      assert.equal(overlapFilter.isError, true);
      assert.equal(data(overlapFilter).code, 'UNSUPPORTED');
      for (const params of [{ collisionMask: -1 }, { exclude: ['Missing'] }, { queryMode: 'contact' }]) {
        const rejected = await call('call_runtime_bridge', {
          sessionId,
          method: 'query_collisions',
          params: { nodePath: 'Rig/Ray', ...params },
        });
        assert.equal(rejected.isError, true, JSON.stringify(rejected));
        assert.equal(data(rejected).code, 'exclude' in params ? 'NOT_FOUND' : 'INVALID_ARGUMENT');
      }
      const unknown = await call('get_specialized_state', { sessionId, nodePath: '.' });
      assert.equal(unknown.isError, true);
      assert.equal(data(unknown).code, 'UNSUPPORTED');
      const camera = await call('get_specialized_state', { sessionId, nodePath: 'Rig/Camera' });
      assert.equal(camera.isError, undefined, JSON.stringify(camera));
      closeTo(data(camera).response.state.camera.fov, 62);
      const nav = await call('get_specialized_state', { sessionId, nodePath: 'Rig/Agent' });
      assert.equal(nav.isError, undefined, JSON.stringify(nav));
      assert.equal(data(nav).response.state.navigation.observation, 'read_only');
      assert.equal(data(nav).response.state.navigation.pathStatus, 'NOT_INITIALIZED_OR_EMPTY');
      assert.equal(
        data(nav).response.state.navigation.synchronization,
        data(nav).response.state.navigation.map_iteration > 0 ? 'READY' : 'PENDING',
      );
      assert.deepEqual(data(nav).response.state.navigation.path, []);
      const scaled = await call('call_runtime_bridge', {
        sessionId,
        method: 'set_property',
        params: {
          nodePath: 'Rig',
          property: 'scale',
          value: { type: 'Vector3', x: 0.00001, y: 0.00002, z: 0.00001 },
        },
      });
      assert.equal(scaled.isError, undefined, JSON.stringify(scaled));
      const tiny = await call('query_runtime_collisions', {
        sessionId,
        nodePath: 'Rig/Probe',
        queryMode: 'intersect_shape',
      });
      assert.equal(tiny.isError, true, 'tiny components cannot disguise a 1:2:1 physical scale');
      assert.equal(data(tiny).code, 'UNSUPPORTED');
      await call('call_runtime_bridge', {
        sessionId,
        method: 'set_property',
        params: {
          nodePath: 'Rig',
          property: 'scale',
          value: { type: 'Vector3', x: 1.5, y: 1.5, z: 1.5 },
        },
      });
      await call('call_runtime_bridge', {
        sessionId,
        method: 'create_node',
        params: { parentPath: '..', type: 'StaticBody3D', name: 'OutsideScene' },
      });
      const outside = await call('query_runtime_collisions', { sessionId, nodePath: '../OutsideScene' });
      assert.equal(outside.isError, true, '3D physics queries are bounded to the persistent scene');
      assert.equal(data(outside).code, 'UNSUPPORTED');
      const foreignExclude = await call('query_runtime_collisions', {
        sessionId,
        nodePath: 'Rig/Ray',
        queryMode: 'ray',
        exclude: ['../OutsideScene'],
      });
      assert.equal(foreignExclude.isError, true);
      assert.equal(data(foreignExclude).code, 'UNSUPPORTED');
      let cacheFull = false;
      for (let mask = 4096; mask < 4224; mask++) {
        const sample = await call('query_runtime_collisions', {
          sessionId,
          nodePath: 'Rig/Ray',
          queryMode: 'ray',
          collisionMask: mask,
        });
        if (sample.isError) {
          assert.equal(data(sample).code, 'CONFLICT');
          cacheFull = true;
          break;
        }
      }
      assert.equal(cacheFull, true, 'cache must have a real, bounded entry limit');
      const reloaded = await call('call_runtime_bridge', { sessionId, method: 'reload_scene' });
      assert.equal(reloaded.isError, undefined, JSON.stringify(reloaded));
      const stale = await call('query_runtime_collisions', { sessionId, nodePath: 'Rig/Ray', refresh: false });
      assert.equal(stale.isError, true);
      assert.equal(data(stale).code, 'CONFLICT', 'reload clears sample history rather than replaying old identity');
      assert.equal((await query('Rig/Ray')).overlaps[0].name, 'Slab');
    } finally {
      if (sessionId) await call('stop_runtime_bridge', { sessionId }).catch(() => undefined);
      await c.close();
      await writeFile(
        path.join(artifactDir, 'runtime-3d.json'),
        JSON.stringify(
          {
            source: 'REAL',
            fixtureRoot: root,
            approval: 'MOCK',
            calls,
          },
          null,
          2,
        ),
      );
    }
  },
);

test(
  'T18 NavigationAgent3D observes a synchronized native path without advancing it',
  { skip: !existsSync(godotPath), timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-navigation3d-'));
    await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
    await writeFile(
      path.join(root, 'main.tscn'),
      `[gd_scene load_steps=2 format=3]
[ext_resource type="Script" path="res://fixture.gd" id="Fixture"]
[node name="Main" type="Node3D"]
script = ExtResource("Fixture")
[node name="Runner" type="Node3D" parent="."]
[node name="Agent" type="NavigationAgent3D" parent="Runner"]
`,
    );
    await writeFile(
      path.join(root, 'fixture.gd'),
      `extends Node3D
var initialized := false
var path_updates := 0
func _ready() -> void:
\tvar mesh := NavigationMesh.new()
\tmesh.vertices = PackedVector3Array([Vector3(-5, 0, -5), Vector3(5, 0, -5), Vector3(5, 0, 5), Vector3(-5, 0, 5)])
\tmesh.add_polygon(PackedInt32Array([0, 1, 2, 3]))
\tvar region := NavigationRegion3D.new()
\tregion.navigation_mesh = mesh
\tadd_child(region)
\t$Runner/Agent.target_position = Vector3(3, 0, 0)
func _physics_process(_delta: float) -> void:
\tif initialized: return
\tvar agent: NavigationAgent3D = $Runner/Agent
\tif NavigationServer3D.map_get_iteration_id(agent.get_navigation_map()) == 0: return
\tagent.get_next_path_position()
\tpath_updates += 1
\tinitialized = agent.get_current_navigation_path().size() > 0
`,
    );
    const c = await wireEditor(root);
    let sessionId = '';
    const calls: unknown[] = [];
    const call = async (name: string, args: Record<string, unknown>) => {
      const result: any = await c.call(name, args);
      calls.push({ name, args, result });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return data(result);
    };
    try {
      sessionId = (await call('open_runtime_bridge', { godotPath, bridgePath, headless: true })).session_id;
      let ready = false;
      for (let attempt = 0; attempt < 20 && !ready; attempt++) {
        ready = (await call('get_game_state', { sessionId, nodePath: '.', properties: ['initialized'] })).response
          .properties.initialized;
        if (!ready)
          await call('call_runtime_bridge', { sessionId, method: 'wait_physics_frames', params: { frames: 3 } });
      }
      assert.equal(ready, true, 'fixture must obtain a real synchronized navigation path');
      const before = (await call('get_game_state', { sessionId, nodePath: '.', properties: ['path_updates'] })).response
        .properties;
      let prior: any;
      for (let index = 0; index < 4; index++) {
        const state = (await call('get_specialized_state', { sessionId, nodePath: 'Runner/Agent' })).response.state
          .navigation;
        assert.equal(state.synchronization, 'READY');
        assert.equal(state.pathStatus, 'AVAILABLE');
        assert.equal(state.observation, 'read_only');
        assert.ok(state.path.length >= 2);
        assert.deepEqual(state.target_position, { type: 'Vector3', x: 3, y: 0, z: 0 });
        assert.ok(state.path.every((point: any) => point.type === 'Vector3'));
        if (prior) assert.deepEqual(state, prior, 'queries must not update path or progress');
        prior = state;
      }
      assert.deepEqual(
        (await call('get_game_state', { sessionId, nodePath: '.', properties: ['path_updates'] })).response.properties,
        before,
      );
    } finally {
      if (sessionId) await c.call('stop_runtime_bridge', { sessionId }).catch(() => undefined);
      await c.close();
      const dir = path.resolve('runs/production-roadmap/T18', new Date().toISOString().replaceAll(':', '-'));
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'navigation-3d.json'),
        JSON.stringify({ source: 'REAL', fixtureRoot: root, calls }, null, 2),
      );
    }
  },
);

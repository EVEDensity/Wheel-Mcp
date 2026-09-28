import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectTransactions } from '../src/project/transactions.js';
import { importProjectPng } from '../src/project/asset-import.js';
import { fixtureApproval } from './helpers/project-approval.js';
import { wireEditor } from './helpers/editor-mcp.js';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  const check = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  check.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, check]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(1, 0);
ihdr.writeUInt32BE(1, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const image = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
  chunk('IEND', Buffer.alloc(0)),
]);

test('T21 controlled binary candidate is approved by byte hash, commits unchanged, and rejects stale replace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-content-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="Content"\n');
  const tx = new ProjectTransactions({ projectPath: root, verifyApproval: fixtureApproval });
  const plan = await tx.prepare([{ kind: 'create', path: 'icon.png', content: image }]);
  assert.equal(plan.changes[0].afterSha256, sha(image));
  assert.match(plan.diffPreview, /binary.*SHA-256/i);
  await tx.approve(plan.operationId);
  assert.equal(await tx.apply(plan.operationId, async () => true), 'COMMITTED');
  assert.deepEqual(await readFile(path.join(root, 'icon.png')), image);
  await assert.rejects(
    tx.prepare([{ kind: 'replace', path: 'icon.png', content: Buffer.from(image), expectedSha256: '0'.repeat(64) }]),
    { code: 'CONFLICT' },
  );
  const previous = await readFile(path.join(root, 'icon.png'));
  const replacement = Buffer.from(image);
  replacement[replacement.length - 1] ^= 1;
  const rollback = await tx.prepare([
    { kind: 'replace', path: 'icon.png', content: replacement, expectedSha256: sha(previous) },
  ]);
  await tx.approve(rollback.operationId);
  assert.equal(await tx.apply(rollback.operationId, async () => false), 'ROLLED_BACK');
  assert.deepEqual(await readFile(path.join(root, 'icon.png')), previous);
});

test(
  'T21 official MCP PNG import checks native isolated import and preserves original on malformed bytes',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 120000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-content-'));
    await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="Content"\n');
    const mcp = await wireEditor(root);
    try {
      const bad = await mcp.call('import_project_png', {
        path: 'broken.png',
        dataBase64: Buffer.from('not a PNG').toString('base64'),
        expectedSha256: null,
      });
      assert.equal((bad.structuredContent as any).code, 'INVALID_ARGUMENT');
      assert.equal(existsSync(path.join(root, 'broken.png')), false);
      const corrupt = Buffer.from(image);
      corrupt[42] ^= 1;
      const corruptResult = await mcp.call('import_project_png', {
        path: 'corrupt.png',
        dataBase64: corrupt.toString('base64'),
        expectedSha256: null,
      });
      assert.equal((corruptResult.structuredContent as any).code, 'VALIDATION_FAILED');
      assert.equal(existsSync(path.join(root, 'corrupt.png')), false);
      const result = await mcp.call('import_project_png', {
        path: 'icon.png',
        dataBase64: image.toString('base64'),
        expectedSha256: null,
      });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      assert.equal((result.structuredContent as any).validation, 'PASS');
      assert.deepEqual(await readFile(path.join(root, 'icon.png')), image);
      const stale = await mcp.call('import_project_png', {
        path: 'icon.png',
        dataBase64: image.toString('base64'),
        expectedSha256: '0'.repeat(64),
      });
      assert.equal((stale.structuredContent as any).code, 'CONFLICT');
    } finally {
      await mcp.close();
    }
    const noRun = await wireEditor(root, { scopes: ['read', 'write'] });
    try {
      const rejected = await noRun.call('import_project_png', {
        path: 'denied.png',
        dataBase64: image.toString('base64'),
        expectedSha256: null,
      });
      assert.equal((rejected.structuredContent as any).code, 'FORBIDDEN');
      assert.equal(existsSync(path.join(root, 'denied.png')), false);
    } finally {
      await noRun.close();
    }
    const declined = await wireEditor(root, { approval: async () => ({ action: 'decline' }) });
    try {
      const rejected = await declined.call('import_project_png', {
        path: 'declined.png',
        dataBase64: image.toString('base64'),
        expectedSha256: null,
      });
      assert.equal((rejected.structuredContent as any).code, 'FORBIDDEN');
      assert.equal(existsSync(path.join(root, 'declined.png')), false);
    } finally {
      await declined.close();
    }
  },
);

test('T21 asset ingress rejects malformed base64, unsupported formats and unsafe paths before any write', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-content-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="Content"\n');
  const options = { verifyApproval: fixtureApproval };
  await assert.rejects(importProjectPng(root, '../outside.png', image.toString('base64'), null, options));
  await assert.rejects(importProjectPng(root, 'icon.jpg', image.toString('base64'), null, options), {
    code: 'UNSUPPORTED',
  });
  await assert.rejects(importProjectPng(root, 'icon.png', '!!!!', null, options), { code: 'INVALID_ARGUMENT' });
  assert.equal(existsSync(path.join(root, 'icon.png')), false);
});

test(
  'T21 live editor scans committed PNG and reports native imported Texture2D without fixed completion delay',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 120000 },
  async () => {
    const fixture = await startEditorFixture(process.env.GODOT_PATH!, { writeEnabled: true });
    const mcp = await wireEditor(fixture.root);
    try {
      const result = await mcp.call('import_project_png', {
        path: 'icon.png',
        dataBase64: image.toString('base64'),
        expectedSha256: null,
      });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      const content = result.structuredContent as any;
      assert.equal(content.validation, 'PASS');
      assert.equal(content.editorSynchronization.status, 'OBSERVED', JSON.stringify(content.editorSynchronization));
      assert.match(content.editorSynchronization.fileType, /Texture/);
      assert.ok(content.editorSynchronization.observations >= 1);
      assert.deepEqual(await readFile(path.join(fixture.root, 'icon.png')), image);
    } finally {
      await mcp.close();
      await fixture.stop();
    }
  },
);

test(
  'T21 2D UI/combat slice begins empty, is authored through MCP, runs, persists and retains renamed scene references',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 180000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-editor-'));
    await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="T21 2D"\n');
    let mcp = await wireEditor(root);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await mcp.call(name, args);
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return result.structuredContent as any;
    };
    let fixture: Awaited<ReturnType<typeof startEditorFixture>> | undefined;
    let sessionId = '';
    try {
      await call('import_project_png', {
        path: 'sprite.png',
        dataBase64: image.toString('base64'),
        expectedSha256: null,
      });
      const missing = await mcp.call('write_validated_project_files', {
        files: [
          {
            path: 'missing.tscn',
            expectedSha256: null,
            content:
              '[gd_scene load_steps=2 format=3]\n[ext_resource type="Texture2D" path="res://absent.png" id="1"]\n[node name="Missing" type="Sprite2D"]\ntexture = ExtResource("1")\n',
          },
        ],
      });
      assert.equal((missing.structuredContent as any).code, 'VALIDATION_FAILED');
      assert.equal(existsSync(path.join(root, 'missing.tscn')), false);
      const script =
        'extends Node2D\nvar hits := 0\nvar navigation_ready := false\nfunc _input(event: InputEvent) -> void:\n\tif event is InputEventKey and event.pressed and event.keycode == KEY_E:\n\t\thits += 1\nfunc _physics_process(_delta: float) -> void:\n\tif navigation_ready: return\n\tvar agent: NavigationAgent2D = $Agent\n\tif NavigationServer2D.map_get_iteration_id(agent.get_navigation_map()) == 0: return\n\tagent.get_next_path_position()\n\tnavigation_ready = agent.get_current_navigation_path().size() > 0\n';
      const scene = '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n';
      await call('write_validated_project_files', {
        files: [
          { path: 'combat.gd', content: script, expectedSha256: null },
          { path: 'main.tscn', content: scene, expectedSha256: null },
        ],
      });
      await mcp.close();
      fixture = await startEditorFixture(process.env.GODOT_PATH!, { existingRoot: root, writeEnabled: true });
      mcp = await wireEditor(root);
      const shape = await call('manage_editor_resource', {
        request: {
          action: 'create',
          resourceType: 'RectangleShape2D',
          properties: { size: { type: 'Vector2', x: 20, y: 20 } },
        },
      });
      await call('apply_editor_scene', {
        operations: [
          { kind: 'create', parent: '.', name: 'Player', type: 'Node2D' },
          { kind: 'set', path: 'Player', property: 'position', value: { type: 'Vector2', x: 40, y: 90 } },
          { kind: 'create', parent: '.', name: 'Enemy', type: 'StaticBody2D' },
          { kind: 'create', parent: 'Enemy', name: 'Collider', type: 'CollisionShape2D' },
          { kind: 'resource_assign', path: 'Enemy/Collider', property: 'shape', ref: shape.ref, policy: 'shared' },
          { kind: 'create', parent: '.', name: 'HUD', type: 'Control' },
          { kind: 'create', parent: 'HUD', name: 'Label', type: 'Label' },
          { kind: 'ui_set', path: 'HUD/Label', properties: { text: 'Combat ready', offset_left: 12, offset_top: 12 } },
          { kind: 'create', parent: 'HUD', name: 'Attack', type: 'Button' },
          {
            kind: 'ui_set',
            path: 'HUD/Attack',
            properties: { text: 'Attack', offset_top: 60, custom_minimum_size: { type: 'Vector2', x: 100, y: 40 } },
          },
          { kind: 'create', parent: '.', name: 'Animator', type: 'AnimationPlayer' },
          {
            kind: 'animation_clips',
            path: 'Animator',
            clips: [
              {
                id: 'advance',
                length: 1,
                loop: false,
                tracks: [
                  {
                    id: 'player_move',
                    target: 'Player',
                    property: 'position',
                    keys: [
                      { time: 0, value: { x: 40, y: 90 } },
                      { time: 1, value: { x: 80, y: 90 } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
      assert.equal((await call('save_editor_scene', {})).validation, 'PASS');
      await fixture.command('quit');
      await fixture.exited;
      await mcp.close();
      fixture = await startEditorFixture(process.env.GODOT_PATH!, { existingRoot: root, writeEnabled: true });
      mcp = await wireEditor(root);
      const state = await call('get_editor_state', {});
      assert.ok(state.sceneTree.nodes.some((n: any) => n.path === 'HUD/Attack'));
      assert.ok(state.sceneTree.nodes.some((n: any) => n.path === 'Enemy/Collider'));
      await fixture.command('quit');
      await fixture.exited;
      const beforeScript = await readFile(path.join(root, 'main.tscn'), 'utf8');
      const withScript =
        beforeScript
          .replace(/load_steps=(\d+)/, (_match, count: string) => `load_steps=${Number(count) + 3}`)
          .replace(
            /(\[gd_scene[^\n]*\]\n)/,
            '$1\n[ext_resource type="Script" path="res://combat.gd" id="T21Script"]\n[ext_resource type="Texture2D" path="res://sprite.png" id="T21Texture"]\n\n[sub_resource type="NavigationPolygon" id="T21Nav"]\nvertices = PackedVector2Array(0, 0, 320, 0, 320, 180, 0, 180)\npolygons = [PackedInt32Array(0, 1, 2, 3)]\n',
          )
          .replace(/(\[node name="Main" type="Node2D"[^\n]*\])/, '$1\nscript = ExtResource("T21Script")') +
        '\n[node name="Sprite" type="Sprite2D" parent="Player"]\ntexture = ExtResource("T21Texture")\nscale = Vector2(32, 32)\n' +
        '[node name="Nav" type="NavigationRegion2D" parent="."]\nnavigation_polygon = SubResource("T21Nav")\n' +
        '[node name="Agent" type="NavigationAgent2D" parent="."]\nposition = Vector2(40, 90)\ntarget_position = Vector2(200, 90)\n';
      await call('write_validated_project_files', {
        files: [{ path: 'main.tscn', content: withScript, expectedSha256: sha(Buffer.from(beforeScript)) }],
      });
      const runtime = await call('open_runtime_bridge', {
        headless: true,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
      });
      sessionId = runtime.session_id;
      assert.equal(
        (await call('get_game_state', { sessionId, nodePath: '.', properties: ['hits'] })).response.properties.hits,
        0,
      );
      await call('call_runtime_bridge', { sessionId, method: 'inject_input', params: { keycode: 69, pressed: true } });
      await call('call_runtime_bridge', { sessionId, method: 'wait_physics_frames', params: { frames: 3 } });
      assert.equal(
        (await call('get_game_state', { sessionId, nodePath: '.', properties: ['hits'] })).response.properties.hits,
        1,
      );
      let navigationReady = false;
      for (let attempt = 0; attempt < 20 && !navigationReady; attempt++) {
        navigationReady = (await call('get_game_state', { sessionId, nodePath: '.', properties: ['navigation_ready'] }))
          .response.properties.navigation_ready;
        if (!navigationReady)
          await call('call_runtime_bridge', { sessionId, method: 'wait_physics_frames', params: { frames: 3 } });
      }
      assert.equal(navigationReady, true);
      const navigation2D = (await call('get_specialized_state', { sessionId, nodePath: 'Agent' })).response.state
        .navigation;
      assert.ok(navigation2D.map_iteration > 0);
      assert.ok(navigation2D.path_length >= 2);
      await call('stop_runtime_bridge', { sessionId });
      sessionId = '';
      const moved = await call('move_project_scene', { from: 'main.tscn', to: 'combat.tscn' });
      assert.equal(moved.validation, 'PASS');
      assert.match(await readFile(path.join(root, 'project.godot'), 'utf8'), /main_scene="res:\/\/combat.tscn"/);
      assert.equal(existsSync(path.join(root, 'main.tscn')), false);
      assert.match(await readFile(path.join(root, 'combat.tscn'), 'utf8'), /NavigationRegion2D/);
    } finally {
      if (sessionId) await mcp.call('stop_runtime_bridge', { sessionId }).catch(() => undefined);
      await mcp.close().catch(() => undefined);
      await fixture?.stop();
    }
  },
);

test(
  'T21 3D interaction slice creates material, collision, animation and navigation through MCP, then persists and runs',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 180000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-editor-'));
    await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="T21 3D"\n');
    let mcp = await wireEditor(root);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await mcp.call(name, args);
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return result.structuredContent as any;
    };
    let fixture: Awaited<ReturnType<typeof startEditorFixture>> | undefined;
    let sessionId = '';
    try {
      const script =
        'extends Node3D\nvar interactions := 0\nvar navigation_ready := false\nfunc _input(event: InputEvent) -> void:\n\tif event is InputEventKey and event.pressed and event.keycode == KEY_E:\n\t\tinteractions += 1\nfunc _physics_process(_delta: float) -> void:\n\tif navigation_ready: return\n\tvar agent: NavigationAgent3D = $Agent\n\tif NavigationServer3D.map_get_iteration_id(agent.get_navigation_map()) == 0: return\n\tagent.get_next_path_position()\n\tnavigation_ready = agent.get_current_navigation_path().size() > 0\n';
      await call('write_validated_project_files', {
        files: [
          { path: 'interaction.gd', content: script, expectedSha256: null },
          {
            path: 'main.tscn',
            content: '[gd_scene format=3]\n[node name="Main" type="Node3D"]\n',
            expectedSha256: null,
          },
        ],
      });
      await mcp.close();
      fixture = await startEditorFixture(process.env.GODOT_PATH!, { existingRoot: root, writeEnabled: true });
      mcp = await wireEditor(root);
      const v3 = (x: number, y: number, z: number) => ({ type: 'Vector3', x, y, z });
      const color = { type: 'Color', r: 0.1, g: 0.65, b: 0.95, a: 1 };
      const mesh = await call('manage_editor_resource', {
        request: { action: 'create', resourceType: 'BoxMesh', properties: { size: v3(2, 0.25, 2) } },
      });
      const material = await call('manage_editor_resource', {
        request: {
          action: 'create',
          resourceType: 'StandardMaterial3D',
          properties: { albedo_color: color, roughness: 0.25 },
        },
      });
      const shape = await call('manage_editor_resource', {
        request: { action: 'create', resourceType: 'BoxShape3D', properties: { size: v3(8, 0.3, 8) } },
      });
      const operations = [
        { kind: 'create', parent: '.', name: 'Surface', type: 'MeshInstance3D' },
        { kind: 'resource_assign', path: 'Surface', property: 'mesh', ref: mesh.ref, policy: 'shared' },
        {
          kind: 'resource_assign',
          path: 'Surface',
          property: 'material_override',
          ref: material.ref,
          policy: 'shared',
        },
        { kind: 'create', parent: '.', name: 'Floor', type: 'StaticBody3D' },
        { kind: 'set', path: 'Floor', property: 'position', value: v3(0, -1, 0) },
        { kind: 'physics_set', path: 'Floor', properties: { collision_layer: 2, collision_mask: 2 } },
        { kind: 'create', parent: 'Floor', name: 'Collider', type: 'CollisionShape3D' },
        { kind: 'resource_assign', path: 'Floor/Collider', property: 'shape', ref: shape.ref, policy: 'shared' },
        { kind: 'create', parent: '.', name: 'Ray', type: 'RayCast3D' },
        { kind: 'set', path: 'Ray', property: 'position', value: v3(0, 2, 0) },
        {
          kind: 'physics_set',
          path: 'Ray',
          properties: { target_position: v3(0, -5, 0), collision_mask: 2, enabled: true },
        },
        { kind: 'create', parent: '.', name: 'Camera', type: 'Camera3D' },
        { kind: 'set', path: 'Camera', property: 'position', value: v3(0, 1, 5) },
        { kind: 'create', parent: '.', name: 'Animator', type: 'AnimationPlayer' },
        {
          kind: 'animation_clips',
          path: 'Animator',
          clips: [
            {
              id: 'lift',
              length: 1,
              loop: false,
              tracks: [
                {
                  id: 'surface_height',
                  target: 'Surface',
                  property: 'position',
                  keys: [
                    { time: 0, value: { x: 0, y: 0, z: 0 } },
                    { time: 1, value: { x: 0, y: 1, z: 0 } },
                  ],
                },
              ],
            },
          ],
        },
      ];
      const wrongDimension = structuredClone(operations) as any[];
      wrongDimension[14].clips[0].tracks[0].keys[0].value = { x: 0, y: 0 };
      const refused = await mcp.call('apply_editor_scene', { operations: wrongDimension });
      assert.equal((refused.structuredContent as any)?.code, 'INVALID_ARGUMENT');
      assert.equal(
        (await call('get_editor_state', {})).sceneTree.nodes.some((n: any) => n.path === 'Surface'),
        false,
      );
      await call('apply_editor_scene', { operations });
      assert.equal((await call('save_editor_scene', {})).validation, 'PASS');
      await fixture.command('quit');
      await fixture.exited;
      await mcp.close();
      fixture = await startEditorFixture(process.env.GODOT_PATH!, { existingRoot: root, writeEnabled: true });
      mcp = await wireEditor(root);
      const editor = await call('get_editor_state', {});
      assert.ok(editor.sceneTree.nodes.some((n: any) => n.path === 'Floor/Collider'));
      assert.ok(editor.sceneTree.nodes.some((n: any) => n.path === 'Animator'));
      await fixture.command('quit');
      await fixture.exited;
      const beforeNav = await readFile(path.join(root, 'main.tscn'), 'utf8');
      assert.match(beforeNav, /StandardMaterial3D/);
      assert.match(beforeNav, /AnimationLibrary/);
      const withNav =
        beforeNav
          .replace(/load_steps=(\d+)/, (_match, count: string) => `load_steps=${Number(count) + 2}`)
          .replace(
            /(\[gd_scene[^\n]*\]\n)/,
            '$1\n[ext_resource type="Script" path="res://interaction.gd" id="T21Script"]\n\n[sub_resource type="NavigationMesh" id="T21Mesh"]\nvertices = PackedVector3Array(-5, 0, -5, 5, 0, -5, 5, 0, 5, -5, 0, 5)\npolygons = [PackedInt32Array(0, 1, 2, 3)]\n',
          )
          .replace(/(\[node name="Main" type="Node3D"[^\n]*\])/, '$1\nscript = ExtResource("T21Script")') +
        '\n[node name="Nav" type="NavigationRegion3D" parent="."]\nnavigation_mesh = SubResource("T21Mesh")\n' +
        '[node name="Agent" type="NavigationAgent3D" parent="."]\ntarget_position = Vector3(3, 0, 0)\n';
      await call('write_validated_project_files', {
        files: [{ path: 'main.tscn', content: withNav, expectedSha256: sha(Buffer.from(beforeNav)) }],
      });
      const runtime = await call('open_runtime_bridge', {
        headless: true,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
      });
      sessionId = runtime.session_id;
      assert.equal(
        (await call('get_game_state', { sessionId, nodePath: '.', properties: ['interactions'] })).response.properties
          .interactions,
        0,
      );
      await call('call_runtime_bridge', { sessionId, method: 'inject_input', params: { keycode: 69, pressed: true } });
      await call('call_runtime_bridge', { sessionId, method: 'wait_physics_frames', params: { frames: 5 } });
      assert.equal(
        (await call('get_game_state', { sessionId, nodePath: '.', properties: ['interactions'] })).response.properties
          .interactions,
        1,
      );
      const ray = (await call('query_runtime_collisions', { sessionId, nodePath: 'Ray' })).response;
      assert.equal(ray.overlaps[0].name, 'Floor');
      let ready = false;
      for (let attempt = 0; attempt < 20 && !ready; attempt++) {
        ready = (await call('get_game_state', { sessionId, nodePath: '.', properties: ['navigation_ready'] })).response
          .properties.navigation_ready;
        if (!ready)
          await call('call_runtime_bridge', { sessionId, method: 'wait_physics_frames', params: { frames: 3 } });
      }
      assert.equal(ready, true);
      const navigation = (await call('get_specialized_state', { sessionId, nodePath: 'Agent' })).response.state
        .navigation;
      assert.equal(navigation.synchronization, 'READY');
      assert.equal(navigation.pathStatus, 'AVAILABLE');
      assert.ok(navigation.path.length >= 2);
      await call('stop_runtime_bridge', { sessionId });
      sessionId = '';
    } finally {
      if (sessionId) await mcp.call('stop_runtime_bridge', { sessionId }).catch(() => undefined);
      await mcp.close().catch(() => undefined);
      await fixture?.stop();
    }
  },
);

import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { startEditorFixture } from './editor-fixture.js';
import { wireEditor } from './editor-mcp.js';
import { compareScreenshots } from '../../src/godot-development.js';

/** Real author -> save -> runtime motion. No controller script or direct position-as-motion assertion. */
export async function exerciseCharacter(render: boolean) {
  const f = await startEditorFixture(process.env.GODOT_PATH!, {
    writeEnabled: true,
    scene: '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n',
  });
  const c = await wireEditor(f.root, { transport: 'stdio' }); // MOCK exact-plan approval, not human UX.
  let sessionId = '';
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const reply = await c.call(name, args);
    assert.notEqual(reply.isError, true, name + ': ' + JSON.stringify(reply));
    return reply.structuredContent as Record<string, any>;
  };
  const v2 = (x: number, y: number) => ({ type: 'Vector2', x, y });
  const create = (parent: string, name: string, type: string) => ({ kind: 'create', parent, name, type });
  const position = (node: string, x: number, y: number) => ({
    kind: 'set',
    path: node,
    property: 'position',
    value: v2(x, y),
  });
  try {
    const shape = async (x: number, y: number) =>
      (
        await call('manage_editor_resource', {
          request: { action: 'create', resourceType: 'RectangleShape2D', properties: { size: v2(x, y) } },
        })
      ).ref;
    const player = await shape(20, 20),
      wall = await shape(20, 160),
      floor = await shape(400, 20);
    const texture = (
      await call('manage_editor_resource', {
        request: {
          action: 'texture',
          source: {
            format: 'linear-gradient',
            width: 20,
            height: 20,
            colors: [
              { type: 'Color', r: 0, g: 1, b: 0, a: 1 },
              { type: 'Color', r: 0, g: 1, b: 0, a: 1 },
            ],
          },
        },
      })
    ).ref;
    const assign = (node: string, ref: unknown, property = 'shape') => ({
      kind: 'resource_assign',
      path: node,
      property,
      ref,
      policy: 'make_unique',
    });
    await call('apply_editor_scene', {
      operations: [
        create('.', 'Player', 'CharacterBody2D'),
        position('Player', 40, 80),
        {
          kind: 'character_set',
          path: 'Player',
          properties: { collision_layer: 2, collision_mask: 1, safe_margin: 0.125 },
        },
        create('Player', 'Collider', 'CollisionShape2D'),
        assign('Player/Collider', player),
        create('Player', 'Visual', 'Sprite2D'),
        assign('Player/Visual', texture, 'texture'),
        create('.', 'Wall', 'StaticBody2D'),
        position('Wall', 160, 80),
        create('Wall', 'Collider', 'CollisionShape2D'),
        assign('Wall/Collider', wall),
        create('.', 'Floor', 'StaticBody2D'),
        position('Floor', 120, 140),
        create('Floor', 'Collider', 'CollisionShape2D'),
        assign('Floor/Collider', floor),
      ],
    });
    assert.equal((await call('save_editor_scene')).persisted, true);
    const saved = await readFile(path.join(f.root, 'main.tscn'));
    await f.command('quit');
    await f.exited;
    const evidenceDir = path.join(f.root, '.harness/character-runtime');
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
    const step = (x: number, y: number, frames: number, id?: string) =>
      rpc('step_character_2d', { nodePath: 'Player', velocity: { x, y }, frames }, id);
    const get = async (property: string) => (await rpc('get_property', { nodePath: 'Player', property })).value;
    const capture = async (name: string) => {
      const file = path.join(evidenceDir, name + '.png');
      await rpc('capture_screenshot', { path: file });
      return file;
    };
    await rpc('wait_physics_frames', { frames: 3 });
    const before = render ? await capture('before') : '';
    const moved = await step(120, 0, 6, 'exact-character-motion');
    assert.equal(moved.completedFrames, 6);
    assert.equal(moved.schedule, 'physics_process');
    assert.ok(Math.abs(moved.after.x - 52) < 0.001, JSON.stringify(moved));
    assert.equal(moved.after.y, 80);
    assert.equal(moved.collidedDuringStep, false);
    assert.deepEqual(await step(120, 0, 6, 'exact-character-motion'), moved);
    assert.equal((await get('position')).x, 52, 'Duplicate operation ID must not move twice');
    const conflict = await c.call('call_runtime_bridge', {
      sessionId,
      method: 'step_character_2d',
      operationId: 'exact-character-motion',
      params: { nodePath: 'Player', velocity: { x: 100, y: 0 }, frames: 6 },
    });
    assert.equal((conflict.structuredContent as any).code, 'CONFLICT');
    if (render)
      assert.ok((await compareScreenshots(before, await capture('moved'), { threshold: 0 })).differentPixels > 100);
    await step(-120, 0, 6);
    assert.ok(Math.abs((await get('position')).x - 40) < 0.001);
    if (render)
      assert.equal((await compareScreenshots(before, await capture('restored'), { threshold: 0 })).differentPixels, 0);
    const blocked = await step(300, 0, 30);
    assert.ok(blocked.after.x > 139 && blocked.after.x < 140, JSON.stringify(blocked));
    assert.equal(blocked.onWall, true);
    assert.equal(blocked.collidedDuringStep, true);
    assert.ok(blocked.collisions.some((v: any) => v.path === 'Wall' && v.normal.x < -0.99));
    const landed = await step(0, 300, 30);
    assert.ok(landed.after.y > 119 && landed.after.y < 120, JSON.stringify(landed));
    assert.equal(landed.onFloor, true);
    assert.ok(landed.collisions.some((v: any) => v.path === 'Floor' && v.normal.y < -0.99));
    const velocity = await get('velocity');
    assert.equal(velocity.x, 0);
    assert.equal(velocity.y, 0);
    const stationary = await get('position');
    await rpc('wait_physics_frames', { frames: 10 });
    assert.deepEqual(await get('position'), stationary, 'No held velocity or autonomous loop after completion');
    for (const params of [
      { nodePath: 'Player', velocity: { x: 1001, y: 0 }, frames: 1 },
      { nodePath: 'Player', velocity: { x: 0, y: 0 }, frames: 31 },
      { nodePath: 'Wall', velocity: { x: 10, y: 0 }, frames: 1 },
      { nodePath: 'Missing', velocity: { x: 10, y: 0 }, frames: 1 },
      { nodePath: '../Player', velocity: { x: 10, y: 0 }, frames: 1 },
      { nodePath: '/root/Foreign', velocity: { x: 10, y: 0 }, frames: 1 },
    ]) {
      const reply = await c.call('call_runtime_bridge', { sessionId, method: 'step_character_2d', params });
      assert.equal(
        (reply.structuredContent as any).code,
        params.nodePath === 'Wall' ? 'UNSUPPORTED' : params.nodePath === 'Missing' ? 'NOT_FOUND' : 'INVALID_ARGUMENT',
        JSON.stringify(reply),
      );
      assert.deepEqual(await get('position'), stationary);
    }
    await rpc('set_property', { nodePath: 'Player', property: 'scale', value: v2(2, 1) });
    const scaled = await c.call('call_runtime_bridge', {
      sessionId,
      method: 'step_character_2d',
      params: { nodePath: 'Player', velocity: { x: 10, y: 0 }, frames: 1 },
    });
    assert.equal((scaled.structuredContent as any).code, 'UNSUPPORTED');
    await rpc('set_property', { nodePath: 'Player', property: 'scale', value: v2(1, 1) });
    await rpc('set_property', { nodePath: '.', property: 'process_mode', value: 4 });
    const disabled = await c.call('call_runtime_bridge', {
      sessionId,
      method: 'step_character_2d',
      params: { nodePath: 'Player', velocity: { x: 10, y: 0 }, frames: 1 },
    });
    assert.equal((disabled.structuredContent as any).code, 'UNSUPPORTED');
    assert.deepEqual(await get('position'), stationary);
    await rpc('set_property', { nodePath: '.', property: 'process_mode', value: 0 });
    // A submitted timed-out command may finish later. Query its original ID,
    // never submit a new movement to pretend that timeout rolled it back.
    const lateId = 'bounded-character-late-result';
    const late = await c.call('call_runtime_bridge', {
      sessionId,
      method: 'step_character_2d',
      operationId: lateId,
      timeoutMs: 150,
      params: { nodePath: 'Player', velocity: { x: -120, y: 0 }, frames: 30 },
    });
    assert.equal((late.structuredContent as any).code, 'UNKNOWN', JSON.stringify(late));
    await rpc('wait_physics_frames', { frames: 2 });
    const status = await call('get_runtime_operation_status', { sessionId, operationId: lateId });
    assert.equal(status.status, 'COMPLETED', JSON.stringify(status));
    assert.equal(status.result.completedFrames, 30);
    assert.ok(Math.abs((await get('position')).x - (stationary.x - 60)) < 0.01);
    const latePosition = await get('position');
    await step(-120, 0, 30, lateId);
    assert.deepEqual(await get('position'), latePosition);
    assert.deepEqual(
      await readFile(path.join(f.root, 'main.tscn')),
      saved,
      'Runtime stepping cannot save authored scene',
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

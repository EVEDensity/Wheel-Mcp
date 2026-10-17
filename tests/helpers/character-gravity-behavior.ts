import assert from 'node:assert/strict';
import { compareScreenshots } from '../../src/godot-development.js';

type Rpc = (method: string, params?: Record<string, unknown>, id?: string) => Promise<any>;
type Call = (name: string, args?: Record<string, unknown>) => Promise<any>;

/** Same authored fixture; no extra editor startup or permanent controller. */
export async function exerciseCharacterGravity(options: {
  rpc: Rpc;
  call: Call;
  rawCall: Call;
  sessionId: string;
  render: boolean;
  capture: (name: string) => Promise<string>;
  get: (property: string) => Promise<any>;
}) {
  const { rpc, call, rawCall, sessionId, render, capture, get } = options;
  const v2 = (x: number, y: number) => ({ type: 'Vector2', x, y });
  const set = (property: string, value: unknown) => rpc('set_property', { nodePath: 'Player', property, value });
  const params = (frames: number, y = 0, jumpSpeed?: number) => ({
    nodePath: 'Player',
    velocity: { x: 0, y },
    frames,
    gravity: 600,
    ...(jumpSpeed === undefined ? {} : { jumpSpeed }),
  });
  const integrate = (frames: number, y = 0, jumpSpeed?: number, id?: string) =>
    rpc('step_character_2d', params(frames, y, jumpSpeed), id);
  const unchangedRefusal = async (p: Record<string, unknown>, code: string) => {
    const before = await get('position');
    const reply = await rawCall('call_runtime_bridge', { sessionId, method: 'step_character_2d', params: p });
    assert.equal(reply.isError, true, JSON.stringify(reply));
    assert.equal(reply.structuredContent.code, code, JSON.stringify(reply));
    assert.deepEqual(await get('position'), before);
  };
  await set('position', v2(40, 60));
  const freePixels = render ? await capture('gravity-before') : '';
  const fall = await integrate(6);
  const dt = fall.dynamics.elapsedSeconds / 6;
  assert.ok(Math.abs(fall.after.y - (60 + 600 * dt * dt * 21)) < 0.001, JSON.stringify(fall));
  assert.ok(Math.abs(fall.velocity.y - 60) < 0.001);
  assert.equal(fall.dynamics.jumped, false);
  assert.equal(fall.dynamics.speedClamped, false);
  const pausedPosition = await get('position');
  await rpc('wait_physics_frames', { frames: 6 });
  assert.deepEqual(
    await get('position'),
    pausedPosition,
    'Finite gravity command must not leave autonomous physics enabled',
  );
  if (render)
    assert.ok(
      (await compareScreenshots(freePixels, await capture('gravity-fallen'), { threshold: 0 })).differentPixels > 50,
    );
  const ground = await integrate(30, fall.velocity.y);
  assert.equal(ground.onFloor, true);
  assert.equal(ground.velocity.y, 0);
  assert.ok(ground.collisions.some((c: any) => c.path === 'Floor' && c.normal.y < -0.99));
  const floorPosition = await get('position');
  assert.ok(floorPosition.y >= 120 - 0.125 - 0.001 && floorPosition.y <= 120 + 0.001);
  const floorPixels = render ? await capture('gravity-floor') : '';
  const jumped = await integrate(6, 0, 200, 'gravity-exact-jump');
  assert.equal(jumped.dynamics.jumped, true);
  assert.equal(jumped.onFloor, false);
  const idealJumpY = floorPosition.y - 20 + 3.5;
  // Native move_and_slide also recovers the initial floor contact, bounded by
  // this fixture's independently authored safe_margin=0.125. Freefall above
  // still requires the exact semi-implicit integration oracle (0.001).
  assert.ok(
    jumped.after.y >= idealJumpY - 0.125 - 0.001 && jumped.after.y <= idealJumpY + 0.001,
    JSON.stringify(jumped),
  );
  assert.ok(Math.abs(jumped.velocity.y + 140) < 0.001);
  const midAir = await get('position');
  assert.deepEqual(await integrate(6, 0, 200, 'gravity-exact-jump'), jumped);
  assert.deepEqual(
    await get('position'),
    midAir,
    'Replaying an accepted jump must not jump twice, even while airborne',
  );
  await unchangedRefusal(params(1, 0, 200), 'CONFLICT');
  if (render)
    assert.ok(
      (await compareScreenshots(floorPixels, await capture('gravity-jumped'), { threshold: 0 })).differentPixels > 100,
    );
  const arc = await integrate(24, jumped.velocity.y);
  assert.ok(arc.velocity.y > 0);
  assert.equal(arc.onFloor, false);
  const landed = await integrate(30, arc.velocity.y);
  assert.equal(landed.onFloor, true);
  assert.equal(landed.velocity.y, 0);
  assert.equal(landed.after.x, 40);
  assert.ok(landed.after.y >= 120 - 0.125 - 0.001 && landed.after.y <= 120 + 0.001, JSON.stringify(landed));
  assert.ok(landed.collisions.some((c: any) => c.path === 'Floor' && c.normal.y < -0.99));
  if (render)
    assert.equal(
      (await compareScreenshots(floorPixels, await capture('gravity-landed'), { threshold: 0 })).differentPixels,
      0,
    );
  await set('position', v2(40, 60));
  assert.equal(
    (await rpc('call_method', { nodePath: 'Player', method: 'is_on_floor', args: [] })).value,
    true,
    'Fixture deliberately retains a stale native floor flag after teleport',
  );
  await unchangedRefusal(params(1, 0, 200), 'CONFLICT');
  for (const p of [
    { ...params(1), gravity: -1 },
    { ...params(1), gravity: 4001 },
    { ...params(1), jumpSpeed: 0 },
    { ...params(1), jumpSpeed: 200, velocity: { x: 0, y: 1 } },
  ])
    await unchangedRefusal(p, 'INVALID_ARGUMENT');
  await set('motion_mode', 1);
  await unchangedRefusal(params(1), 'UNSUPPORTED');
  await set('motion_mode', 0);
  await set('up_direction', v2(1, 0));
  await unchangedRefusal(params(1), 'UNSUPPORTED');
  await set('up_direction', v2(0, -1));
  await set('collision_mask', 0);
  const clamped = await rpc('step_character_2d', { ...params(6, 990), gravity: 4000 });
  assert.equal(clamped.dynamics.speedClamped, true);
  assert.equal(clamped.velocity.y, 1000);
  assert.ok(Math.abs(clamped.after.y - (clamped.before.y + 100)) < 0.001);
  await set('collision_mask', 1);
  await set('position', v2(280, floorPosition.y));
  await integrate(2);
  const highJump = await integrate(10, 0, 400);
  const ceiling = await integrate(1, highJump.velocity.y);
  assert.equal(ceiling.onCeiling, true, JSON.stringify(ceiling));
  assert.ok(ceiling.collisions.some((c: any) => c.path === 'Ceiling' && c.normal.y > 0.99));
  assert.equal(ceiling.velocity.y, 0);
  await set('position', v2(40, 60));
  const lateId = 'gravity-late-completion';
  const late = await rawCall('call_runtime_bridge', {
    sessionId,
    method: 'step_character_2d',
    operationId: lateId,
    timeoutMs: 150,
    params: params(30),
  });
  assert.equal(late.structuredContent.code, 'UNKNOWN', JSON.stringify(late));
  await rpc('wait_physics_frames', { frames: 2 });
  const status = await call('get_runtime_operation_status', { sessionId, operationId: lateId });
  assert.equal(status.status, 'COMPLETED', JSON.stringify(status));
  assert.equal(status.result.dynamics.gravity, 600);
  assert.equal(status.result.dynamics.jumped, false);
  const finalPosition = await get('position');
  assert.deepEqual(await integrate(30, 0, undefined, lateId), status.result);
  assert.deepEqual(await get('position'), finalPosition);
  const velocity = await get('velocity');
  assert.equal(velocity.x, 0);
  assert.equal(velocity.y, 0);
}

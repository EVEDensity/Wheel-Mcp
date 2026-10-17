import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCharacterStep } from '../src/runtime/character-step.js';
import { validateBridgeResult } from '../src/bridge-protocol.js';
import { authorizeToolCall, createClientPolicy } from '../src/mcp/access-policy.js';
import { PersistentRuntimeBridge, RUNTIME_WRITE_METHODS } from '../src/persistent-runtime-bridge.js';

const step = { nodePath: 'Player', velocity: { x: 120, y: 0 }, frames: 6 };
test('character steps have a closed finite velocity/frame grammar without script or method names', () => {
  assert.deepEqual(validateCharacterStep(step), step);
  for (const extra of [
    { frames: 0 },
    { frames: 31 },
    { frames: 1.5 },
    { velocity: { x: 1001, y: 0 } },
    { velocity: { x: NaN, y: 0 } },
    { velocity: { type: 'Vector2', x: 0, y: 0 } },
    { nodePath: '' },
    { nodePath: '../Player' },
    { nodePath: '/root/Foreign' },
    { nodePath: 'Player:position' },
    { nodePath: '%Player' },
    { nodePath: 'Group//Player' },
    { script: 'res://controller.gd' },
    { method: 'queue_free' },
  ])
    assert.throws(() => validateCharacterStep({ ...step, ...extra }), { code: 'INVALID_ARGUMENT' });
});

test('character observations require exact consecutive physics frames and bounded typed last-frame contacts', () => {
  const result = {
    schema_version: '0.1',
    source: 'REAL',
    capability: 'RUNTIME_CHARACTER_STEP',
    runtime: true,
    persisted: false,
    schedule: 'physics_process',
    nodePath: 'Player',
    frames: 6,
    completedFrames: 6,
    startPhysicsFrame: 100,
    physicsFrame: 105,
    before: { x: 40, y: 80 },
    after: { x: 52, y: 80 },
    velocity: step.velocity,
    velocityReset: true,
    collided: false,
    collidedDuringStep: false,
    onFloor: false,
    onWall: false,
    onCeiling: false,
    collisions: [],
  };
  assert.deepEqual(validateBridgeResult('step_character_2d', result), result);
  for (const extra of [
    { completedFrames: 5 },
    { physicsFrame: 106 },
    { persisted: true },
    { velocityReset: false },
    { schedule: 'idle' },
    { collisions: Array(9).fill({}) },
    { source: 'MOCK' },
    { controllerInstalled: true },
  ])
    assert.throws(() => validateBridgeResult('step_character_2d', { ...result, ...extra }), {
      code: 'PROTOCOL_MISMATCH',
    });
  // The shared Variant guard rejects non-finite numbers before the method schema.
  assert.throws(() => validateBridgeResult('step_character_2d', { ...result, after: { x: Infinity, y: 0 } }), {
    code: 'UNSUPPORTED',
  });
});

test('character movement requires run/write, owned session, explicit capability and write-operation replay classification', async () => {
  for (const scopes of [['read'], ['read', 'run'], ['read', 'write']]) {
    const policy = createClientPolicy({
      clientId: 'restricted',
      scopes: scopes as ('read' | 'write' | 'run')[],
      projectRoots: [],
      evidenceRoots: [],
    });
    policy.ownedBridgeSessions.add('owned');
    await assert.rejects(
      authorizeToolCall(policy, 'call_runtime_bridge', {
        sessionId: 'owned',
        method: 'step_character_2d',
        params: step,
      }),
      { code: 'FORBIDDEN' },
    );
  }
  const full = createClientPolicy({
    clientId: 'full',
    scopes: ['read', 'write', 'run'],
    projectRoots: [],
    evidenceRoots: [],
  });
  await assert.rejects(
    authorizeToolCall(full, 'call_runtime_bridge', { sessionId: 'foreign', method: 'step_character_2d', params: step }),
    { code: 'FORBIDDEN' },
  );
  full.ownedBridgeSessions.add('owned');
  await assert.doesNotReject(
    authorizeToolCall(full, 'call_runtime_bridge', { sessionId: 'owned', method: 'step_character_2d', params: step }),
  );
  assert.equal(RUNTIME_WRITE_METHODS.has('step_character_2d'), true);
  await assert.rejects(
    PersistentRuntimeBridge.prototype.request.call(
      { closed: false, sessionId: 'owned', handshake: { capabilities: ['step_character_2d'] } } as any,
      'step_character_2d',
      step,
    ),
    { code: 'UNSUPPORTED' },
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCharacterStep, validateCharacterObservation } from '../src/runtime/character-step.js';
import { validateBridgeResult } from '../src/bridge-protocol.js';
import { PersistentRuntimeBridge } from '../src/persistent-runtime-bridge.js';

const request = { nodePath: 'Player', velocity: { x: 0, y: 0 }, frames: 6, gravity: 600, jumpSpeed: 200 };
test('bounded gravity/jump grammar requires explicit gravity and rejects implicit controller fields', () => {
  assert.deepEqual(validateCharacterStep(request), request);
  for (const extra of [
    { gravity: -1 },
    { gravity: 4001 },
    { gravity: NaN },
    { gravity: 0 },
    { gravity: undefined },
    { jumpSpeed: 0 },
    { jumpSpeed: 1001 },
    { jumpSpeed: true },
    { velocity: { x: 0, y: -1 } },
    { controller: 'permanent' },
  ])
    assert.throws(() => validateCharacterStep({ ...request, ...extra }), { code: 'INVALID_ARGUMENT' });
  assert.deepEqual(validateCharacterStep({ ...request, gravity: 0, jumpSpeed: undefined }).gravity, 0);
});

test('gravity observations must retain bounded metadata and match original request, including late replies', () => {
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
    before: { x: 40, y: 120 },
    after: { x: 40, y: 103 },
    velocity: { x: 0, y: -140 },
    velocityReset: true,
    collided: false,
    collidedDuringStep: false,
    onFloor: false,
    onWall: false,
    onCeiling: false,
    collisions: [],
    dynamics: { gravity: 600, jumpSpeed: 200, jumped: true, speedClamped: false, elapsedSeconds: 0.1 },
  };
  assert.doesNotThrow(() => validateCharacterObservation(request, validateBridgeResult('step_character_2d', result)));
  for (const extra of [
    { nodePath: 'Other' },
    { frames: 5 },
    { dynamics: undefined },
    { dynamics: { ...result.dynamics, gravity: 700 } },
    { dynamics: { ...result.dynamics, jumpSpeed: 210 } },
  ])
    assert.throws(() => validateCharacterObservation(request, { ...result, ...extra }), { code: 'PROTOCOL_MISMATCH' });
  for (const extra of [
    { elapsedSeconds: 0 },
    { elapsedSeconds: 4 },
    { jumpSpeed: 0 },
    { gravity: 0 },
    { jumped: false },
  ])
    assert.throws(
      () => validateBridgeResult('step_character_2d', { ...result, dynamics: { ...result.dynamics, ...extra } }),
      { code: 'PROTOCOL_MISMATCH' },
    );
});

test('older runtime gravity capability is refused before dispatch while legacy step capability remains required', async () => {
  await assert.rejects(
    PersistentRuntimeBridge.prototype.request.call(
      {
        closed: false,
        sessionId: 'owned',
        handshake: { capabilities: ['step_character_2d', 'character.step2d/v1'] },
      } as any,
      'step_character_2d',
      request,
    ),
    { code: 'UNSUPPORTED' },
  );
});

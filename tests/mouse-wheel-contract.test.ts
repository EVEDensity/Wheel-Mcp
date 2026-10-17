import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMouseWheel } from '../src/runtime/mouse-wheel.js';
import { validateBridgeResult } from '../src/bridge-protocol.js';
import { authorizeToolCall, createClientPolicy } from '../src/mcp/access-policy.js';
import { PersistentRuntimeBridge } from '../src/persistent-runtime-bridge.js';

const tick = { type: 'mouse_wheel', direction: 'down', position: { x: 80, y: 80 } };
test('wheel input has explicit bounded viewport coordinates, direction and positive factor', () => {
  for (const direction of ['up', 'down', 'left', 'right'])
    assert.deepEqual(validateMouseWheel({ ...tick, direction }), { ...tick, direction, factor: 1 });
  for (const extra of [
    { factor: 0 },
    { factor: 8.1 },
    { factor: NaN },
    { direction: 'diagonal' },
    { position: { x: -1, y: 0 } },
    { position: { x: Infinity, y: 0 } },
    { position: { x: 0, y: 16385 } },
    { position: { x: 0, y: 0, nodePath: 'Scroll' } },
    { pressed: true },
    { keycode: 1 },
    { nodePath: 'Scroll' },
  ])
    assert.throws(() => validateMouseWheel({ ...tick, ...extra }), { code: 'INVALID_ARGUMENT' });
});
test('wheel observations must retain typed runtime input fields; acceptance does not assert consumption', () => {
  const value = {
    ...tick,
    factor: 1,
    schema_version: '0.1',
    source: 'REAL',
    runtime: true,
    capability: 'RUNTIME_INPUT_INJECTION',
    accepted: true,
  };
  assert.deepEqual(validateBridgeResult('inject_input', value), value);
  for (const extra of [
    { position: null },
    { factor: 0 },
    { runtime: false },
    { direction: 'diagonal' },
    { capability: 'GUI_SCROLLED' },
  ])
    assert.throws(() => validateBridgeResult('inject_input', { ...value, ...extra }), { code: 'PROTOCOL_MISMATCH' });
});
test('wheel injection remains write/run scoped and requires explicit runtime capability', async () => {
  const policy = createClientPolicy({
    clientId: 'wheel-readonly',
    scopes: ['read'],
    projectRoots: [],
    evidenceRoots: [],
  });
  policy.ownedBridgeSessions.add('owned');
  await assert.rejects(
    authorizeToolCall(policy, 'call_runtime_bridge', { sessionId: 'owned', method: 'inject_input', params: tick }),
    { code: 'FORBIDDEN' },
  );
  // Host capability TEST DOUBLE: an older runtime must fail before dispatch.
  await assert.rejects(
    PersistentRuntimeBridge.prototype.request.call(
      { closed: false, sessionId: 'owned', handshake: { capabilities: ['inject_input'] } } as any,
      'inject_input',
      tick,
    ),
    { code: 'UNSUPPORTED' },
  );
});

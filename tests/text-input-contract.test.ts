import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTextInput, validateTextObservation } from '../src/runtime/text-input.js';
import { validateBridgeResult } from '../src/bridge-protocol.js';
import { PersistentRuntimeBridge } from '../src/persistent-runtime-bridge.js';
import { authorizeToolCall, createClientPolicy } from '../src/mcp/access-policy.js';

const request = { type: 'text', text: '中' };
test('committed text requires exactly one bounded Unicode scalar, no controls or shortcut fields', () => {
  for (const text of ['A', ' ', '中', 'é', '🚀', '\u0301', String.fromCodePoint(0x10ffff)])
    assert.deepEqual(validateTextInput({ type: 'text', text }), { type: 'text', text });
  for (const text of [
    '',
    'AB',
    '中文',
    'e\u0301',
    '\n',
    '\t',
    '\0',
    '\u007f',
    '\u0085',
    '\u009f',
    '\u2028',
    '\u2029',
    '\ud800',
    '\udfff',
    '🚀🚀',
  ])
    assert.throws(() => validateTextInput({ type: 'text', text }), { code: 'INVALID_ARGUMENT' });
  for (const extra of [
    { text: 65 },
    { keycode: 65 },
    { pressed: true },
    { ctrl: true },
    { nodePath: 'Entry' },
    { composition: true },
  ])
    assert.throws(() => validateTextInput({ ...request, ...extra }), { code: 'INVALID_ARGUMENT' });
});

test('text observations are typed and correlated to the exact request, not a consumption claim', () => {
  const response = {
    schema_version: '0.1',
    source: 'REAL',
    capability: 'RUNTIME_INPUT_INJECTION',
    runtime: true,
    type: 'text',
    unicode: 0x4e2d,
    accepted: true,
  };
  assert.doesNotThrow(() => validateTextObservation(request, validateBridgeResult('inject_input', response)));
  for (const extra of [
    { unicode: 65 },
    { type: 'key' },
    { unicode: undefined },
    { accepted: false },
    { runtime: false },
    { consumed: true },
    { unicode: 0xd800 },
    { unicode: 1.5 },
  ])
    assert.throws(() => validateTextObservation(request, { ...response, ...extra }), { code: 'PROTOCOL_MISMATCH' });
  assert.throws(() => validateTextObservation({ type: 'mouse_wheel' }, response), { code: 'PROTOCOL_MISMATCH' });
  for (const unicode of [0, 0x85, 0x2028, 0x2029, 0xdfff, 0x110000])
    assert.throws(() => validateBridgeResult('inject_input', { ...response, unicode }), { code: 'PROTOCOL_MISMATCH' });
  // The shared Variant guard rejects non-finite values before method schemas.
  assert.throws(() => validateBridgeResult('inject_input', { ...response, unicode: NaN }), { code: 'UNSUPPORTED' });
});

test('committed text keeps write/run ownership and refuses older runtime capability before dispatch', async () => {
  for (const scopes of [['read'], ['read', 'run'], ['read', 'write']] as const) {
    const policy = createClientPolicy({
      clientId: 'text-contract',
      scopes: [...scopes],
      projectRoots: [],
      evidenceRoots: [],
    });
    policy.ownedBridgeSessions.add('owned');
    await assert.rejects(
      authorizeToolCall(policy, 'call_runtime_bridge', { sessionId: 'owned', method: 'inject_input', params: request }),
      { code: 'FORBIDDEN' },
    );
  }
  await assert.rejects(
    PersistentRuntimeBridge.prototype.request.call(
      { closed: false, sessionId: 'owned', handshake: { capabilities: ['inject_input'] } } as any,
      'inject_input',
      request,
    ),
    { code: 'UNSUPPORTED' },
  );
});

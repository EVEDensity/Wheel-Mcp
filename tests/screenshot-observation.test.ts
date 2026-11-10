import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { WheelError } from '../src/error-schema.js';
import {
  BridgeProtocolError,
  validateBridgeResult,
  validateBridgeHandshake,
  BRIDGE_PROTOCOL_VERSION,
} from '../src/bridge-protocol.js';

const screenshot = { schema_version: '0.1', source: 'REAL', path: '/shot.png', width: 320, height: 180 };
const sample = { processFrame: 2, physicsFrame: 2, postDrawSequence: 1, ticksUsec: 10, sceneInstanceId: '123' };
const window = {
  backgroundRequested: true,
  mode: 1,
  unfocusable: true,
  focused: false,
  mouseMode: 0,
  position: { x: -32000, y: -32000 },
  size: { width: 320, height: 180 },
  inputIsolation: 'NOT_VERIFIED',
  foregroundOwner: 'NOT_MEASURED',
};
const observation = {
  request: sample,
  readback: { ...sample, ticksUsec: 20, postDrawSequence: 2 },
  window,
  renderer: { method: 'forward_plus', adapterName: 'fixture adapter' },
  viewportRid: '12',
  synchronization: 'deferred_force_draw',
  stateConsistency: 'NOT_VERIFIED',
  screenPresent: 'NOT_VERIFIED',
};

test('screenshot evidence remains optional for legacy bridges and validates complete new observations', () => {
  assert.equal(validateBridgeResult('capture_screenshot', screenshot), screenshot);
  const value = { ...screenshot, captureObservation: observation };
  assert.equal(validateBridgeResult('capture_screenshot', value), value);
});

test('screenshot evidence rejects malformed bounds, scene changes and invented isolation certificates', () => {
  const bad = [
    null,
    {},
    ...(['ticksUsec', 'processFrame', 'physicsFrame', 'postDrawSequence'] as const).map((key) => ({
      ...observation,
      readback: { ...observation.readback, [key]: sample[key] - 1 },
    })),
    { ...observation, readback: { ...observation.readback, postDrawSequence: sample.postDrawSequence } },
    { ...observation, readback: { ...observation.readback, sceneInstanceId: '456' } },
    { ...observation, request: { ...sample, sceneInstanceId: null } },
    { ...observation, window: { ...window, inputIsolation: 'PASS' } },
    { ...observation, screenPresent: 'PASS' },
  ];
  for (const captureObservation of bad) {
    assert.throws(
      () => validateBridgeResult('capture_screenshot', { ...screenshot, captureObservation }),
      BridgeProtocolError,
    );
  }
  assert.throws(
    () =>
      validateBridgeResult('capture_screenshot', {
        ...screenshot,
        captureObservation: {
          ...observation,
          readback: { ...observation.readback, ticksUsec: Number.MAX_SAFE_INTEGER + 1 },
        },
      }),
    (error: unknown) => error instanceof WheelError && error.code === 'UNSUPPORTED',
  );
});

test('startup window observations validate actual values without requiring the new field from old bridges', () => {
  const identity = { projectPath: path.resolve('game'), runId: 'capture-test' };
  const runtimeConditions = {
    renderer: 'forward_plus',
    displayServer: 'windows',
    viewport: { width: 320, height: 180 },
    physicsTicksPerSecond: 60,
    physicsFrame: 0,
    replaySeed: null,
  };
  const ready = {
    ...identity,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    bridgeVersion: '0.3.5',
    godotVersion: '4.7.2',
    plane: 'runtime',
    capabilities: ['screenshot.observation/v1'],
    runtimeConditions,
  };
  assert.doesNotThrow(() => validateBridgeHandshake(ready, identity));
  const observed = { ...ready, runtimeConditions: { ...runtimeConditions, windowObservation: window } };
  assert.doesNotThrow(() => validateBridgeHandshake(observed, identity));
  assert.throws(
    () =>
      validateBridgeHandshake(
        { ...ready, runtimeConditions: { ...runtimeConditions, windowObservation: { ...window, focused: 'false' } } },
        identity,
      ),
    BridgeProtocolError,
  );
});

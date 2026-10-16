import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { backgroundRenderArguments } from '../src/render-window.js';
import { BRIDGE_PROTOCOL_VERSION, validateBridgeHandshake } from '../src/bridge-protocol.js';

test('background rendering uses an off-screen window, never dummy/headless or a forced resolution', () => {
  assert.deepEqual(backgroundRenderArguments(false), []);
  assert.deepEqual(backgroundRenderArguments(true), ['--windowed', '--position', '-32000,-32000', '--single-window']);
});

test('runtime window metadata accepts native flags and rejects malformed quiet-render claims', () => {
  const projectPath = path.resolve('fixture');
  const data = {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    bridgeVersion: '0.3.0',
    godotVersion: '4.7.2.stable',
    plane: 'runtime',
    projectPath,
    runId: 'quiet-window',
    capabilities: ['capture_screenshot'],
    runtimeConditions: {
      renderer: 'gl_compatibility',
      displayServer: 'windows',
      viewport: { width: 320, height: 180 },
      physicsTicksPerSecond: 60,
      physicsFrame: 3,
      replaySeed: null,
      window: { background: true, mode: 1, unfocusable: true },
    },
  };
  const expected = { projectPath, runId: data.runId };
  assert.deepEqual(validateBridgeHandshake(data, expected).runtimeConditions?.window, data.runtimeConditions.window);
  for (const window of [
    { background: 'true', mode: 1, unfocusable: true },
    { background: true, mode: '1', unfocusable: true },
    { background: true, mode: 1, unfocusable: null },
  ])
    assert.throws(
      () => validateBridgeHandshake({ ...data, runtimeConditions: { ...data.runtimeConditions, window } }, expected),
      /window conditions/,
    );
});

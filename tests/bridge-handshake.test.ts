import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BRIDGE_PROTOCOL_VERSION, validateBridgeHandshake } from '../src/bridge-protocol.js';
import { PersistentRuntimeBridge } from '../src/persistent-runtime-bridge.js';

const godotPath = process.env.GODOT_PATH ?? '';

test('engine identity and announced capabilities are validated independently of executable filename', () => {
  const projectPath = path.resolve('fixture');
  const valid = {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    bridgeVersion: '0.2.0',
    godotVersion: '4.7.2.stable',
    plane: 'runtime',
    projectPath,
    runId: 'test-run',
    capabilities: ['get_property', 'stop'],
  };
  const expected = { projectPath, runId: 'test-run' };
  assert.equal(validateBridgeHandshake(valid, expected).versionVerification, 'VERIFIED');
  assert.equal(
    validateBridgeHandshake({ ...valid, godotVersion: 'custom-build' }, expected).versionVerification,
    'NOT_VERIFIED',
  );
  assert.throws(
    () => validateBridgeHandshake({ ...valid, godotVersion: '3.5.0' }, expected),
    /outside the supported runtime range/,
  );
  assert.throws(() => validateBridgeHandshake({ ...valid, capabilities: ['stop', 'stop'] }, expected), /duplicates/);
  assert.throws(() => validateBridgeHandshake({ ...valid, runId: 'foreign' }, expected), /identity/);
});

test(
  'real Godot handshake announces methods and unannounced methods fail before dispatch',
  {
    skip: !existsSync(godotPath),
    timeout: 30000,
  },
  async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), 'wheel-handshake-'));
    await writeFile(path.join(projectPath, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
    await writeFile(path.join(projectPath, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n');
    const bridge = await PersistentRuntimeBridge.start({
      projectPath,
      godotPath,
      bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
      evidenceDir: path.join(projectPath, '.harness', 'handshake'),
      headless: true,
    });
    try {
      assert.equal(bridge.handshake?.versionVerification, 'VERIFIED');
      assert.ok(bridge.handshake?.capabilities.includes('get_scene_tree'));
      await assert.rejects(bridge.request('method_not_announced'), /did not announce/);
      const tree = await bridge.request('get_scene_tree');
      assert.equal((tree as Record<string, unknown>).capability, 'RUNTIME_SCENE_TREE');
    } finally {
      await bridge.stop();
    }
  },
);

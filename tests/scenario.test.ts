import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadScenario, executeScenario } from '../src/scenario-executor.js';
import { existsSync } from 'node:fs';
import { runRegistry } from '../src/run-registry.js';

test('scenario loader accepts YAML and failed event assertions are recorded', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'godot-mcp-scenario-'));
  const scenarioPath = path.join(root, 'scenario.yaml');
  await writeFile(
    scenarioPath,
    'name: missing-event\nproject: .\nsteps:\n  - assert:\n      event: never_emitted\n      timeoutMs: 20\n',
  );
  const scenario = await loadScenario(scenarioPath);
  const result = await executeScenario({
    scenario,
    scenarioPath,
    evidenceDir: path.join(root, 'evidence'),
    godotPath: 'D:/tools/Godot_v4.7.2-stable_win64_console.exe',
    bridgePath: path.join(root, 'bridge.gd'),
    globalTimeoutMs: 1000,
  });
  assert.equal(result.source, 'REAL');
  assert.equal(result.status, 'FAIL');
  assert.equal(result.steps[0].kind, 'assert');
  assert.match(result.steps[0].error ?? '', /never_emitted/);
});

test(
  'a real scenario stops its registered Godot run by verified run identity',
  { skip: !existsSync(process.env.GODOT_PATH ?? '') },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'godot-mcp-scenario-stop-'));
    await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
    await writeFile(path.join(root, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n');
    const result = await executeScenario({
      scenario: { name: 'verified-stop', project: root, steps: [{ launch: { mode: 'headless' } }, { stop: {} }] },
      godotPath: process.env.GODOT_PATH,
      evidenceDir: path.join(root, 'evidence'),
      globalTimeoutMs: 15000,
    });
    assert.equal(result.status, 'PASS', JSON.stringify(result));
    assert.equal(result.steps[1].status, 'PASS');
    const run = runRegistry.list().find((entry) => entry.evidenceDir === path.join(root, 'evidence'));
    assert.equal(run?.state, 'STOPPED');
  },
);

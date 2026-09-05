import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadScenario, executeScenario } from '../src/scenario-executor.js';

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
    godotPath: 'E:/AI/Godot_v4.7.2-stable_win64_console.exe',
    bridgePath: path.join(root, 'bridge.gd'),
    globalTimeoutMs: 1000,
  });
  assert.equal(result.source, 'REAL');
  assert.equal(result.status, 'FAIL');
  assert.equal(result.steps[0].kind, 'assert');
  assert.match(result.steps[0].error, /never_emitted/);
});

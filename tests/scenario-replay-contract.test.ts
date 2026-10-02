import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScenario } from '../src/scenario-schema.js';
import { authorizeToolCall, createClientPolicy } from '../src/mcp/access-policy.js';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { executeScenario } from '../src/scenario-executor.js';
import { PersistentRuntimeBridge } from '../src/persistent-runtime-bridge.js';
import os from 'node:os';
import path from 'node:path';

test('replay rejects ambiguous/unbounded steps and unsafe evidence names', () => {
  for (const steps of [
    [{ stop: {}, wait: {} }],
    [{ input: { retries: Infinity } }],
    [{ physics_frames: { frames: 121 } }],
    [{ visual: { name: '../escape' } }],
    [{ visual: { maxDifferenceRatio: NaN } }],
    [{ state: { method: 'capture_screenshot', params: { path: 'C:/foreign/shot.png' } } }],
    Array.from({ length: 257 }, () => ({ stop: {} })),
  ])
    assert.throws(() => parseScenario({ steps }));
  assert.equal(parseScenario({ steps: [{ physics_frames: { frames: 120 } }, { stop: {} }] }).steps.length, 2);
});

test('legacy event cursor rejects a consumed event without a persistent runtime', async () => {
  const evidence = await mkdtemp(path.join(os.tmpdir(), 'wheel-replay-legacy-'));
  await writeFile(path.join(evidence, 'events.jsonl'), JSON.stringify({ event: 'once' }) + '\n');
  const summary = await executeScenario({
    scenario: { steps: [{ wait: { event: 'once', timeoutMs: 100 } }, { wait: { event: 'once', timeoutMs: 30 } }] },
    evidenceDir: evidence,
    globalTimeoutMs: 1000,
  });
  assert.equal(summary.steps[0].status, 'PASS');
  assert.equal(summary.steps[0].sequence, 1);
  assert.equal(summary.steps[1].code, 'TIMEOUT');
  assert.equal(summary.code, 'TIMEOUT');
  assert.equal(summary.eventCursor, 1);
  assert.equal(summary.status, 'FAIL');
});

test('MOCK cleanup failure cannot become PASS and plan is insulated from caller mutation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-replay-mock-'));
  const evidence = path.join(root, '.harness');
  await mkdir(evidence);
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  const original = PersistentRuntimeBridge.start;
  const scenario = { project: root, steps: [{ launch: { mode: 'headless' } }] };
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  PersistentRuntimeBridge.start = async () => {
    markStarted();
    await barrier;
    return {
      sessionId: 'MOCK',
      handshake: { godotVersion: 'MOCK' },
      request: async () => ({}),
      stop: async () => {
        throw new Error('MOCK stop failure');
      },
    } as unknown as PersistentRuntimeBridge;
  };
  try {
    const pending = executeScenario({ scenario, bridgePath: 'MOCK', evidenceDir: evidence });
    await started;
    scenario.steps[0].launch.mode = 'windowed';
    release();
    const summary = await pending;
    assert.equal(summary.status, 'FAIL');
    assert.equal(summary.cleanup.stopped, false);
    assert.match(summary.cleanup.error?.message ?? '', /MOCK stop failure/);
    assert.equal((summary.plan.definition.scenario.steps[0] as { launch: { mode: string } }).launch.mode, 'headless');
    const saved = JSON.parse(await readFile(path.join(evidence, 'summary.json'), 'utf8'));
    assert.equal(saved.plan.sha256, summary.plan.sha256);
  } finally {
    release();
    PersistentRuntimeBridge.start = original;
  }
});

test('MOCK post-launch binding failure retains failed cleanup and never retries or continues', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-replay-setup-mock-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  const original = PersistentRuntimeBridge.start;
  let starts = 0;
  let stops = 0;
  PersistentRuntimeBridge.start = async () => {
    starts++;
    return {
      sessionId: 'MOCK',
      handshake: { godotVersion: 'MOCK' },
      request: async () => ({}),
      stop: async () => {
        stops++;
        throw new Error('MOCK setup cleanup failure');
      },
    } as unknown as PersistentRuntimeBridge;
  };
  try {
    const summary = await executeScenario({
      scenario: { project: root, replay: { seed: 1 }, steps: [{ launch: { retries: 3 } }, { stop: {} }] },
      bridgePath: 'MOCK',
      evidenceDir: path.join(root, '.harness'),
      onFailure: 'continue',
    });
    assert.equal(summary.status, 'FAIL');
    assert.equal(summary.steps[0].code, 'UNSUPPORTED');
    assert.equal(summary.steps.length, 1);
    assert.equal(starts, 1);
    assert.equal(stops, 1);
    assert.equal(summary.cleanup.attempted, true);
    assert.equal(summary.cleanup.stopped, false);
    assert.match(summary.cleanup.error?.message ?? '', /MOCK setup cleanup failure/);
  } finally {
    PersistentRuntimeBridge.start = original;
  }
});

test('MCP replay visual baselines cannot escape approved roots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-replay-policy-'));
  const file = path.join(root, 'baseline.png');
  await writeFile(file, 'not-read-by-authorization');
  const scenarioPath = path.join(root, 'plan.yaml');
  await writeFile(scenarioPath, 'steps: []');
  const policy = createClientPolicy({
    clientId: 'replay-policy',
    scopes: ['read', 'run', 'write'],
    projectRoots: [root],
    evidenceRoots: [root],
    approvedGodotPaths: [process.execPath],
  });
  await assert.doesNotReject(
    authorizeToolCall(policy, 'execute_scenario', {
      godotPath: process.execPath,
      scenario: { project: root, steps: [{ visual: { baselinePath: file } }] },
    }),
  );
  await assert.rejects(
    authorizeToolCall(policy, 'execute_scenario', {
      godotPath: process.execPath,
      scenario: { project: root, steps: [{ visual: { baselinePath: process.execPath } }] },
    }),
    /visual baseline/,
  );
  await assert.doesNotReject(
    authorizeToolCall(policy, 'execute_scenario', {
      godotPath: process.execPath,
      scenarioPath,
      scenario: { project: '.', steps: [{ launch: { project: '.' } }] },
    }),
  );
  await assert.rejects(
    authorizeToolCall(policy, 'execute_scenario', {
      godotPath: process.execPath,
      scenarioPath,
      scenario: { project: '..', steps: [{ launch: { project: '..' } }] },
    }),
    /authorized root/,
  );
});

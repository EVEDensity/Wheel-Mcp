import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { executeScenario } from '../src/scenario-executor.js';

const execFileAsync = promisify(execFile);
const godotPath = process.env.GODOT_PATH ?? '';
const fixtureSource = path.resolve('tests/fixtures/scenario-replay');
async function retainSummary(name: string, summary: unknown) {
  const target = process.env.WHEEL_REPLAY_REPORT_DIR;
  if (!target) return;
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, `${name}.json`), JSON.stringify(summary, null, 2));
}

/** Copy the frozen fixture into an owned temp project and import it once. */
async function prepareFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-replay-'));
  const project = path.join(root, 'project');
  await cp(fixtureSource, project, { recursive: true });
  await execFileAsync(godotPath, ['--headless', '--path', project, '--editor', '--import'], {
    timeout: 120000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { root, project };
}

/** The client-submitted bounded sequence: barriers only, no wall-clock sleeps. */
function replaySteps(project: string, mode: 'headless' | 'windowed' = 'headless') {
  return [
    { launch: { mode, project } },
    { wait: { event: 'level_started', timeoutMs: 15000 } },
    { physics_frames: { frames: 6 } },
    {
      state: {
        method: 'get_property',
        params: { nodePath: '.', property: 'frame_counter' },
        path: 'value',
        op: 'greater',
        expected: 5,
      },
    },
    {
      state: {
        method: 'call_method',
        params: { nodePath: '.', method: 'advance_state' },
        path: 'value',
        op: 'equals',
        expected: 'RUNNING',
      },
    },
    { wait: { event: 'method_called', timeoutMs: 10000 } },
    {
      state: {
        method: 'get_property',
        params: { nodePath: '.', property: 'seed_value' },
        path: 'value',
        op: 'equals',
        expected: 260925,
      },
    },
    { input: { keycode: 88, release: true } },
    { physics_frames: { frames: 2 } },
    {
      state: {
        method: 'get_property',
        params: { nodePath: '.', property: 'press_count' },
        path: 'value',
        op: 'equals',
        expected: 1,
      },
    },
    {
      state: {
        method: 'get_property',
        params: { nodePath: '.', property: 'release_count' },
        path: 'value',
        op: 'equals',
        expected: 1,
      },
    },
    {
      collision: {
        params: { nodePath: 'Area' },
        path: 'lastCollision.name',
        op: 'equals',
        expected: 'Target',
      },
    },
    { switch_scene: { scenePath: 'res://second.tscn' } },
    { wait: { event: 'scene_reloaded', timeoutMs: 15000 } },
    {
      state: {
        method: 'get_property',
        params: { nodePath: '.', property: 'marker' },
        path: 'value',
        op: 'equals',
        expected: 'second-scene',
      },
    },
    { diagnostics: { maxErrors: 0 } },
    { stop: {} },
  ];
}

async function ownedCleanup(root: string) {
  const actual = await realpath(root);
  const parent = await realpath(os.tmpdir());
  if (path.dirname(actual) !== parent || !path.basename(actual).startsWith('wheel-replay-'))
    throw new Error('Refusing unowned replay fixture cleanup');
  await rm(actual, { recursive: true, force: true });
}

test(
  'fixed fixture satisfies the key assertions for 30 consecutive replays',
  { skip: !existsSync(godotPath), timeout: 900000 },
  async () => {
    const { root, project } = await prepareFixture();
    try {
      for (let replay = 0; replay < 30; replay++) {
        const evidenceDir = path.join(root, 'evidence', `replay-${replay}`);
        const summary = await executeScenario({
          scenario: {
            name: 'consecutive-replay',
            project,
            replay: {
              seed: 260925,
              // Freeze the observed headless profile, not the configured window dimensions.
              expected: {
                renderer: 'gl_compatibility',
                displayServer: 'headless',
                physicsTicksPerSecond: 60,
                viewport: { width: 64, height: 64 },
              },
            },
            steps: replaySteps(project),
          },
          godotPath,
          bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
          evidenceDir,
          globalTimeoutMs: 60000,
        });
        await retainSummary(`replay-${replay}`, summary);
        assert.match(summary.plan.sha256, /^[a-f0-9]{64}$/);
        assert.equal(summary.runtimeObservations.length, 1);
        assert.equal(
          summary.status,
          'PASS',
          JSON.stringify({ replay, steps: summary.steps, input: summary.inputSnapshot, cleanup: summary.cleanup }),
        );
        assert.equal(summary.inputSnapshot?.unchanged, true, `replay ${replay}: project inputs changed`);
        assert.ok((summary.eventCursor ?? 0) > 0, `replay ${replay}: event cursor never advanced`);
      }
    } finally {
      await ownedCleanup(root);
    }
  },
);

test(
  'declared window dimensions cannot qualify a different headless viewport',
  { skip: !existsSync(godotPath), timeout: 180000 },
  async () => {
    const { root, project } = await prepareFixture();
    try {
      const summary = await executeScenario({
        scenario: {
          name: 'viewport-condition-mismatch',
          project,
          replay: { seed: 260925, expected: { viewport: { width: 320, height: 240 } } },
          steps: [{ launch: { mode: 'headless', project } }],
        },
        godotPath,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        evidenceDir: path.join(root, 'evidence', 'viewport-mismatch'),
        globalTimeoutMs: 60000,
      });
      await retainSummary('viewport-mismatch', summary);
      assert.equal(summary.status, 'FAIL');
      assert.equal(summary.code, 'CONFLICT');
      assert.deepEqual(summary.steps[0]?.actual, {
        expected: { width: 320, height: 240 },
        actual: { width: 64, height: 64 },
      });
      assert.equal(summary.cleanup.stopped, true);
      assert.equal(summary.cleanup.attempted, true);
    } finally {
      await ownedCleanup(root);
    }
  },
);

test(
  'a satisfied event cannot satisfy the next step of the same sequence',
  { skip: !existsSync(godotPath), timeout: 120000 },
  async () => {
    const { root, project } = await prepareFixture();
    try {
      const evidenceDir = path.join(root, 'evidence', 'stale-event');
      const summary = await executeScenario({
        scenario: {
          name: 'stale-event-replay',
          project,
          steps: [
            { launch: { mode: 'headless', project } },
            { wait: { event: 'level_started', timeoutMs: 15000 } },
            {
              state: { method: 'call_method', params: { nodePath: '.', method: 'advance_state' } },
            },
            { wait: { event: 'method_called', timeoutMs: 10000 } },
            { wait: { event: 'method_called', timeoutMs: 1500 } },
          ],
        },
        godotPath,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        evidenceDir,
        globalTimeoutMs: 60000,
      });
      assert.equal(summary.status, 'FAIL');
      await retainSummary('stale-event', summary);
      const firstWait = summary.steps.find((step) => step.index === 3);
      const secondWait = summary.steps.find((step) => step.index === 4);
      assert.equal(firstWait?.status, 'PASS');
      assert.ok((firstWait?.sequence ?? 0) > 0);
      assert.notEqual(secondWait?.status, 'PASS');
      assert.equal(secondWait?.code, 'TIMEOUT');
      assert.ok(
        (summary.eventCursor ?? 0) >= (firstWait?.sequence ?? 0),
        'the cursor must not regress for a stale event',
      );
    } finally {
      await ownedCleanup(root);
    }
  },
);

test(
  'a wait step fails with a bounded TIMEOUT instead of hanging',
  { skip: !existsSync(godotPath), timeout: 120000 },
  async () => {
    const { root, project } = await prepareFixture();
    try {
      const summary = await executeScenario({
        scenario: {
          name: 'timeout-replay',
          project,
          steps: [{ launch: { mode: 'headless', project } }, { wait: { event: 'never_emitted', timeoutMs: 500 } }],
        },
        godotPath,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        evidenceDir: path.join(root, 'evidence', 'timeout'),
        globalTimeoutMs: 30000,
      });
      assert.equal(summary.status, 'FAIL');
      await retainSummary('timeout', summary);
      assert.equal(summary.steps[1]?.code, 'TIMEOUT');
      assert.equal(summary.steps[1]?.timed_out, true);
      assert.equal(summary.cleanup.attempted, true);
      assert.equal(summary.cleanup.stopped, true);
    } finally {
      await ownedCleanup(root);
    }
  },
);

test(
  'cancelling a replay records CANCELLED and still stops the runtime',
  { skip: !existsSync(godotPath), timeout: 120000 },
  async () => {
    const { root, project } = await prepareFixture();
    const controller = new AbortController();
    try {
      const pending = executeScenario({
        scenario: {
          name: 'cancel-replay',
          project,
          steps: [
            { launch: { mode: 'headless', project } },
            { wait: { event: 'level_started', timeoutMs: 15000 } },
            { wait: { event: 'never_emitted', timeoutMs: 30000 } },
          ],
        },
        godotPath,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        evidenceDir: path.join(root, 'evidence', 'cancel'),
        globalTimeoutMs: 45000,
        signal: controller.signal,
      });
      const barrierDeadline = Date.now() + 30000;
      let barrierReached = false;
      while (Date.now() < barrierDeadline) {
        const progress = await readFile(path.join(root, 'evidence', 'cancel', 'progress.json'), 'utf8').catch(
          () => '{}',
        );
        try {
          if (JSON.parse(progress).index >= 1) {
            barrierReached = true;
            break;
          }
        } catch {
          /* writer may still be replacing the small progress record */
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      controller.abort();
      const summary = await pending;
      await retainSummary('cancel', summary);
      assert.equal(barrierReached, true, 'cancel must occur after the launch/event barrier, not during setup');
      assert.equal(summary.status, 'FAIL');
      assert.equal(summary.cancelled, true);
      assert.equal(summary.code, 'CANCELLED');
      assert.equal(summary.cleanup.attempted, true);
      assert.equal(summary.cleanup.stopped, true);
    } finally {
      controller.abort();
      await ownedCleanup(root);
    }
  },
);

test(
  'a windowed replay covers rendered visual assertions with a frozen difference budget',
  { skip: !existsSync(godotPath), timeout: 180000 },
  async () => {
    const { root, project } = await prepareFixture();
    try {
      const evidenceDir = path.join(root, 'evidence', 'windowed');
      const steps = replaySteps(project, 'windowed') as Array<Record<string, unknown>>;
      steps.splice(
        steps.length - 1,
        0,
        {
          screenshot: { name: 'baseline' },
        },
        {
          visual: {
            name: 'second-scene',
            baselinePath: path.join(evidenceDir, 'step-baseline', 'screenshot.png'),
            maxDifferenceRatio: 0,
            threshold: 8,
          },
        },
      );
      const summary = await executeScenario({
        scenario: { name: 'windowed-replay', project, steps },
        godotPath,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        evidenceDir,
        globalTimeoutMs: 90000,
      });
      assert.equal(summary.status, 'PASS', JSON.stringify(summary.steps));
      await retainSummary('windowed', summary);
      const visual = summary.steps.find((step) => step.kind === 'visual');
      assert.equal(visual?.status, 'PASS');
      const dimensions = visual?.actual as { width: number; height: number };
      assert.ok(dimensions.width > 1 && dimensions.height > 1);
      const screenshot = await readFile(path.join(evidenceDir, 'step-second-scene', 'screenshot.png'));
      assert.equal(screenshot.readUInt32BE(16), dimensions.width);
      assert.equal(screenshot.readUInt32BE(20), dimensions.height);
      const rejected = await executeScenario({
        scenario: {
          name: 'missing-baseline',
          project,
          steps: [{ launch: { mode: 'windowed', project } }, { visual: { name: 'missing' } }],
        },
        godotPath,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        evidenceDir: path.join(root, 'evidence', 'negative'),
        globalTimeoutMs: 30000,
      });
      assert.equal(rejected.status, 'FAIL');
      await retainSummary('missing-baseline', rejected);
      assert.equal(rejected.steps[1]?.code, 'INVALID_ARGUMENT');
      assert.equal(rejected.cleanup.stopped, true);
    } finally {
      await ownedCleanup(root);
    }
  },
);

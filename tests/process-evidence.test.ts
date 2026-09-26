import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cancelProcess, launchProject, stopProcess, queryRuntimeSceneTree } from '../src/godot-runtime.js';
import { ensureEvidenceManifest } from '../src/evidence.js';
import { createTimeoutContext } from '../src/timeout.js';

const executable = process.env.GODOT_PATH ?? '';
const realEngine = { skip: !existsSync(executable), timeout: 30000 };

async function fixture(code: number | null = null) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-process-evidence-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="Isolated process evidence"\n');
  await writeFile(
    path.join(root, 'probe.gd'),
    code === null
      ? 'extends SceneTree\nvar elapsed = 0.0\nfunc _initialize():\n\tprint("EVIDENCE_READY")\nfunc _process(delta):\n\telapsed += delta\n\tif elapsed > 10: quit(91)\n\treturn false\n'
      : `extends SceneTree\nfunc _initialize():\n\tprint("EVIDENCE_EXIT_${code}")\n\tquit(${code})\n`,
  );
  return { root, executable, evidenceDir: path.join(root, 'evidence') };
}

async function launchFixture(code: number | null = null) {
  const f = await fixture(code);
  return {
    ...f,
    launch: await launchProject({
      godotPath: executable,
      projectPath: f.root,
      evidenceDir: f.evidenceDir,
      headless: true,
      extraArgs: ['--script', 'res://probe.gd'],
    }),
  };
}

async function readJson(file: string) {
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
}

test('process evidence manifest lists only files a script run produces', realEngine, async () => {
  const { launch, evidenceDir } = await launchFixture(0);
  await launch.close;
  const manifest = await readJson(path.join(evidenceDir, 'manifest.json'));
  assert.equal(manifest.profile, 'PROCESS_EVIDENCE');
  assert.equal(manifest.lifecycle, 'EXITED');
  assert.equal('request_file' in manifest, false);
  assert.equal('response_file' in manifest, false);
  assert.equal('events_file' in manifest, false);
  const metadata = await readJson(path.join(evidenceDir, 'process.json'));
  assert.equal(metadata.exit_code, 0);
  assert.equal(metadata.signal, null);
});

test('bridge evidence manifest still lists request, response and events files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-bridge-evidence-'));
  const manifest = await ensureEvidenceManifest(root, 'BRIDGE_EVIDENCE');
  assert.equal(manifest.request_file, path.join(root, 'request.json'));
  assert.equal(manifest.response_file, path.join(root, 'response.json'));
  assert.equal(manifest.events_file, path.join(root, 'events.jsonl'));
});

test('a process killed outside wheel records the signal', realEngine, async () => {
  const { launch, evidenceDir } = await launchFixture();
  launch.child.kill('SIGKILL');
  await launch.close;
  const metadata = await readJson(path.join(evidenceDir, 'process.json'));
  assert.equal(metadata.lifecycle, 'FAILED');
  assert.equal(metadata.exit_code, null);
  assert.equal(metadata.signal, 'SIGKILL');
});

test('stop_project keeps STOPPED instead of being overwritten by FAILED', realEngine, async () => {
  const { launch, evidenceDir } = await launchFixture();
  const result = await stopProcess(launch.child.pid!);
  assert.equal(result.stopped, true);
  await launch.close;
  const metadata = await readJson(path.join(evidenceDir, 'process.json'));
  assert.equal(metadata.lifecycle, 'STOPPED');
  assert.equal(metadata.cancelled, false);
  assert.ok(metadata.signal === null || typeof metadata.signal === 'string');
  const manifest = await readJson(path.join(evidenceDir, 'manifest.json'));
  assert.equal(manifest.lifecycle, 'STOPPED');
});

test('cancel_project records CANCELLED', realEngine, async () => {
  const { launch, evidenceDir } = await launchFixture();
  await cancelProcess(launch.child.pid!);
  await launch.close;
  const metadata = await readJson(path.join(evidenceDir, 'process.json'));
  assert.equal(metadata.lifecycle, 'CANCELLED');
  assert.equal(metadata.cancelled, true);
});

test(
  'bridge nonzero exit preserves code and records absent artifacts without fabricating a response',
  realEngine,
  async () => {
    const f = await fixture(7);
    await assert.rejects(
      queryRuntimeSceneTree({
        godotPath: executable,
        projectPath: f.root,
        evidenceDir: f.evidenceDir,
        bridgePath: path.join(f.root, 'probe.gd'),
      }),
      /process failed/,
    );
    const metadata = await readJson(path.join(f.evidenceDir, 'process.json'));
    assert.equal(metadata.exit_code, 7);
    assert.equal(metadata.lifecycle, 'FAILED');
    const manifest = await readJson(path.join(f.evidenceDir, 'manifest.json'));
    const artifacts = manifest.artifacts as Record<string, { status: string; sha256?: string }>;
    assert.equal(artifacts['response.json'].status, 'NOT_GENERATED');
    assert.equal(artifacts['events.jsonl'].status, 'NOT_GENERATED');
    assert.match(artifacts['stderr.log'].sha256!, /^[a-f0-9]{64}$/);
    await assert.rejects(access(path.join(f.evidenceDir, 'response.json')));
    assert.match(await readFile(path.join(f.evidenceDir, 'stdout.log'), 'utf8'), /EVIDENCE_EXIT_7/);
  },
);

test('bridge timeout retains TIMEOUT rather than becoming a generic failed process', realEngine, async () => {
  const f = await fixture();
  const timeout = createTimeoutContext(750);
  try {
    await assert.rejects(
      queryRuntimeSceneTree({
        godotPath: executable,
        projectPath: f.root,
        evidenceDir: f.evidenceDir,
        bridgePath: path.join(f.root, 'probe.gd'),
        timeout,
      }),
      /timed out/,
    );
  } finally {
    timeout.dispose();
  }
  const metadata = await readJson(path.join(f.evidenceDir, 'process.json'));
  assert.equal(metadata.lifecycle, 'TIMEOUT');
  assert.equal(metadata.timed_out, true);
});

test('launch writes readable stdout while the real Godot process is still running', realEngine, async () => {
  const { launch, evidenceDir } = await launchFixture();
  try {
    const until = Date.now() + 5000;
    let stdout = '';
    while (!stdout.includes('EVIDENCE_READY') && Date.now() < until) {
      stdout = await readFile(path.join(evidenceDir, 'stdout.log'), 'utf8');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.match(stdout, /EVIDENCE_READY/);
    assert.equal(launch.child.exitCode, null);
    assert.equal(launch.child.signalCode, null);
  } finally {
    await stopProcess(launch.child.pid!);
    await launch.close;
  }
});

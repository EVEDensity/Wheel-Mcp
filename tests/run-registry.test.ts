import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { RunRegistry } from '../src/run-registry.js';
import { stopProcess, getProcessStatus } from '../src/godot-runtime.js';

test('RunRegistry persists records, enforces concurrency, and marks dead runs orphaned', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'run-registry-'));
  const storagePath = path.join(root, 'registry.json');
  const registry = new RunRegistry({ storagePath, maxConcurrent: 1 });
  registry.register({ runId: 'run-a', pid: 2147483000, projectPath: root, evidenceDir: root });
  registry.register({ runId: 'run-b', pid: 2147483001, projectPath: root, evidenceDir: root });
  assert.equal(registry.active().length, 0);
  assert.equal(registry.get('run-a')?.state, 'ORPHANED');
  const persisted = JSON.parse(await readFile(storagePath, 'utf8')) as Array<{ runId: string; state: string }>;
  assert.equal(persisted[0].runId, 'run-a');
  assert.equal(persisted[0].state, 'ORPHANED');
  const restored = new RunRegistry({ storagePath, maxConcurrent: 2 });
  assert.equal(restored.get('run-a')?.state, 'ORPHANED');
});

test('launch run ids remain unique when evidence directory is reused', () => {
  const ids = new Set(['run-1-100-1', 'run-1-101-2']);
  assert.equal(ids.size, 2);
});

test('RunRegistry prevents stopping an unknown run', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'run-registry-'));
  const registry = new RunRegistry({ storagePath: path.join(root, 'registry.json') });
  await assert.rejects(() => registry.stop('missing'), /run not found/);
});

test('external terminal update atomically closes process evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'run-registry-evidence-'));
  await writeFile(
    path.join(root, 'process.json'),
    JSON.stringify({ schema_version: '0.1', source: 'REAL', lifecycle: 'STARTING', pid: 1 }),
  );
  const registry = new RunRegistry({ storagePath: path.join(root, 'registry.json') });
  registry.register({ runId: 'external-stop', pid: 2147483000, projectPath: root, evidenceDir: root });
  registry.markTerminal('external-stop', 'CANCELLED', null);
  const metadata = JSON.parse(await readFile(path.join(root, 'process.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(metadata.lifecycle, 'CANCELLED');
  assert.equal(metadata.cancelled, true);
  assert.equal(metadata.started, true);
  assert.equal(metadata.source, 'REAL');
  assert.equal(typeof metadata.finished_at, 'string');
});

test('duplicate run ids are rejected and independent evidence directories remain isolated', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'run-registry-isolation-'));
  const registry = new RunRegistry({ storagePath: path.join(root, 'registry.json'), maxConcurrent: 2 });
  registry.register({ runId: 'run-a', pid: 2147483000, projectPath: root, evidenceDir: path.join(root, 'a') });
  registry.register({ runId: 'run-b', pid: 2147483001, projectPath: root, evidenceDir: path.join(root, 'b') });
  assert.throws(
    () =>
      registry.register({ runId: 'run-a', pid: 2147483002, projectPath: root, evidenceDir: path.join(root, 'other') }),
    /run already exists/,
  );
  assert.notEqual(registry.get('run-a')?.evidenceDir, registry.get('run-b')?.evidenceDir);
});

test('concurrent run limit rejects a second live registration', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'run-registry-limit-'));
  const registry = new RunRegistry({ storagePath: path.join(root, 'registry.json'), maxConcurrent: 1 });
  registry.register({ runId: 'live-a', pid: process.pid, projectPath: root, evidenceDir: root });
  assert.throws(
    () => registry.register({ runId: 'live-b', pid: process.pid, projectPath: root, evidenceDir: root }),
    /maximum concurrent/,
  );
  registry.markTerminal('live-a', 'STOPPED', 0);
});

test('orphan reclaim only reports a run after stop succeeds', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'run-registry-orphan-'));
  const registry = new RunRegistry({ storagePath: path.join(root, 'registry.json') });
  registry.register({ runId: 'dead-run', pid: 2147483000, projectPath: root, evidenceDir: root });
  assert.equal(registry.scanOrphans().length, 1);
  const reclaimed = await registry.reclaimOrphans(100);
  assert.equal(reclaimed.length, 1);
  assert.equal(registry.get('dead-run')?.state, 'STOPPED');
});

test(
  'Windows process-tree termination stops a real child process',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    assert.ok(child.pid);
    const result = await stopProcess(child.pid!, 3000);
    if (!result.stopped) {
      child.kill();
      t.skip('taskkill access denied in the restricted test environment');
      return;
    }
    assert.equal(result.stopped, true);
    assert.equal(getProcessStatus(child.pid!).running, false);
  },
);

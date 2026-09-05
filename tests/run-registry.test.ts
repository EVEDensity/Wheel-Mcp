import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RunRegistry } from '../src/run-registry.js';

test('RunRegistry persists records, enforces concurrency, and marks dead runs orphaned', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'run-registry-'));
  const storagePath = path.join(root, 'registry.json');
  const registry = new RunRegistry({ storagePath, maxConcurrent: 1 });
  registry.register({ runId: 'run-a', pid: 2147483000, projectPath: root, evidenceDir: root });
  assert.throws(
    () => registry.register({ runId: 'run-b', pid: 2147483001, projectPath: root, evidenceDir: root }),
    /maximum concurrent/,
  );
  assert.equal(registry.active().length, 0);
  assert.equal(registry.get('run-a')?.state, 'ORPHANED');
  const persisted = JSON.parse(await readFile(storagePath, 'utf8')) as Array<{ runId: string; state: string }>;
  assert.equal(persisted[0].runId, 'run-a');
  assert.equal(persisted[0].state, 'ORPHANED');
  const restored = new RunRegistry({ storagePath, maxConcurrent: 2 });
  assert.equal(restored.get('run-a')?.state, 'ORPHANED');
});

test('RunRegistry prevents stopping an unknown run', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'run-registry-'));
  const registry = new RunRegistry({ storagePath: path.join(root, 'registry.json') });
  await assert.rejects(() => registry.stop('missing'), /run not found/);
});

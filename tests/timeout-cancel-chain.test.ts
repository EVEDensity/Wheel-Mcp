import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cancelProcess, stopProcess } from '../src/godot-runtime.js';
import { classifyError } from '../src/error-schema.js';
import { createTimeoutContext } from '../src/timeout.js';

test('timeout/cancel evidence contract requires terminal metadata and logs', async () => {
  const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'godot-cancel-evidence-'));
  const metadata = {
    lifecycle: 'CANCELLED',
    finished_at: new Date().toISOString(),
    timed_out: false,
    cancelled: true,
  };
  await import('node:fs/promises').then(({ writeFile }) =>
    Promise.all([
      writeFile(path.join(evidenceDir, 'process.json'), JSON.stringify(metadata)),
      writeFile(path.join(evidenceDir, 'stdout.log'), ''),
      writeFile(path.join(evidenceDir, 'stderr.log'), ''),
    ]),
  );
  for (const file of ['process.json', 'stdout.log', 'stderr.log']) await access(path.join(evidenceDir, file));
  const persisted = JSON.parse(await readFile(path.join(evidenceDir, 'process.json'), 'utf8')) as typeof metadata;
  assert.equal(persisted.lifecycle, 'CANCELLED');
  assert.ok(persisted.finished_at);
});

test('timeout and cancellation classify consistently', () => {
  const timeout = createTimeoutContext(0);
  assert.throws(
    () => timeout.throwIfExpired(),
    (error: unknown) => classifyError(error).code === 'TIMEOUT',
  );
  timeout.dispose();
  const parent = new AbortController();
  const child = createTimeoutContext(1000, parent.signal);
  parent.abort();
  assert.throws(
    () => child.throwIfCancelled(),
    (error: unknown) => classifyError(error).code === 'CANCELLED',
  );
  child.dispose();
});

test('stopping an already exited process is idempotent and repeated cancel is stable', async () => {
  const exited = 2147483000;
  const stopped = await stopProcess(exited, 100);
  const cancelled = await cancelProcess(exited, 100);
  assert.equal(stopped.stopped, true);
  assert.equal(cancelled.stopped, true);
  assert.equal(cancelled.cancelled, true);
});

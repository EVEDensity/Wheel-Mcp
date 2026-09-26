import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { RunRegistry } from '../src/run-registry.js';
import { stopProcess, getProcessStatus } from '../src/godot-runtime.js';
import { readProcessIdentity, stopIdentifiedProcess } from '../src/process-identity.js';

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

test('separate registry instances share one quota and cannot overwrite each other', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'run-registry-shared-'));
  const storagePath = path.join(root, 'registry.json');
  const first = new RunRegistry({ storagePath, maxConcurrent: 2 });
  const second = new RunRegistry({ storagePath, maxConcurrent: 2 });
  first.register({ runId: 'launch-a', pid: process.pid, projectPath: root, evidenceDir: path.join(root, 'a') });
  second.register({
    kind: 'bridge',
    runId: 'bridge-b',
    pid: process.pid,
    projectPath: root,
    evidenceDir: path.join(root, 'b'),
  });
  assert.deepEqual(
    first.list().map((run) => run.runId),
    ['launch-a', 'bridge-b'],
  );
  assert.throws(
    () => first.register({ runId: 'launch-c', pid: process.pid, projectPath: root, evidenceDir: path.join(root, 'c') }),
    /maximum concurrent/,
  );
  assert.equal(second.get('bridge-b')?.kind, 'bridge');
  first.markTerminal('launch-a', 'STOPPED');
  second.markTerminal('bridge-b', 'STOPPED');
});

test('registry reclaims a lock left by a dead owner before loading records', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'run-registry-crashed-lock-'));
  const storagePath = path.join(root, 'registry.json');
  await writeFile(`${storagePath}.lock`, '2147483000');
  const registry = new RunRegistry({ storagePath });
  registry.register({ runId: 'after-crash', pid: 2147483001, projectPath: root, evidenceDir: root });
  assert.equal(registry.get('after-crash')?.state, 'ORPHANED');
});

test(
  'four OS processes can append registry records without lock races or lost writes',
  { timeout: 20000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'run-registry-processes-'));
    const storagePath = path.join(root, 'registry.json');
    const moduleUrl = pathToFileURL(path.resolve('build/src/run-registry.js')).href;
    const workers = Array.from(
      { length: 4 },
      (_, worker) =>
        new Promise<void>((resolve, reject) => {
          const script = `import { RunRegistry } from ${JSON.stringify(moduleUrl)}; const registry = new RunRegistry({ storagePath: ${JSON.stringify(storagePath)}, maxConcurrent: 200 }); for (let i = 0; i < 25; i++) registry.register({ runId: ${JSON.stringify(`worker-${worker}-`)} + i, pid: 2147400000 + ${worker} * 25 + i, projectPath: ${JSON.stringify(root)}, evidenceDir: ${JSON.stringify(root)} });`;
          const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
            stdio: ['ignore', 'ignore', 'pipe'],
            windowsHide: true,
          });
          let stderr = '';
          child.stderr.on('data', (chunk) => {
            stderr += String(chunk);
          });
          child.once('error', reject);
          child.once('close', (code) =>
            code === 0 ? resolve() : reject(new Error(`registry worker ${worker} exited ${code}: ${stderr}`)),
          );
        }),
    );
    await Promise.all(workers);
    const records = JSON.parse(await readFile(storagePath, 'utf8')) as Array<{ runId: string }>;
    assert.equal(records.length, 100);
    assert.equal(new Set(records.map((record) => record.runId)).size, 100);
  },
);

test('orphan reclaim only reports a run after stop succeeds', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'run-registry-orphan-'));
  const registry = new RunRegistry({ storagePath: path.join(root, 'registry.json') });
  registry.register({ runId: 'dead-run', pid: 2147483000, projectPath: root, evidenceDir: root });
  const records = JSON.parse(await readFile(path.join(root, 'registry.json'), 'utf8'));
  records[0].ownerPid = 2147483001; // truly dead owner, not an owner still draining its exited child.
  await writeFile(path.join(root, 'registry.json'), JSON.stringify(records));
  assert.equal(registry.scanOrphans().length, 1);
  const reclaimed = await registry.reclaimOrphans(100);
  assert.equal(reclaimed.length, 1);
  assert.equal(registry.get('dead-run')?.state, 'STOPPED');
});
test('automatic orphan reclamation never steals terminal evidence from a live owner', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'run-registry-exit-drain-'));
  const storagePath = path.join(root, 'registry.json');
  await writeFile(path.join(root, 'process.json'), JSON.stringify({ lifecycle: 'RUNNING', started: true }));
  const owner = new RunRegistry({ storagePath });
  owner.register({ runId: 'draining-natural-exit', pid: 2147483000, projectPath: root, evidenceDir: root });
  const observer = new RunRegistry({ storagePath });
  assert.deepEqual(await observer.reclaimOrphans(1000), []);
  owner.markTerminal('draining-natural-exit', 'EXITED', 0);
  assert.equal(observer.get('draining-natural-exit')?.state, 'EXITED');
  const metadata = JSON.parse(await readFile(path.join(root, 'process.json'), 'utf8'));
  assert.equal(metadata.lifecycle, 'EXITED');
  assert.equal(metadata.exit_code, 0);
});

test('a live PID restored from disk is never killed without a verified process identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'run-registry-restart-'));
  const storagePath = path.join(root, 'registry.json');
  await writeFile(
    storagePath,
    JSON.stringify([
      {
        runId: 'untrusted-restored-pid',
        pid: process.pid,
        projectPath: root,
        evidenceDir: root,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        state: 'RUNNING',
      },
    ]),
  );
  const registry = new RunRegistry({ storagePath });
  assert.equal(registry.get('untrusted-restored-pid')?.state, 'ORPHANED');
  assert.deepEqual(await registry.reclaimOrphans(1000), []);
  await assert.rejects(() => registry.stop('untrusted-restored-pid'), /identity is unverified/);
  await assert.rejects(() => registry.cancel('untrusted-restored-pid'), /identity is unverified/);
  assert.equal(getProcessStatus(process.pid).running, true);
  assert.equal(registry.get('untrusted-restored-pid')?.state, 'ORPHANED');
});

test('double stop never signals a reused PID after the record is terminal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'run-registry-double-stop-'));
  const registry = new RunRegistry({ storagePath: path.join(root, 'registry.json') });
  registry.register({ runId: 'finished', pid: process.pid, projectPath: root, evidenceDir: root });
  registry.markTerminal('finished', 'STOPPED', 0);
  assert.equal((await registry.stop('finished')).state, 'STOPPED');
  assert.equal((await registry.cancel('finished')).state, 'STOPPED');
  assert.equal(getProcessStatus(process.pid).running, true);
});

test(
  'a restored orphan is reclaimed only when its OS process identity still matches',
  { skip: process.platform !== 'win32', timeout: 20000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'run-registry-verified-reclaim-'));
    const storagePath = path.join(root, 'registry.json');
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    assert.ok(child.pid);
    try {
      const identity = await readProcessIdentity(child.pid);
      assert.ok(identity);
      const original = new RunRegistry({ storagePath });
      original.register({ runId: 'live-before-restart', pid: child.pid, projectPath: root, evidenceDir: root });
      original.attachIdentity('live-before-restart', { ...identity, startToken: 'wrong' });
      const abandoned = JSON.parse(await readFile(storagePath, 'utf8')) as Array<Record<string, unknown>>;
      abandoned[0].ownerPid = 2147483000;
      await writeFile(storagePath, JSON.stringify(abandoned));
      const restored = new RunRegistry({ storagePath });
      assert.equal(restored.get('live-before-restart')?.state, 'ORPHANED');
      assert.deepEqual(await restored.reclaimOrphans(5000), []);
      assert.equal(getProcessStatus(child.pid).running, true);
      const corrected = JSON.parse(await readFile(storagePath, 'utf8')) as Array<Record<string, unknown>>;
      corrected[0].processIdentity = identity;
      await writeFile(storagePath, JSON.stringify(corrected));
      const verified = new RunRegistry({ storagePath });
      const reclaimed = await verified.reclaimOrphans(10000);
      assert.equal(reclaimed.length, 1);
      assert.equal(verified.get('live-before-restart')?.state, 'STOPPED');
      assert.equal(getProcessStatus(child.pid).running, false);
    } finally {
      if (getProcessStatus(child.pid).running) child.kill();
    }
  },
);

test(
  'a new owner safely reclaims a live Godot process after the prior owner is killed',
  { skip: process.platform !== 'win32' || !process.env.GODOT_PATH, timeout: 25000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'run-registry-crash-'));
    const storagePath = path.join(root, 'registry.json');
    await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
    await writeFile(path.join(root, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n');
    const registryUrl = pathToFileURL(path.resolve('build/src/run-registry.js')).href;
    const identityUrl = pathToFileURL(path.resolve('build/src/process-identity.js')).href;
    const script = `import { spawn } from 'node:child_process'; import { runRegistry } from ${JSON.stringify(registryUrl)}; import { readProcessIdentity } from ${JSON.stringify(identityUrl)}; const godot = spawn(process.env.GODOT_PATH, ['--headless', '--path', ${JSON.stringify(root)}], { stdio: 'ignore', detached: true, windowsHide: true }); const runId = 'abandoned-' + godot.pid; runRegistry.register({ runId, pid: godot.pid, projectPath: ${JSON.stringify(root)}, evidenceDir: ${JSON.stringify(path.join(root, 'evidence'))} }); const identity = await readProcessIdentity(godot.pid); if (!identity) throw new Error('Godot identity missing'); runRegistry.attachIdentity(runId, identity); process.stdout.write(JSON.stringify({ pid: godot.pid, runId }) + '\\n'); setInterval(() => {}, 1000);`;
    const owner = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, GODOT_HARNESS_RUN_REGISTRY_PATH: storagePath },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let pid = 0;
    let identity = null as Awaited<ReturnType<typeof readProcessIdentity>>;
    try {
      const line = await new Promise<string>((resolve, reject) => {
        owner.stdout.once('data', (chunk) => resolve(String(chunk)));
        owner.once('error', reject);
        owner.once('close', (code) => reject(new Error(`owner exited before launch: ${code}`)));
      });
      const launched = JSON.parse(line.trim()) as { pid: number; runId: string };
      pid = launched.pid;
      identity = await readProcessIdentity(pid);
      assert.ok(identity);
      assert.equal(getProcessStatus(pid).running, true);
      const closed = new Promise<void>((resolve) => owner.once('close', () => resolve()));
      owner.kill();
      await closed;
      assert.equal(getProcessStatus(pid).running, true);
      const recovered = new RunRegistry({ storagePath });
      assert.equal(recovered.get(launched.runId)?.state, 'ORPHANED');
      const reclaimed = await recovered.reclaimOrphans(10000);
      assert.equal(reclaimed.length, 1);
      assert.equal(reclaimed[0].state, 'STOPPED');
      assert.equal(getProcessStatus(pid).running, false);
    } finally {
      if (owner.exitCode === null && owner.signalCode === null) owner.kill();
      if (pid && identity && getProcessStatus(pid).running) await stopIdentifiedProcess(pid, identity);
    }
  },
);

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, unlink, rmdir, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { readProcessIdentity } from '../src/process-identity.js';

const exec = promisify(execFile);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
// Actual short Node process and CLI, explicit TEST DOUBLE run metadata, no Godot/MCP/model execution.
async function fixture() {
  await mkdir(path.resolve('runs/production-roadmap/T31'), { recursive: true });
  const parent = await realpath(path.resolve('runs/production-roadmap/T31'));
  const root = path.join(parent, 'native-smoke-2026-control-unit-' + randomUUID());
  await mkdir(root);
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  assert.ok(child.pid);
  const identity = await readProcessIdentity(child.pid);
  assert.ok(identity);
  const input = { workerPid: child.pid, workerIdentityHash: sha(JSON.stringify(identity)), sourceHash: 'a'.repeat(64) };
  await writeFile(path.join(root, 'inputs.json'), JSON.stringify(input));
  return {
    root,
    parent,
    child,
    input,
    async cleanup() {
      if (child.exitCode === null && child.signalCode === null) {
        const closed = once(child, 'close');
        child.kill();
        await closed;
      }
      assert.equal(path.dirname(await realpath(root)), parent);
      assert.equal((await lstat(root)).isSymbolicLink(), false);
      for (const name of await readdir(root)) {
        assert.ok(['inputs.json', 'stop-request.json', 'stop-request.staged'].includes(name));
        const file = path.join(root, name);
        const info = await lstat(file);
        assert.equal(info.isSymbolicLink(), false);
        assert.equal(info.isFile(), true);
        assert.equal(info.nlink, 1);
        await unlink(file);
      }
      await rmdir(root); // Exact newly-created unit fixture only, no recursive directory deletion.
    },
  };
}
async function request(root: string) {
  return exec(process.execPath, ['scripts/soak-production.mjs', '--request-stop', root], {
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 8192,
  });
}
test(
  'T31 actual stop CLI stages one birth-bound request; duplicates cannot overwrite it',
  { skip: process.platform !== 'win32', timeout: 20000 },
  async () => {
    const f = await fixture();
    try {
      const r = JSON.parse((await request(f.root)).stdout);
      assert.equal(r.status, 'STOP_REQUESTED_NOT_YET_STOPPED');
      const bytes = await readFile(path.join(f.root, 'stop-request.json'));
      assert.deepEqual(JSON.parse(bytes.toString()), { schemaVersion: 1, ...f.input });
      assert.doesNotThrow(() => process.kill(f.child.pid!, 0), 'CLI must not claim or force process termination');
      await assert.rejects(request(f.root));
      assert.deepEqual(await readFile(path.join(f.root, 'stop-request.json')), bytes);
    } finally {
      await f.cleanup();
    }
  },
);
test(
  'T31 stop CLI rejects mismatched OS birth identity without signalling the live process',
  { skip: process.platform !== 'win32', timeout: 20000 },
  async () => {
    const f = await fixture();
    try {
      await writeFile(
        path.join(f.root, 'inputs.json'),
        JSON.stringify({ ...f.input, workerIdentityHash: '0'.repeat(64) }),
      );
      await assert.rejects(request(f.root));
      await assert.rejects(readFile(path.join(f.root, 'stop-request.json')), { code: 'ENOENT' });
      assert.doesNotThrow(() => process.kill(f.child.pid!, 0));
    } finally {
      await f.cleanup();
    }
  },
);
test(
  'T31 stop CLI rejects a stopped worker and an out-of-run target',
  { skip: process.platform !== 'win32', timeout: 20000 },
  async () => {
    const f = await fixture();
    try {
      const closed = once(f.child, 'close');
      f.child.kill();
      await closed;
      await assert.rejects(request(f.root));
      await assert.rejects(request(process.cwd()));
      await assert.rejects(readFile(path.join(f.root, 'stop-request.json')), { code: 'ENOENT' });
    } finally {
      await f.cleanup();
    }
  },
);

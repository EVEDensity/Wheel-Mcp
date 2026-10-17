import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm, realpath, lstat, mkdir, symlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { cleanupValidationStage } from '../src/project/validated-write.js';
import { windowsPowerShellExecutable } from '../src/process-identity.js';

async function lockedStage() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-validate-'));
  const file = path.join(root, 'locked.txt');
  await writeFile(file, 'preserved until the lock is released');
  const script =
    '$ErrorActionPreference="Stop"; $f=[IO.File]::Open($env:WHEEL_CLEANUP_LOCK,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None); try { [Console]::WriteLine("LOCKED"); [Console]::In.ReadLine() | Out-Null } finally { $f.Dispose() }';
  const executable = windowsPowerShellExecutable();
  const started = performance.now();
  let deadlineExpired = false;
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    env: { ...process.env, WHEEL_CLEANUP_LOCK: file },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  let stderr = '';
  child.stderr.on('data', (bytes) => {
    stderr = (stderr + bytes.toString()).slice(-4000);
  });
  const ready = new Promise<void>((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (bytes) => {
      output += bytes.toString();
      if (/(^|\r?\n)LOCKED\r?\n/.test(output)) resolve();
    });
    child.once('error', reject);
    child.once('close', (code, signal) =>
      reject(
        new Error(
          `Lock helper not ready: ${JSON.stringify({
            executable,
            code,
            signal,
            deadlineExpired,
            elapsedMs: Math.round(performance.now() - started),
            stderr,
          })}`,
        ),
      ),
    );
  });
  const deadline = setTimeout(() => {
    deadlineExpired = true;
    child.kill();
  }, 10000);
  try {
    await ready;
  } catch (error) {
    clearTimeout(deadline);
    child.kill();
    await closed.catch(() => {});
    throw error;
  }
  return {
    root,
    release: () => {
      if (!child.stdin.writableEnded) child.stdin.end('\n');
    },
    close: async () => {
      if (!child.stdin.writableEnded) child.stdin.end('\n');
      await closed;
      clearTimeout(deadline);
    },
  };
}

test(
  'validation cleanup waits out a real transient Windows file lock',
  { skip: process.platform !== 'win32', timeout: 20000 },
  async () => {
    const f = await lockedStage();
    let timer: NodeJS.Timeout | undefined;
    try {
      await assert.rejects(rm(f.root, { recursive: true, force: false }));
      timer = setTimeout(f.release, 300);
      await cleanupValidationStage(f.root);
      assert.equal(existsSync(f.root), false);
    } finally {
      clearTimeout(timer);
      await f.close();
      if (existsSync(f.root)) await cleanupValidationStage(f.root);
    }
  },
);

test(
  'persistent Windows file lock remains an error and retains the stage',
  { skip: process.platform !== 'win32', timeout: 20000 },
  async () => {
    const f = await lockedStage();
    try {
      await assert.rejects(cleanupValidationStage(f.root), (error: NodeJS.ErrnoException) => {
        assert.ok(['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES'].includes(error.code ?? ''));
        return true;
      });
      assert.equal(existsSync(f.root), true);
    } finally {
      await f.close();
      await cleanupValidationStage(f.root);
    }
  },
);

test('validation cleanup rejects an out-of-root target and a directory junction without touching its contents', async () => {
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, 'wheel-cleanup-control-'));
  const target = path.join(root, 'wheel-validate-protected');
  const alias = await mkdtemp(path.join(os.tmpdir(), 'wheel-validate-'));
  try {
    await mkdir(target);
    await writeFile(path.join(target, 'keep.txt'), 'unchanged');
    await assert.rejects(cleanupValidationStage(target), { code: 'FORBIDDEN' });
    await cleanupValidationStage(alias); // Empty owned placeholder, then a junction to the owned fixture.
    await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(cleanupValidationStage(alias), { code: 'FORBIDDEN' });
    assert.equal(await readFile(path.join(target, 'keep.txt'), 'utf8'), 'unchanged');
  } finally {
    if (existsSync(alias)) await rm(alias, { recursive: true }); // rm removes the link, not its target.
    assert.equal(path.dirname(await realpath(root)), parent);
    assert.equal((await lstat(root)).isSymbolicLink(), false);
    assert.match(path.basename(root), /^wheel-cleanup-control-[A-Za-z0-9]+$/);
    await rm(root, { recursive: true });
  }
});

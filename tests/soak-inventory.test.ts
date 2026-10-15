import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, lstat, unlink, realpath, rm, rmdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { inspectSoakInventory } from '../src/soak-inventory.js';

async function fixture() {
  const parent = await realpath(os.tmpdir());
  const root = await realpath(await mkdtemp(path.join(parent, 'wheel-soak-inventory-')));
  await mkdir(path.join(root, '.harness', 'scene-staging'), { recursive: true });
  await mkdir(path.join(root, '.harness', 'engine'));
  await writeFile(path.join(root, 'project.godot'), 'x');
  await writeFile(path.join(root, '.harness/engine/copied-engine.exe'), 'ignored immutable copy');
  return {
    root,
    async cleanup() {
      assert.equal(path.dirname(await realpath(root)), parent);
      assert.match(path.basename(root), /^wheel-soak-inventory-[A-Za-z0-9]+$/);
      await rm(root, { recursive: true, force: false });
    },
  };
}
const quotas = { maxFiles: 100, maxBytes: 1000, retiredShadowDirs: new Set<string>() };
function disappearOnce(target: string): typeof lstat {
  let removed = false;
  return (async (file: Parameters<typeof lstat>[0]) => {
    if (file === target && !removed) {
      removed = true;
      await unlink(target);
    }
    return lstat(file);
  }) as typeof lstat;
}
test('T31 inventory records an actual disappearing UID rename temp with conservative file count', async () => {
  const f = await fixture();
  try {
    const tmp = path.join(f.root, '.harness/scene-staging', 'a'.repeat(32) + '.tscn.uidren889127867.tmp');
    await writeFile(tmp, 'uid');
    const r = await inspectSoakInventory(f.root, { ...quotas, inspect: disappearOnce(tmp) });
    assert.equal(r.bytes, 1);
    assert.equal(r.files, 2);
    assert.equal(r.vanishedEntries, 1);
    assert.equal(r.atomicSnapshot, false);
    assert.equal(r.vanished[0].kind, 'UID_RENAME_TEMP');
    assert.match(r.removedTransientBytes, /UNKNOWN/);
  } finally {
    await f.cleanup();
  }
});
test('T31 inventory never suppresses missing important files or UID-like names outside the exact staging directory', async () => {
  for (const relative of [
    '.harness/scene-staging/critical.tscn',
    'project-report.json',
    'a'.repeat(32) + '.tscn.uidren1.tmp',
  ]) {
    const f = await fixture();
    try {
      const file = path.join(f.root, relative);
      await writeFile(file, 'important');
      await assert.rejects(inspectSoakInventory(f.root, { ...quotas, inspect: disappearOnce(file) }), {
        code: 'ENOENT',
      });
    } finally {
      await f.cleanup();
    }
  }
});

test('T31 inventory only accepts an observed ledger staging file in the authenticated session', async () => {
  for (const kind of ['known', 'no-binding', 'other-session', 'final', 'directory'] as const) {
    const f = await fixture();
    try {
      const session = 'b'.repeat(32);
      const folder = path.join(f.root, '.harness', `editor-outcomes-${session}`, 'c'.repeat(64));
      await mkdir(folder, { recursive: true });
      const file = path.join(folder, kind === 'final' ? 'result.json' : 'a'.repeat(32) + '.tmp');
      if (kind === 'directory') await mkdir(file);
      else await writeFile(file, 'immutable result stage');
      const inspect =
        kind === 'directory'
          ? ((async (value: Parameters<typeof lstat>[0]) => {
              if (value === file) await rmdir(file);
              return lstat(value);
            }) as typeof lstat)
          : disappearOnce(file);
      const promise = inspectSoakInventory(f.root, {
        ...quotas,
        inspect,
        editorOutcomeSession: kind === 'no-binding' ? undefined : kind === 'other-session' ? 'd'.repeat(32) : session,
      });
      if (kind === 'known') {
        const r = await promise;
        assert.equal(r.vanished[0].kind, 'EDITOR_OUTCOME_STAGE_TEMP');
        assert.equal(r.files, 2);
        assert.equal(r.bytes, 1);
      } else await assert.rejects(promise, { code: 'ENOENT' });
    } finally {
      await f.cleanup();
    }
  }
});
test('T31 inventory only tolerates removal in explicitly archived stopped-shadow slots', async () => {
  for (const archived of [false, true]) {
    const f = await fixture();
    try {
      const dir = path.join(f.root, '.harness/shadow/cycle-3');
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, 'stdout.log');
      await writeFile(file, 'native output');
      // Archive membership is an explicit TEST DOUBLE; the native retention helper validates it separately.
      const promise = inspectSoakInventory(f.root, {
        ...quotas,
        retiredShadowDirs: new Set(archived ? [dir] : []),
        inspect: disappearOnce(file),
      });
      if (archived) {
        const r = await promise;
        assert.equal(r.vanished[0].kind, 'ARCHIVED_STOPPED_SHADOW');
      } else await assert.rejects(promise, { code: 'ENOENT' });
    } finally {
      await f.cleanup();
    }
  }
});
test('T31 inventory retains file and byte quotas, permission failures and exact retirement boundaries', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, 'big'), 'xx');
    await assert.rejects(inspectSoakInventory(f.root, { ...quotas, maxBytes: 1 }), /quota/);
    await assert.rejects(inspectSoakInventory(f.root, { ...quotas, maxFiles: 1 }), /quota/);
    await assert.rejects(
      inspectSoakInventory(f.root, {
        ...quotas,
        retiredShadowDirs: new Set([path.join(f.root, '.harness/scene-staging')]),
      }),
      /exact fixture/,
    );
    const denied = Object.assign(new Error('Explicit simulated permission error'), { code: 'EACCES' });
    await assert.rejects(
      inspectSoakInventory(f.root, {
        ...quotas,
        inspect: (async () => {
          throw denied;
        }) as typeof lstat,
      }),
      { code: 'EACCES' },
    );
  } finally {
    await f.cleanup();
  }
});
test('T31 inventory refuses actual directory links rather than following them into evidence', async () => {
  const f = await fixture();
  try {
    await symlink(
      path.join(f.root, '.harness/scene-staging'),
      path.join(f.root, 'link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await assert.rejects(inspectSoakInventory(f.root, quotas), /symlinks/);
  } finally {
    await f.cleanup();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rename, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { searchProject } from '../src/godot-development.js';
import { getProjectIndex } from '../src/index/project-index.js';
import { createTimeoutContext } from '../src/timeout.js';
import { setTimeout as delay } from 'node:timers/promises';

test('search rereads changed project text', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-index-change-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  await writeFile(path.join(root, 'probe.gd'), 'extends Node\n# before\n');
  assert.equal((await searchProject(root, 'before')).results.length, 1);
  await writeFile(path.join(root, 'probe.gd'), 'extends Node\n# after\n');
  assert.equal((await searchProject(root, 'before')).results.length, 0);
  assert.equal((await searchProject(root, 'after')).results.length, 1);
});
test('watcher marks a snapshot stale, and disabled watcher events are recovered by explicit rescan', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-index-watch-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  const index = await getProjectIndex(root);
  await index.refresh();
  index.startWatching();
  try {
    assert.equal(index.readSnapshot()!.watcher, 'active');
    await writeFile(path.join(root, 'new.gd'), 'extends Node\n');
    for (let attempt = 0; attempt < 100 && !index.readSnapshot()!.stale; attempt++) await delay(20);
    assert.equal(index.readSnapshot()!.stale, true);
  } finally {
    index.stopWatching();
  }
  const rescanned = await index.refresh();
  assert.equal(rescanned.stale, false);
  await writeFile(path.join(root, 'new.gd'), 'extends Node\n# event was not watched\n');
  const missed = await index.refresh(undefined, true);
  assert.notEqual(missed.sourceHash, rescanned.sourceHash);
  assert.equal(missed.watcher, 'disabled');
});
test('parallel queries for one project do not fail because the index is refreshing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-index-parallel-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  await writeFile(path.join(root, 'probe.gd'), 'extends Node\n# needle\n');
  const results = await Promise.all([searchProject(root, 'needle'), searchProject(root, 'needle')]);
  assert.equal(results[0].results.length, 1);
  assert.equal(results[1].results.length, 1);
  assert.equal(results[0].index.sourceHash, results[1].index.sourceHash);
});
test('cancelling a queued refresh does not cancel its neighbours or strand the queue', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-index-queue-cancel-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  const index = await getProjectIndex(root);
  const first = index.refresh();
  const timeout = createTimeoutContext(10000);
  const cancelled = index.refresh(timeout);
  const rejection = assert.rejects(cancelled, { code: 'CANCELLED' });
  timeout.cancel();
  const last = index.refresh();
  try {
    await rejection;
    assert.equal((await first).stale, false);
    assert.equal((await last).stale, false);
    assert.equal((await index.refresh()).stats.readFiles, 0);
  } finally {
    timeout.dispose();
  }
});
test('refresh queue has an absolute bound and releases capacity after completion', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-index-queue-budget-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  const index = await getProjectIndex(root);
  const pending = Array.from({ length: 32 }, () => index.refresh());
  await assert.rejects(index.refresh(), { code: 'UNSUPPORTED' });
  await Promise.all(pending);
  assert.equal((await index.refresh()).stale, false);
});
test('cancellation after a scan enters leaves the last committed snapshot stale and intact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-index-active-cancel-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  const index = await getProjectIndex(root);
  const base = await index.refresh();
  await writeFile(path.join(root, 'new.gd'), 'extends Node\n');
  const timeout = createTimeoutContext(10000);
  const scan = index.refresh(timeout);
  const rejected = assert.rejects(scan, { code: 'CANCELLED' });
  await Promise.resolve();
  timeout.cancel();
  try {
    await rejected;
    assert.equal(index.readSnapshot()!.sourceHash, base.sourceHash);
    assert.equal(index.readSnapshot()!.stale, true);
    assert.notEqual((await index.refresh()).sourceHash, base.sourceHash);
  } finally {
    timeout.dispose();
  }
});
test('rescan handles create/change/delete/rename without watcher and cancel leaves stale previous snapshot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-index-lost-event-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  const index = await getProjectIndex(root);
  const base = await index.refresh();
  await writeFile(path.join(root, 'new.gd'), 'extends Node\n');
  const created = await index.refresh();
  assert.equal(created.stats.readFiles, 1);
  assert.equal(created.stats.reusedFiles, 1);
  assert.notEqual(created.sourceHash, base.sourceHash);
  await rename(path.join(root, 'new.gd'), path.join(root, 'renamed.gd'));
  const renamed = await index.refresh();
  assert.ok(renamed.files.some((file) => file.path === 'renamed.gd'));
  assert.ok(!renamed.files.some((file) => file.path === 'new.gd'));
  await writeFile(path.join(root, 'renamed.gd'), 'extends Node\n# changed\n');
  const abort = new AbortController();
  abort.abort();
  const timeout = createTimeoutContext(1000, abort.signal);
  try {
    await assert.rejects(index.refresh(timeout));
  } finally {
    timeout.dispose();
  }
  assert.equal(index.readSnapshot()!.stale, true);
  assert.equal(index.readSnapshot()!.sourceHash, renamed.sourceHash);
  const verified = await index.refresh(undefined, true);
  assert.equal(verified.stale, false);
  assert.equal(verified.stats.readFiles, 2);
  assert.notEqual(verified.sourceHash, renamed.sourceHash);
  await unlink(path.join(root, 'renamed.gd'));
  assert.deepEqual(
    (await index.refresh()).files.map((file) => file.path),
    ['project.godot'],
  );
});

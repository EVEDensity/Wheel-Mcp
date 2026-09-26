import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gitCheckpoint, gitRecovery } from '../src/git-recovery.js';
import { fixtureApproval } from './helpers/project-approval.js';

const exec = promisify(execFile);

test('git checkpoint captures HEAD, status, and patch, then recovery reverses it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'godot-mcp-git-'));
  await exec('git', ['init', '-q'], { cwd: root });
  await exec('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await exec('git', ['config', 'user.name', 'MCP Test'], { cwd: root });
  await exec('git', ['config', 'core.autocrlf', 'false'], { cwd: root });
  const file = path.join(root, 'value.txt');
  await writeFile(file, 'before\n');
  await exec('git', ['add', 'value.txt'], { cwd: root });
  await exec('git', ['commit', '-q', '-m', 'fixture'], { cwd: root });
  await writeFile(file, 'after\n');
  const evidence = path.join(root, 'evidence');
  const checkpoint = await gitCheckpoint(root, evidence);
  assert.equal(checkpoint.source, 'REAL');
  assert.match(checkpoint.status, /value\.txt/);
  assert.match(await readFile(checkpoint.patch, 'utf8'), /after/);
  await assert.rejects(gitRecovery(root, checkpoint.patch), /approval provider/);
  assert.equal(await readFile(file, 'utf8'), 'after\n');
  const recovery = await gitRecovery(root, checkpoint.patch, undefined, fixtureApproval);
  assert.equal(recovery.status, 'PASS');
  assert.equal(recovery.transactionState, 'COMMITTED');
  assert.equal(await readFile(file, 'utf8'), 'before\n');
});

test('recovery previews all regular text targets without writing them, and denial preserves both files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-git-text-'));
  await writeFile(path.join(root, 'one.txt'), 'after\n');
  await writeFile(path.join(root, 'two.txt'), 'changed\n');
  const patch = path.join(root, 'change.patch');
  await writeFile(
    patch,
    'diff --git a/one.txt b/one.txt\n--- a/one.txt\n+++ b/one.txt\n@@ -1 +1 @@\n-before\n+after\n' +
      'diff --git a/two.txt b/two.txt\n--- a/two.txt\n+++ b/two.txt\n@@ -1 +1 @@\n-original\n+changed\n',
  );
  await assert.rejects(
    gitRecovery(root, patch, undefined, async (plan) => {
      assert.deepEqual(plan.impact, ['one.txt', 'two.txt']);
      assert.equal(await readFile(path.join(root, 'one.txt'), 'utf8'), 'after\n');
      return null;
    }),
    /approval denied/,
  );
  assert.equal(await readFile(path.join(root, 'one.txt'), 'utf8'), 'after\n');
  assert.equal(await readFile(path.join(root, 'two.txt'), 'utf8'), 'changed\n');
  const accepted = await gitRecovery(root, patch, undefined, fixtureApproval);
  assert.equal(accepted.transactionState, 'COMMITTED');
  assert.equal(await readFile(path.join(root, 'one.txt'), 'utf8'), 'before\n');
  assert.equal(await readFile(path.join(root, 'two.txt'), 'utf8'), 'original\n');
});

test('reverse create/delete is journaled; path traversal, symlink modes and binary patches fail closed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-git-create-delete-'));
  await writeFile(path.join(root, 'new.txt'), 'new\n');
  const patch = path.join(root, 'change.patch');
  await writeFile(
    patch,
    'diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+new\n' +
      'diff --git a/old.txt b/old.txt\ndeleted file mode 100644\n--- a/old.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n',
  );
  const result = await gitRecovery(root, patch, undefined, fixtureApproval);
  assert.equal(result.transactionState, 'COMMITTED');
  await assert.rejects(readFile(path.join(root, 'new.txt')), /ENOENT/);
  assert.equal(await readFile(path.join(root, 'old.txt'), 'utf8'), 'old\n');
  for (const text of [
    'diff --git a/../outside.txt b/../outside.txt\n--- a/../outside.txt\n+++ b/../outside.txt\n@@ -1 +1 @@\n-old\n+new\n',
    'diff --git a/link b/link\nnew file mode 120000\n--- /dev/null\n+++ b/link\n@@ -0,0 +1 @@\n+../../outside\n',
    'diff --git a/bin b/bin\nGIT binary patch\nliteral 1\nx\n',
    'diff --git a/exe b/exe\nold mode 100644\nnew mode 100755\n',
  ]) {
    await writeFile(patch, text);
    await assert.rejects(gitRecovery(root, patch, undefined, fixtureApproval));
  }
  assert.equal(await readFile(path.join(root, 'old.txt'), 'utf8'), 'old\n');
});

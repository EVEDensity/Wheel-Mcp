// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gitCheckpoint, gitRecovery } from '../src/git-recovery.js';

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
  const recovery = await gitRecovery(root, checkpoint.patch);
  assert.equal(recovery.status, 'PASS');
  assert.equal(await readFile(file, 'utf8'), 'before\n');
});

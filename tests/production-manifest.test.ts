import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

function invoke(flag: string, content: string) {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'wheel-manifest-'));
  try {
    const file = path.join(temp, 'input.json');
    writeFileSync(file, content);
    return spawnSync(process.execPath, ['scripts/verify-production.mjs', flag, file], { encoding: 'utf8' });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

const summary = (skipped: number) =>
  JSON.stringify({
    type: 'test:summary',
    data: { counts: { tests: 1, passed: 1 - skipped, failed: 0, skipped, cancelled: 0, todo: 0 } },
  }) + '\n';

test('structured test report accepts a complete passing summary', () => {
  const result = invoke('--assess-report', summary(0));
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('structured test report rejects skipped tests rather than treating process exit 0 as pass', () => {
  const result = invoke('--assess-report', summary(1));
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /"status":"FAIL"/);
});

test('structured test report rejects missing or malformed summary', () => {
  for (const content of ['', 'not json\n', '{}\n']) {
    const result = invoke('--assess-report', content);
    assert.notEqual(result.status, 0);
  }
});

test('a truncated suite cannot use a successful per-file summary to hide an earlier native failure', () => {
  const partial = [
    { type: 'test:fail', data: { name: 'native ledger timed out' } },
    {
      type: 'test:summary',
      data: { file: 'contract.test.js', counts: { tests: 4, passed: 4, failed: 0, skipped: 0, cancelled: 0, todo: 0 } },
    },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');
  const result = invoke('--assess-report', partial);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /no final summary/);
});

test('a passing cumulative summary cannot conceal a recorded failure', () => {
  const result = invoke(
    '--assess-report',
    JSON.stringify({ type: 'test:fail', data: { name: 'native failure' } }) + '\n' + summary(0),
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /conceals a failure/);
});

test('manifest validator rejects a forged PASS with skipped required tests', () => {
  const manifest = {
    schemaVersion: 1,
    caseId: 'T00-baseline',
    taskId: 'T00',
    gateId: 'G0',
    source: { head: 'a'.repeat(40), sourceHash: 'b'.repeat(64) },
    environment: { node: 'v24', os: 'win32', godot: '4.7.2', renderer: 'headless' },
    commands: [
      {
        name: 'smoke',
        argv: ['node', '--test'],
        required: true,
        status: 'PASS',
        exitCode: 0,
        signal: null,
        durationMs: 5,
        outputHash: 'c'.repeat(64),
        tests: { skipped: 1 },
      },
    ],
    inputSnapshotHash: 'd'.repeat(64),
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 5,
    testDouble: 'REAL',
    evidence: [],
  };
  const result = invoke('--check-manifest', JSON.stringify(manifest));
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /invalid PASS/);
});

test('source identity binds workflow removal independently of staging and commit state', async () => {
  const { sourceIdentity } = await import(pathToFileURL(path.resolve('scripts/lib/production-manifest.mjs')).href);
  const root = mkdtempSync(path.join(os.tmpdir(), 'wheel-source-deletion-'));
  const workflow = '.github/workflows/old.yml';
  try {
    mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
    writeFileSync(path.join(root, workflow), 'name: old\n');
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', `core.hooksPath=${path.join(root, 'empty-hooks')}`, ...args], {
        cwd: root,
        windowsHide: true,
        stdio: 'pipe',
      });
    git('init', '-q');
    git('add', workflow);
    git('-c', 'user.name=CI fixture', '-c', 'user.email=ci@example.invalid', 'commit', '-qm', 'fixture');
    const before = await sourceIdentity(root);
    unlinkSync(path.join(root, workflow));
    const deleted = await sourceIdentity(root);
    assert.notEqual(deleted.sourceHash, before.sourceHash);
    assert.equal(
      deleted.files.find((file: { path: string }) => file.path === workflow),
      undefined,
    );
    git('add', '-u');
    assert.equal((await sourceIdentity(root)).sourceHash, deleted.sourceHash);
    git('-c', 'user.name=CI fixture', '-c', 'user.email=ci@example.invalid', 'commit', '-qm', 'remove workflow');
    assert.equal((await sourceIdentity(root)).sourceHash, deleted.sourceHash);
    writeFileSync(path.join(root, workflow), 'name: old\n');
    assert.equal((await sourceIdentity(root)).sourceHash, before.sourceHash);
  } finally {
    rmSync(root, { recursive: true, force: false });
  }
});

test('source identity canonicalizes LF text but preserves exact binary fixture bytes', async () => {
  const { sourceIdentity } = await import(pathToFileURL(path.resolve('scripts/lib/production-manifest.mjs')).href);
  const root = mkdtempSync(path.join(os.tmpdir(), 'wheel-source-eol-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', `core.hooksPath=${path.join(root, 'empty-hooks')}`, ...args], {
      cwd: root,
      windowsHide: true,
      stdio: 'pipe',
    });
  try {
    mkdirSync(path.join(root, 'src'));
    mkdirSync(path.join(root, 'tests'));
    writeFileSync(path.join(root, '.gitattributes'), '* text eol=lf\n*.png binary\n');
    writeFileSync(path.join(root, 'src/probe.ts'), 'export const value = 1;\n');
    writeFileSync(path.join(root, 'tests/probe.png'), Buffer.from([0, 13, 10, 2]));
    git('init', '-q');
    git('add', '.');
    git('-c', 'user.name=CI fixture', '-c', 'user.email=ci@example.invalid', 'commit', '-qm', 'fixture');
    const before = await sourceIdentity(root);
    writeFileSync(path.join(root, 'src/probe.ts'), 'export const value = 1;\r\n');
    assert.equal((await sourceIdentity(root)).sourceHash, before.sourceHash);
    git('add', '.');
    assert.equal((await sourceIdentity(root)).sourceHash, before.sourceHash);
    writeFileSync(path.join(root, 'tests/probe.png'), Buffer.from([0, 10, 2]));
    assert.notEqual((await sourceIdentity(root)).sourceHash, before.sourceHash);
    writeFileSync(path.join(root, 'src/probe.ts'), 'export const value = 2;\n');
    assert.notEqual((await sourceIdentity(root)).sourceHash, before.sourceHash);
  } finally {
    rmSync(root, { recursive: true, force: false });
  }
});

test('Git publication preserves byte-hashed evidence, frozen corpus and WebP assets', async () => {
  for (const file of [
    'docs/production-roadmap/evidence/T29-cases-complete.json',
    'benchmarks/historical-defects.v1.json',
    'docs/assets/icons/cursor.webp',
  ]) {
    const filtered = execFileSync('git', ['hash-object', `--path=${file}`, file], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    const raw = execFileSync('git', ['hash-object', '--no-filters', file], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    assert.equal(filtered, raw, `${file} must not be changed by Git text conversion`);
  }
  const original = await readFile('benchmarks/historical-defects.v1.json');
  assert.equal(
    createHash('sha256').update(original).digest('hex'),
    (await readFile('benchmarks/historical-defects.v1.sha256', 'utf8')).trim(),
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

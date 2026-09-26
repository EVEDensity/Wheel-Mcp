import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const original = JSON.parse(readFileSync('docs/production-roadmap/tasks.json', 'utf8'));
function check(mutator: (state: typeof original) => void) {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'wheel-roadmap-'));
  try {
    const state = structuredClone(original);
    mutator(state);
    const file = path.join(temp, 'tasks.json');
    writeFileSync(file, JSON.stringify(state));
    return spawnSync(process.execPath, ['scripts/check-roadmap.mjs', '--state', file], { encoding: 'utf8' });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

test('roadmap accepts the actual task and Gate state', () => {
  const result = check(() => {});
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('roadmap rejects done before dependency and missing required evidence', () => {
  const result = check((state) => {
    state.tasks[0].status = 'todo';
    state.tasks[1].status = 'done';
    state.tasks[1].evidence = [];
    state.tasks[1].verification = [];
    state.tasks[1].completedAt = new Date().toISOString();
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /done before dependency T00/);
  assert.match(result.stdout, /done without evidence/);
});

test('roadmap rejects a forged Gate pass and an unknown dependency', () => {
  const result = check((state) => {
    state.tasks[2].dependencies.push('T99');
    const pendingGate = state.gates.find((gate: { status: string }) => gate.status !== 'PASS');
    assert.ok(pendingGate);
    pendingGate.status = 'PASS';
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /missing or forward dependency T99/);
  assert.match(result.stdout, /PASS without completed tasks/);
});

test('roadmap rejects missing or forged Gate evidence', () => {
  const result = check((state) => {
    state.gates[0].status = 'PASS';
    state.gates[0].sourceHash = 'b'.repeat(64);
    state.gates[0].evidence = [
      {
        id: 'fake-gate',
        pathOrArchiveId: 'docs/production-roadmap/missing-gate.json',
        sha256: 'a'.repeat(64),
        sourceHash: 'b'.repeat(64),
        createdAt: new Date().toISOString(),
        source: 'REAL',
      },
    ];
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /gate evidence .* unavailable/);
});

test('roadmap rejects missing evidence file even when a hash is supplied', () => {
  const result = check((state) => {
    state.tasks[0].evidence = [
      {
        id: 'fake',
        pathOrArchiveId: 'docs/production-roadmap/missing.json',
        sha256: 'a'.repeat(64),
        sourceHash: 'b'.repeat(64),
        createdAt: new Date().toISOString(),
        source: 'REAL',
      },
    ];
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /unavailable/);
});

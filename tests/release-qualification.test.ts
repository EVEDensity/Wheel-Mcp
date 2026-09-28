import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const original = JSON.parse(readFileSync('docs/production-roadmap/tasks.json', 'utf8'));
function check(state: typeof original) {
  const script =
    "import {readFileSync} from 'node:fs';import {assessReleaseQualification} from './scripts/lib/release-qualification.mjs';process.stdout.write(JSON.stringify(assessReleaseQualification(JSON.parse(readFileSync(0,'utf8')),'a'.repeat(64))))";
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    input: JSON.stringify(state),
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(r.status, 0, r.error?.message ?? r.stderr);
  return JSON.parse(r.stdout) as string[];
}
test('historical matrix/early gates cannot qualify an unfinished current roadmap', () => {
  const errors = check(original);
  assert.ok(errors.some((e) => e.includes('NOT_QUALIFIED')));
  assert.ok(errors.some((e) => e.includes('G2')));
  assert.ok(errors.some((e) => e.includes('current sourceHash')));
});

test('large roadmap input uses stdin without Windows command-line length limits', () => {
  const state = structuredClone(original);
  state.tasks[0].notes += 'x'.repeat(100000);
  const errors = check(state);
  assert.ok(errors.some((e) => e.includes('NOT_QUALIFIED')));
  const pending = state.tasks.find((t: { status: string }) => t.status !== 'done');
  assert.ok(pending, 'fixture must contain unfinished work');
  assert.ok(errors.some((e) => e.includes(pending.id)));
});
test('even forged done/PASS labels cannot promote a different source fingerprint', () => {
  const state = structuredClone(original);
  for (const t of state.tasks) {
    t.status = 'done';
    t.verification = [{ required: true, status: 'PASS' }];
  }
  for (const g of state.gates) {
    g.status = 'PASS';
    g.sourceHash = 'b'.repeat(64);
  }
  state.qualification = { status: 'QUALIFIED', candidateSourceHash: 'b'.repeat(64) };
  assert.ok(check(state).some((e) => e.includes('candidateSourceHash')));
  for (const g of state.gates) g.sourceHash = 'a'.repeat(64);
  state.qualification.candidateSourceHash = 'a'.repeat(64);
  assert.deepEqual(check(state), []); // structural check only; release-check separately verifies every evidence file/hash.
  state.tasks[14].verification[0].status = 'SKIP';
  assert.ok(check(state).some((e) => e.includes('T14')));
});

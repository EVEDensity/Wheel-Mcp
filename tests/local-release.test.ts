import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const { localReleasePolicy, localReleaseSteps, assessLocalRelease } = await import(
  pathToFileURL(path.resolve('scripts/lib/local-release.mjs')).href
);
// MOCK receipts exercise only the verifier, never qualify an actual release.
function receipt() {
  return {
    schemaVersion: 1,
    status: 'PASS',
    version: '0.2.0',
    sourceHash: 'a'.repeat(64),
    policy: localReleasePolicy,
    documents: { readme: 'b'.repeat(64) },
    environment: { platform: 'win32', godot: '4.7.2.stable', node: 'v24.18.0' },
    durationMs: 1000,
    steps: localReleaseSteps.map((step: { id: string }) => ({
      id: step.id,
      status: 'PASS',
      exitCode: 0,
      signal: null,
      error: null,
      durationMs: 5,
      outputHash: 'c'.repeat(64),
      tests: { tests: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0 },
      scratchCleanup: 'PASS',
    })),
    package: { version: '0.2.0', files: 109, sha256: 'd'.repeat(64), excluded: 0 },
    audit: { metadata: { vulnerabilities: { total: 0 } } },
    productionQualification: 'NOT_QUALIFIED',
  };
}
const current = { sourceHash: 'a'.repeat(64), version: '0.2.0', documents: { readme: 'b'.repeat(64) } };
test('limited local release accepts complete receipts without promoting production qualification', () =>
  assert.deepEqual(assessLocalRelease(receipt(), current), []));
test('local release rejects skipped tests, unknown actors and changed source or documents', () => {
  for (const mutate of [
    (value: ReturnType<typeof receipt>) => {
      value.steps[0].tests.skipped = 1;
    },
    (value: ReturnType<typeof receipt>) => {
      value.steps[0].scratchCleanup = 'RETAINED';
    },
    (value: ReturnType<typeof receipt>) => {
      value.sourceHash = 'f'.repeat(64);
    },
    (value: ReturnType<typeof receipt>) => {
      value.documents.readme = 'f'.repeat(64);
    },
    (value: ReturnType<typeof receipt>) => {
      value.steps.pop();
    },
    (value: ReturnType<typeof receipt>) => {
      value.steps[0].exitCode = 1;
    },
    (value: ReturnType<typeof receipt>) => {
      value.durationMs = 360001;
    },
    (value: ReturnType<typeof receipt>) => {
      value.productionQualification = 'QUALIFIED';
    },
  ]) {
    const value = receipt();
    mutate(value);
    assert.ok(assessLocalRelease(value, current).length);
  }
});
test('local release requires real supported environment, clean audit and narrow runtime artifact', () => {
  for (const mutate of [
    (value: ReturnType<typeof receipt>) => {
      value.environment.platform = 'linux';
    },
    (value: ReturnType<typeof receipt>) => {
      value.environment.godot = '4.6.0';
    },
    (value: ReturnType<typeof receipt>) => {
      value.audit.metadata.vulnerabilities.total = 1;
    },
    (value: ReturnType<typeof receipt>) => {
      value.package.excluded = 1;
    },
    (value: ReturnType<typeof receipt>) => {
      value.package.sha256 = 'invalid';
    },
    (value: ReturnType<typeof receipt>) => {
      value.steps[0].durationMs = 120001;
    },
  ]) {
    const value = receipt();
    mutate(value);
    assert.ok(assessLocalRelease(value, current).length);
  }
});
test('local release plan excludes long tests but keeps native safety and real package installation', () => {
  const plan = JSON.parse(
    execFileSync(process.execPath, ['scripts/release-gate-local.mjs', '--plan'], {
      encoding: 'utf8',
      windowsHide: true,
    }),
  );
  assert.equal(plan.doesNotPublish, true);
  assert.equal(plan.policy.transport, 'stdio');
  assert.equal(plan.policy.totalTimeoutMs, 360000);
  assert.doesNotMatch(JSON.stringify(plan.steps), /soak|verify:production|matrix:generate|test:built/);
  assert.ok(plan.steps.some((step: { id: string }) => step.id === 'safety'));
  assert.ok(plan.steps.some((step: { id: string }) => step.id === 'package'));
});

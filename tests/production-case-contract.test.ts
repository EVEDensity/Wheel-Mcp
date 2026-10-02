import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionCaseCoverage, nodeProductionCases, productionCaseSchema } from './helpers/production-cases.js';

test('T29 partial six-case catalog is valid but cannot qualify as thirty cases', () => {
  const cases = nodeProductionCases();
  assert.equal(cases.length, 6);
  assert.throws(() => assertProductionCaseCoverage(cases), /at least 30/);
  assert.throws(() => assertProductionCaseCoverage([...cases, cases[0]]), /Duplicate/);
  assert.throws(() => assertProductionCaseCoverage([{ ...cases[0], family: 'ui' }]), /mismatch/);
});
test('T29 frozen requests reject extra policy fields, malformed edits and unknown operations', () => {
  const item = nodeProductionCases()[0];
  for (const value of [
    { ...item, approved: true },
    { ...item, operations: [{ kind: 'execute', script: 'arbitrary' }] },
    { ...item, negativeCode: 'ANY_FAILURE' },
    { ...item, scopes: ['read', 'write', 'run', 'admin'] },
  ])
    assert.equal(productionCaseSchema.safeParse(value).success, false);
});
test('T29 callers cannot mutate shared catalog or silently change subsequent oracle definitions', () => {
  const cases = nodeProductionCases();
  cases[0].expectedPaths[0] = 'tampered';
  cases[0].operations.splice(0);
  assert.equal(nodeProductionCases()[0].expectedPaths[0], 'NewMarker');
  assert.equal(nodeProductionCases()[0].operations.length, 2);
});

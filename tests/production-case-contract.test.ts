import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertProductionCaseCoverage,
  extendedProductionCaseSchema,
  nodeProductionCases,
  productionCaseSchema,
  physicsProductionCases,
  uiProductionCases,
} from './helpers/production-cases.js';

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
test('T29 UI catalog is six frozen requests and still cannot qualify the thirty-case set', () => {
  const ui = uiProductionCases();
  assert.deepEqual(
    ui.map((item) => item.id),
    ['U01', 'U02', 'U03', 'U04', 'U05', 'U06'],
  );
  assert.equal(extendedProductionCaseSchema.safeParse({ ...ui[0], planner: true }).success, false);
  assert.deepEqual(
    physicsProductionCases().map((item) => item.id),
    ['P01', 'P02', 'P03', 'P04', 'P05', 'P06'],
  );
  assert.equal(nodeProductionCases().length + ui.length + physicsProductionCases().length, 18);
  assert.throws(() => assertProductionCaseCoverage(nodeProductionCases()), /at least 30/);
});
test('T29 callers cannot mutate shared catalog or silently change subsequent oracle definitions', () => {
  const cases = nodeProductionCases();
  cases[0].expectedPaths[0] = 'tampered';
  cases[0].operations.splice(0);
  assert.equal(nodeProductionCases()[0].expectedPaths[0], 'NewMarker');
  assert.equal(nodeProductionCases()[0].operations.length, 2);
});

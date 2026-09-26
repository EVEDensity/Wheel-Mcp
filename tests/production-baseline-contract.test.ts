import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const catalogUrl = pathToFileURL(path.resolve('tests/production-baseline/catalog.mjs')).href;

test('defect baseline has exactly D01–D10, split D09 ownership, and never calls defects PASS', async () => {
  const { defectCatalog, classifyProbe, validateBaselineSummary } = await import(catalogUrl);
  assert.deepEqual(
    defectCatalog.map((item: { id: string }) => item.id),
    Array.from({ length: 10 }, (_, index) => `D${String(index + 1).padStart(2, '0')}`),
  );
  assert.deepEqual(defectCatalog.find((item: { id: string }) => item.id === 'D09').ownerTasks, ['T18', 'T22']);
  assert.equal(classifyProbe({ verified: true, correct: false }), 'EXPECTED_DEFECT');
  assert.equal(classifyProbe({ verified: true, correct: true }), 'PASS');
  assert.equal(classifyProbe({ verified: false, correct: false }), 'INVALID_REPRO');
  assert.equal(classifyProbe({ correct: false }), 'INVALID_REPRO');
  const valid = {
    testDouble: 'MIXED',
    provenance: { engine: 'REAL', projectWriteApproval: 'MOCK: fixture only' },
    controls: ['C01', 'C02', 'C03'].map((id) => ({ id, status: 'PASS' })),
    cases: defectCatalog.map((item: { id: string; ownerTasks: string[]; expected: string }) => ({
      ...item,
      status: 'EXPECTED_DEFECT',
      input: { tool: 'sample' },
      provenance: { execution: 'REAL', approval: ['D04', 'D07'].includes(item.id) ? 'MOCK' : 'NOT_RUN' },
      actual: { observed: true },
      evidence: {
        actualSha256: createHash('sha256')
          .update(JSON.stringify({ observed: true }))
          .digest('hex'),
      },
      ...(item.id === 'D09'
        ? {
            subchecks: [
              { id: 'D09-3D', ownerTask: 'T18', status: 'EXPECTED_DEFECT' },
              { id: 'D09-SEMANTICS', ownerTask: 'T22', status: 'EXPECTED_DEFECT' },
            ],
          }
        : {}),
    })),
  };
  assert.deepEqual(validateBaselineSummary(valid), []);
  assert.match(validateBaselineSummary({ ...valid, testDouble: 'REAL' }).join('; '), /MOCK project approval/);
  assert.match(
    validateBaselineSummary({
      ...valid,
      cases: valid.cases.map((item: { id: string }) =>
        item.id === 'D07' ? { ...item, provenance: { execution: 'REAL', approval: 'REAL' } } : item,
      ),
    }).join('; '),
    /provenance mismatch/,
  );
  assert.match(validateBaselineSummary({ ...valid, cases: valid.cases.slice(1) }).join('; '), /coverage/);
  assert.match(validateBaselineSummary({ ...valid, controls: [{ id: 'C01', status: 'FAIL' }] }).join('; '), /control/);
  assert.match(
    validateBaselineSummary({
      ...valid,
      cases: valid.cases.map((item: { id: string }) =>
        item.id === 'D01' ? { ...item, status: 'INVALID_REPRO' } : item,
      ),
    }).join('; '),
    /not a verified defect/,
  );
  assert.match(
    validateBaselineSummary({
      ...valid,
      cases: valid.cases.map((item: { id: string }) =>
        item.id === 'D01' ? { ...item, actual: { observed: false } } : item,
      ),
    }).join('; '),
    /hash mismatch/,
  );
});

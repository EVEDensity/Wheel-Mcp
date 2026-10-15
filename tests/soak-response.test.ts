import test from 'node:test';
import assert from 'node:assert/strict';
import { completeResponse } from './helpers/paged-response.js';
import { budgetResponse, readResponsePage, runWithResponseOwner } from '../src/response-budget.js';

test('T31 consumes actual budget pages including UTF-8, without retrying the writer', async () => {
  let writes = 0,
    reads = 0;
  const body = { response: { value: { x: 240 } }, events: '实际事件🪐'.repeat(12000) };
  await runWithResponseOwner('soak-client', async () => {
    writes++;
    const initial = budgetResponse(body);
    assert.equal(initial.status, 'PARTIAL');
    const result = await completeResponse(initial, async (ref, cursor) => {
      reads++;
      return readResponsePage(ref, cursor);
    });
    assert.deepEqual(result, body);
  });
  assert.equal(writes, 1);
  assert.ok(reads > 10);
});
test('T31 never converts a failed response or page-read failure into success', async () => {
  const failed = budgetResponse({ status: 'FAIL', code: 'UNKNOWN', message: 'x'.repeat(40000) });
  await assert.rejects(
    completeResponse(failed, async () => {
      throw new Error('should not read');
    }),
  );
  const initial = budgetResponse({ response: {}, events: 'x'.repeat(40000) });
  await assert.rejects(
    completeResponse(initial, async () => {
      throw new Error('NOT_FOUND');
    }),
    /NOT_FOUND/,
  );
});
test('T31 refuses repeated cursors, changed snapshots, over-budget pages and incomplete JSON', async () => {
  const page = {
    encoding: 'json',
    chunk: '{',
    status: 'PARTIAL',
    truncated: true,
    continuation: { ref: 'fixed', cursor: 1, totalBytes: 40000 },
  };
  for (const continuation of [
    { ref: 'fixed', cursor: 1, totalBytes: 40000 },
    { ref: 'other', cursor: 2, totalBytes: 40000 },
    { ref: 'fixed', cursor: 2, totalBytes: 40001 },
    { ref: 'fixed', cursor: 2, totalBytes: 17000000 },
  ])
    await assert.rejects(completeResponse(page, async () => ({ ...page, continuation })));
  await assert.rejects(completeResponse({ ...page, continuation: null, truncated: false }, async () => page));
});

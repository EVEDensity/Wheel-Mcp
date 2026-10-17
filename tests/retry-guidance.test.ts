import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { runWithRetryGuidance } from '../src/mcp/retry-guidance.js';
import { invokeTool } from '../src/mcp/tool-context.js';
import { TimeoutError, CancelledError } from '../src/timeout.js';
import { WheelError } from '../src/error-schema.js';
import { DEFAULT_RESPONSE_BYTES, readResponsePage } from '../src/response-budget.js';

async function failure(tool: string, error: Error, args: Record<string, unknown> = {}) {
  return runWithRetryGuidance(tool, args, () =>
    invokeTool(async () => {
      throw error;
    }),
  );
}

test('side-effecting timeouts, cancellations and unknown results require inspection, not automatic retry', async () => {
  for (const error of [new TimeoutError(), new CancelledError(), new WheelError('UNKNOWN', 'unconfirmed')]) {
    for (const tool of ['write_project_file', 'launch_project', 'apply_editor_scene', 'submit_repair_candidate']) {
      const result = await failure(tool, error);
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent?.retryable, false);
      assert.match(String(result.structuredContent?.retryAdvice), /Do not automatically repeat/);
      assert.match(String(result.structuredContent?.retryAdvice), /does not prove rollback/);
      assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    }
  }
  assert.match(
    String((await failure('apply_editor_scene', new TimeoutError())).structuredContent?.retryAdvice),
    /get_editor_scene_operation/,
  );
  assert.match(
    String((await failure('submit_repair_candidate', new TimeoutError())).structuredContent?.retryAdvice),
    /get_client_repair_status/,
  );
});

test('read-only timeout retry semantics stay unchanged, including dispatcher read methods', async () => {
  for (const [tool, args] of [
    ['get_project_info', {}],
    ['get_editor_scene_operation', {}],
    ['call_runtime_bridge', { method: 'get_property' }],
    ['call_runtime_bridge', { method: 'query_collisions' }],
  ] as const) {
    const body = (await failure(tool, new TimeoutError(), args)).structuredContent;
    assert.equal(body?.retryable, true);
    assert.equal(body?.retryAdvice, undefined);
  }
  for (const method of ['set_property', 'capture_screenshot', 'wait_physics_frames', 'stop']) {
    const body = (await failure('call_runtime_bridge', new TimeoutError(), { method })).structuredContent;
    assert.equal(body?.retryable, false);
    assert.match(String(body?.retryAdvice), /get_runtime_operation_status/);
    assert.match(String(body?.retryAdvice), /For tracked writes.*otherwise inspect owned runs/);
  }
});

test('concurrent read and write contexts cannot leak retry policy; successful and ordinary failures are unchanged', async () => {
  const [write, read] = await Promise.all([
    runWithRetryGuidance('write_project_file', {}, () =>
      invokeTool(async () => {
        await delay(10);
        throw new TimeoutError();
      }),
    ),
    runWithRetryGuidance('get_project_info', {}, () =>
      invokeTool(async () => {
        await delay(20);
        throw new TimeoutError();
      }),
    ),
  ]);
  assert.equal(write.structuredContent?.retryable, false);
  assert.equal(read.structuredContent?.retryable, true);
  assert.equal(
    (
      await invokeTool(async () => {
        throw new TimeoutError();
      })
    ).structuredContent?.retryable,
    true,
  );
  const success = await runWithRetryGuidance('write_project_file', {}, () =>
    invokeTool(async () => ({ status: 'PASS', persisted: true })),
  );
  assert.equal(success.structuredContent?.retryable, undefined);
  assert.equal(
    (await failure('write_project_file', new WheelError('FORBIDDEN', 'denied'))).structuredContent?.retryAdvice,
    undefined,
  );
});

test('returned uncertain mutation failures retain recovery hints on every bounded response page', async () => {
  const response = await runWithRetryGuidance('write_project_file', {}, () =>
    invokeTool(async () => ({
      status: 'FAIL',
      code: 'TIMEOUT',
      retryable: true,
      details: '大'.repeat(DEFAULT_RESPONSE_BYTES),
    })),
  );
  assert.equal(response.isError, true);
  let page = response.structuredContent!;
  let count = 0;
  for (;;) {
    assert.equal(page.retryable, false);
    assert.match(String(page.retryAdvice), /Do not automatically repeat/);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= DEFAULT_RESPONSE_BYTES);
    count++;
    if (!page.continuation) break;
    const next = page.continuation as { ref: string; cursor: number };
    page = readResponsePage(next.ref, next.cursor);
  }
  assert.ok(count > 1);
});

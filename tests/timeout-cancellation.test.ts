import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError } from '../src/error-schema.js';
import { CancelledError, TimeoutError, createTimeoutContext } from '../src/timeout.js';

test('parent cancellation propagates as CANCELLED and can be disposed', () => {
  const parent = new AbortController();
  const context = createTimeoutContext(1000, parent.signal);
  parent.abort(new CancelledError('parent stopped'));
  assert.equal(context.cancelled, true);
  assert.equal(context.timedOut, false);
  assert.throws(() => context.throwIfCancelled(), /parent stopped|operation cancelled/);
  assert.equal(classifyError(context.signal.reason).code, 'CANCELLED');
  context.dispose();
});

test('deadline cancellation is classified as TIMEOUT', async () => {
  const context = createTimeoutContext(5);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(context.timedOut, true);
  assert.equal(context.cancelled, false);
  assert.throws(() => context.throwIfExpired(), TimeoutError);
  assert.equal(classifyError(context.signal.reason).code, 'TIMEOUT');
  context.dispose();
});


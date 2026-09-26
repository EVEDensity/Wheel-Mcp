import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, errorEnvelope, WheelError } from '../src/error-schema.js';

test('error envelope has stable timeout fields', () => {
  const result = classifyError(Object.assign(new Error('operation timed out'), { code: 'TIMEOUT' }));
  assert.deepEqual(result, {
    schema_version: '0.1',
    source: 'REAL',
    status: 'FAIL',
    code: 'TIMEOUT',
    message: 'operation timed out',
    retryable: true,
    timed_out: true,
    details: null,
  });
});

test('custom errors preserve non-retryable classification', () => {
  const result = errorEnvelope('INVALID_ARGUMENT', 'pid must be an integer');
  assert.equal(result.retryable, false);
  assert.equal(result.timed_out, false);
});

test('typed and operating-system failures retain stable classifications', () => {
  assert.equal(classifyError(new WheelError('ENGINE_UNAVAILABLE', 'Godot missing')).code, 'ENGINE_UNAVAILABLE');
  assert.equal(classifyError(Object.assign(new Error('missing path'), { code: 'ENOENT' })).code, 'NOT_FOUND');
  assert.equal(classifyError(Object.assign(new Error('access denied'), { code: 'EACCES' })).code, 'FORBIDDEN');
  assert.equal(
    classifyError(Object.assign(new Error('connection lost'), { code: 'ECONNRESET' })).code,
    'ENGINE_UNAVAILABLE',
  );
});

test('transaction cancellation and timeout retain the operation ID and recovery state in MCP responses', async () => {
  const { invokeTool } = await import('../src/mcp/tool-context.js');
  for (const code of ['CANCELLED', 'TIMEOUT'] as const) {
    const details = { operationId: 'fixture-tx', recoveryState: 'ROLLED_BACK' };
    const result = await invokeTool(async () => {
      throw new WheelError(code, 'transaction converged', details);
    });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent?.code, code);
    assert.deepEqual(result.structuredContent?.details, details);
  }
});

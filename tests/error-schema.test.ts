// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, errorEnvelope } from '../src/error-schema.js';

test('error envelope has stable timeout fields', () => {
  const result = classifyError(Object.assign(new Error('operation timed out'), { code: 'TIMEOUT' }));
  assert.deepEqual(result, { schema_version: '0.1', source: 'REAL', status: 'FAIL', code: 'TIMEOUT', message: 'operation timed out', retryable: true, timed_out: true, details: null });
});

test('custom errors preserve non-retryable classification', () => {
  const result = errorEnvelope('INVALID_ARGUMENT', 'pid must be an integer');
  assert.equal(result.retryable, false);
  assert.equal(result.timed_out, false);
});

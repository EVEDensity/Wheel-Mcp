import { CancelledError, TimeoutError } from './timeout.js';
export type ErrorCode = 'TIMEOUT' | 'CANCELLED' | 'FAILED' | 'INVALID_ARGUMENT' | 'INTERNAL_ERROR';
export interface ErrorEnvelope { schema_version: '0.1'; source: 'REAL'; status: 'FAIL'; code: ErrorCode; message: string; retryable: boolean; timed_out: boolean; cancelled: boolean; details: unknown; }
export interface ErrorOptions { retryable?: boolean; timed_out?: boolean; cancelled?: boolean; details?: unknown; }
export function errorEnvelope(code: ErrorCode, message: string, options: ErrorOptions = {}): ErrorEnvelope {
  return { schema_version: '0.1', source: 'REAL', status: 'FAIL', code, message, retryable: options.retryable ?? code === 'TIMEOUT', timed_out: options.timed_out ?? code === 'TIMEOUT', cancelled: options.cancelled ?? code === 'CANCELLED', details: options.details ?? null };
}
export function classifyError(error: unknown): ErrorEnvelope {
  const message = error instanceof Error ? error.message : String(error);
  const candidate = error as { code?: unknown; cancelled?: unknown } | null;
  if (error instanceof TimeoutError || candidate?.code === 'TIMEOUT' || /timed out|timeout/i.test(message)) return errorEnvelope('TIMEOUT', message, { retryable: true, timed_out: true });
  if (error instanceof CancelledError || candidate?.code === 'CANCELLED' || candidate?.cancelled === true) return errorEnvelope('CANCELLED', message, { cancelled: true });
  if (candidate?.code === 'INVALID_ARGUMENT') return errorEnvelope('INVALID_ARGUMENT', message);
  return errorEnvelope('FAILED', message, { details: error instanceof Error ? { name: error.name } : null });
}

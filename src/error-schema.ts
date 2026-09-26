import { CancelledError, TimeoutError } from './timeout.js';
export type ErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'UNSUPPORTED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'ENGINE_UNAVAILABLE'
  | 'PROTOCOL_MISMATCH'
  | 'VALIDATION_FAILED'
  | 'TIMEOUT'
  | 'UNKNOWN'
  | 'CANCELLED'
  | 'INTERNAL_ERROR'
  | 'FAILED';
export interface ErrorEnvelope {
  schema_version: '0.1';
  source: 'REAL';
  status: 'FAIL';
  code: ErrorCode;
  message: string;
  retryable: boolean;
  timed_out: boolean;
  cancelled?: boolean;
  details: unknown;
}
export interface ErrorOptions {
  retryable?: boolean;
  timed_out?: boolean;
  cancelled?: boolean;
  details?: unknown;
}
export class WheelError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'WheelError';
  }
}
export function errorEnvelope(code: ErrorCode, message: string, options: ErrorOptions = {}): ErrorEnvelope {
  const envelope: ErrorEnvelope = {
    schema_version: '0.1',
    source: 'REAL',
    status: 'FAIL',
    code,
    message,
    retryable: options.retryable ?? code === 'TIMEOUT',
    timed_out: options.timed_out ?? code === 'TIMEOUT',
    details: options.details ?? null,
  };
  if (code === 'CANCELLED' || options.cancelled === true) envelope.cancelled = true;
  return envelope;
}
export function classifyError(error: unknown): ErrorEnvelope {
  const message = error instanceof Error ? error.message : String(error);
  const candidate = error as { code?: unknown; cancelled?: unknown; details?: unknown } | null;
  if (error instanceof TimeoutError || candidate?.code === 'TIMEOUT')
    return errorEnvelope('TIMEOUT', message, { retryable: true, timed_out: true, details: candidate?.details });
  if (error instanceof CancelledError || candidate?.code === 'CANCELLED' || candidate?.cancelled === true)
    return errorEnvelope('CANCELLED', message, { cancelled: true, details: candidate?.details });
  if (typeof candidate?.code === 'string' && stableErrorCodes.has(candidate.code as ErrorCode))
    return errorEnvelope(candidate.code as ErrorCode, message, { details: candidate.details });
  if (candidate?.code === 'ENOENT') return errorEnvelope('NOT_FOUND', message);
  if (candidate?.code === 'EACCES' || candidate?.code === 'EPERM') return errorEnvelope('FORBIDDEN', message);
  if (candidate?.code === 'ECONNREFUSED' || candidate?.code === 'ECONNRESET' || candidate?.code === 'EPIPE')
    return errorEnvelope('ENGINE_UNAVAILABLE', message, { retryable: true });
  return errorEnvelope('FAILED', message, { details: error instanceof Error ? { name: error.name } : null });
}

const stableErrorCodes = new Set<ErrorCode>([
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'UNSUPPORTED',
  'FORBIDDEN',
  'CONFLICT',
  'ENGINE_UNAVAILABLE',
  'PROTOCOL_MISMATCH',
  'VALIDATION_FAILED',
  'TIMEOUT',
  'UNKNOWN',
  'CANCELLED',
  'INTERNAL_ERROR',
  'FAILED',
]);

export function isStableErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && stableErrorCodes.has(value as ErrorCode);
}

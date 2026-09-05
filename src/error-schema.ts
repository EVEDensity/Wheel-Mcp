export function errorEnvelope(code: string, message: string, options: any = {}): any {
  return {
    schema_version: '0.1',
    source: 'REAL',
    status: 'FAIL',
    code,
    message,
    retryable: options.retryable === true,
    timed_out: options.timed_out === true,
    details: options.details ?? null,
  };
}

export function classifyError(error: any) {
  const message = error instanceof Error ? error.message : String(error);
  const timedOut = error?.code === 'TIMEOUT' || /timed out|timeout/i.test(message);
  return errorEnvelope(error?.code || 'INTERNAL_ERROR', message, { retryable: timedOut, timed_out: timedOut });
}

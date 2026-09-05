export function errorEnvelope(code, message, options = {}) {
  return {
    schema_version: '0.1', source: 'REAL', status: 'FAIL', code,
    message, retryable: options.retryable === true,
    timed_out: options.timed_out === true,
    details: options.details ?? null
  };
}

export function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const timedOut = error?.code === 'TIMEOUT' || /timed out|timeout/i.test(message);
  return errorEnvelope(error?.code || 'INTERNAL_ERROR', message, { retryable: timedOut, timed_out: timedOut });
}

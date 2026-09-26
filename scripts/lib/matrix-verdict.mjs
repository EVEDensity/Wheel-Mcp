import { isStableErrorCode } from '../../build/src/error-schema.js';

function json(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function mcpValue(value) {
  return json(value?.response?.result?.content?.find((item) => item.type === 'text')?.text);
}

function failed(value) {
  if (!value || Object.keys(value).length === 0) return true;
  for (const entry of [value, value.response]) {
    if (!entry || typeof entry !== 'object') continue;
    if (
      ['FAIL', 'FAILED', 'UNKNOWN', 'NOT_RUN', 'SKIP'].includes(entry.status) ||
      entry.timed_out === true ||
      (entry.cancelled === true && !(entry.stopped === true && ['STOPPED', 'CANCELLED'].includes(entry.lifecycle))) ||
      (Object.hasOwn(entry, 'source') && entry.source !== 'REAL') ||
      isStableErrorCode(entry.code) ||
      Object.hasOwn(entry, 'error')
    )
      return true;
  }
  if (value.process && (value.process.timed_out || (value.process.exit_code != null && value.process.exit_code !== 0)))
    return true;
  return false;
}

export function cliSucceeded(result) {
  return result?.code === 0 && !result.timed_out && !result.signal && !failed(json(result.stdout));
}

export function mcpSucceeded(result) {
  return (
    Boolean(result?.response?.result) &&
    !result.response.error &&
    result.response.result.isError !== true &&
    !failed(mcpValue(result))
  );
}

export function negativeCase(name, cli, mcp, expectedCode) {
  const a = json(cli?.stderr)?.code;
  const b = mcpValue(mcp)?.code;
  return {
    name,
    cli_code: a ?? null,
    mcp_code: b ?? null,
    expected_code: expectedCode,
    verdict:
      Number.isInteger(cli?.code) &&
      cli.code !== 0 &&
      !cli.timed_out &&
      !cli.signal &&
      mcp?.response?.result?.isError === true &&
      !mcp.response.error &&
      isStableErrorCode(expectedCode) &&
      a === expectedCode &&
      b === expectedCode
        ? 'PASS'
        : 'FAIL',
  };
}

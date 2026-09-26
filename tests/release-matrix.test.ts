import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function assess(cases: unknown[]) {
  const script = `import {cliSucceeded,mcpSucceeded,negativeCase} from './scripts/lib/matrix-verdict.mjs';
const cases=JSON.parse(process.argv[1]);process.stdout.write(JSON.stringify(cases.map(c =>
c.kind==='negative' ? negativeCase('negative',c.cli,c.mcp,c.expected).verdict :
c.kind==='cli' ? cliSucceeded(c.cli) : mcpSucceeded(c.mcp))));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(cases)], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const mcp = (value: unknown, isError = false) => ({
  response: { result: { isError, content: [{ type: 'text', text: JSON.stringify(value) }] } },
});
const cli = (value: unknown, code = 0) => ({ code, stdout: JSON.stringify(value), stderr: '' });

test('release matrix rejects SDK isError, every stable error code and nested failures', () => {
  const codes = [
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
  ];
  const cases = codes.flatMap((code) => [
    { kind: 'mcp', mcp: mcp({ code }) },
    { kind: 'cli', cli: cli({ code }) },
    { kind: 'mcp', mcp: mcp({ response: { code } }) },
  ]);
  cases.push({ kind: 'mcp', mcp: mcp({ status: 'PASS' }, true) });
  assert.deepEqual(
    assess(cases),
    cases.map(() => false),
  );
});

test('release matrix requires actual parseable success and non-interrupted transport', () => {
  const cases = [
    { kind: 'mcp', mcp: mcp({ status: 'PASS', value: 1 }) },
    { kind: 'cli', cli: cli({ status: 'PASS', value: 1 }) },
    { kind: 'mcp', mcp: { response: { error: { code: -32603 }, result: mcp({}).response.result } } },
    { kind: 'mcp', mcp: { response: { result: { content: [{ type: 'text', text: 'invalid' }] } } } },
    { kind: 'mcp', mcp: mcp(null) },
    { kind: 'cli', cli: { code: 0, stdout: '' } },
    { kind: 'cli', cli: cli({}, 1) },
    { kind: 'cli', cli: { ...cli({}), timed_out: true } },
    { kind: 'cli', cli: { ...cli({}), signal: 'SIGTERM' } },
    { kind: 'mcp', mcp: mcp({ response: { error: 'native failure' } }) },
    { kind: 'mcp', mcp: mcp({}) },
    { kind: 'cli', cli: cli({}) },
    { kind: 'mcp', mcp: mcp({ status: 'PASS', source: 'SIMULATED' }) },
    { kind: 'cli', cli: cli({ status: 'PASS', process: { exit_code: 7 } }) },
    { kind: 'cli', cli: cli({ stopped: true, lifecycle: 'STOPPED', cancelled: true }) },
    { kind: 'mcp', mcp: mcp({ stopped: true, lifecycle: 'STOPPED', cancelled: true }) },
    { kind: 'mcp', mcp: mcp({ status: 'PASS', cancelled: true }) },
  ];
  assert.deepEqual(assess(cases), [true, true, ...Array(12).fill(false), true, true, false]);
});

test('release matrix negative PASS needs exact expected errors, not null equality or transport failure', () => {
  const negative = {
    kind: 'negative',
    expected: 'NOT_FOUND',
    cli: { code: 1, stdout: '', stderr: JSON.stringify({ status: 'FAIL', code: 'NOT_FOUND' }) },
    mcp: mcp({ status: 'FAIL', code: 'NOT_FOUND' }, true),
  };
  const cases = [
    negative,
    { ...negative, cli: cli({}), mcp: mcp({}) },
    { ...negative, mcp: mcp({ code: 'FORBIDDEN' }, true) },
    { ...negative, mcp: mcp({ code: 'NOT_FOUND' }) },
    { ...negative, cli: { ...negative.cli, code: null, signal: 'SIGTERM' } },
    { ...negative, cli: { ...negative.cli, timed_out: true } },
    { ...negative, expected: undefined },
  ];
  assert.deepEqual(assess(cases), ['PASS', 'FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL']);
});

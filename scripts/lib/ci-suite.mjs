import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarizeTestEvents } from './test-report.mjs';

/** Bounded diagnostics only, not a source-frozen release/soak qualification. */
export function runCiSuite({ files, scope, timeoutMs, godotPath = '' }) {
  const parent = realpathSync(os.tmpdir());
  const scratch = mkdtempSync(path.join(parent, 'wheel-ci-'));
  const output = path.resolve('runs/ci', scope);
  const started = Date.now();
  let passed = false;
  let stdout = '',
    stderr = '';
  let processResult = null;
  mkdirSync(output, { recursive: true });
  try {
    const env = {
      ...process.env,
      GODOT_PATH: godotPath,
      GODOT_HARNESS_RUN_REGISTRY_PATH: path.join(scratch, 'run-registry.json'),
      TEMP: scratch,
      TMP: scratch,
      TMPDIR: scratch,
    };
    // Node's test-worker context is not an input to a fresh CLI test suite.
    // Inheriting it can suppress the nested runner's reporter entirely.
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      ['--test', '--test-concurrency=2', '--test-reporter=./scripts/lib/json-test-reporter.mjs', ...files],
      {
        cwd: process.cwd(),
        windowsHide: true,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        env,
      },
    );
    stdout = result.stdout ?? '';
    stderr = result.stderr ?? '';
    processResult = { exitCode: result.status, signal: result.signal, error: result.error?.message };
    const summary = summarizeTestEvents(stdout);
    if (result.error || result.status !== 0 || summary.failed || summary.skipped || summary.cancelled || summary.todo)
      throw new Error(
        `Suite failed: ${JSON.stringify({ exitCode: result.status, error: result.error?.message, counts: { tests: summary.tests, passed: summary.passed, failed: summary.failed, skipped: summary.skipped, cancelled: summary.cancelled, todo: summary.todo } })}`,
      );
    try {
      const records = JSON.parse(readFileSync(path.join(scratch, 'run-registry.json'), 'utf8'));
      if (
        !Array.isArray(records) ||
        records.some((record) => ['STARTING', 'RUNNING', 'STOPPING', 'ORPHANED'].includes(record.state))
      )
        throw new Error('Test registry has unresolved actors; scratch retained');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const exact = realpathSync(scratch);
    if (
      path.dirname(exact) !== parent ||
      !/^wheel-ci-[A-Za-z0-9]+$/.test(path.basename(exact)) ||
      lstatSync(scratch).isSymbolicLink()
    )
      throw new Error('CI scratch escaped its owned root');
    // Windows can briefly retain handles after the last engine worker exits.
    // Retry only this already-validated owned root; persistent errors still fail.
    rmSync(exact, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
    passed = true;
    writeFileSync(
      path.join(output, 'summary.json'),
      JSON.stringify(
        {
          scope,
          runId: process.env.WHEEL_RELEASE_RUN_ID ?? null,
          status: 'PASS',
          ...summary,
          durationMs: Date.now() - started,
          scratchCleanup: 'PASS',
          qualification: 'NOT_QUALIFIED',
        },
        null,
        2,
      ),
    );
    console.log(
      `${scope}: ${summary.passed}/${summary.tests} PASS, 0 skipped; ${Date.now() - started}ms; owned scratch cleaned. Not release qualification.`,
    );
  } catch (error) {
    const lines = stdout.trim().split(/\r?\n/);
    const failures = lines.filter((line) => line.includes('"type":"test:fail"'));
    const finalSummary = lines.filter((line) => line.includes('"type":"test:summary"')).at(-1);
    writeFileSync(
      path.join(output, 'failure-details.txt'),
      [...failures, ...(finalSummary ? [finalSummary] : []), stderr.slice(-4000)].join('\n').slice(-16000),
    );
    process.stdout.write([...failures, ...(finalSummary ? [finalSummary] : [])].join('\n') + '\n');
    process.stderr.write(stderr);
    writeFileSync(path.join(output, 'stdout.jsonl'), stdout);
    writeFileSync(path.join(output, 'stderr.log'), stderr);
    const failure = JSON.stringify(
      {
        scope,
        runId: process.env.WHEEL_RELEASE_RUN_ID ?? null,
        status: 'FAIL',
        processResult,
        error: error.message,
        durationMs: Date.now() - started,
        scratch,
        scratchCleanup: passed ? 'PASS' : 'RETAINED',
        qualification: 'NOT_QUALIFIED',
      },
      null,
      2,
    );
    writeFileSync(path.join(output, 'summary.json'), failure);
    // A later PASS replaces only the current summary, not the last failure.
    writeFileSync(path.join(output, 'failure-summary.json'), failure);
    console.error(error.message);
    process.exitCode = 1;
  }
}

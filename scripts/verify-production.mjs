import { spawnSync, execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { assessTestRun, sha256, sourceIdentity, validateRunManifest } from './lib/production-manifest.mjs';
import { summarizeTestEvents } from './lib/test-report.mjs';
import { validateBaselineSummary } from '../tests/production-baseline/catalog.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
if (args.includes('--check-report')) {
  try {
    console.log(JSON.stringify(summarizeTestEvents(await readFile(path.resolve(option('--check-report')), 'utf8'))));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else if (args.includes('--check-manifest')) {
  try {
    const errors = validateRunManifest(JSON.parse(await readFile(path.resolve(option('--check-manifest')), 'utf8')));
    console.log(JSON.stringify({ status: errors.length ? 'FAIL' : 'PASS', errors }));
    if (errors.length) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else if (args.includes('--assess-report')) {
  try {
    const assessment = assessTestRun(0, await readFile(path.resolve(option('--assess-report')), 'utf8'));
    console.log(JSON.stringify(assessment));
    if (assessment.status !== 'PASS') process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else {
  const gateId = option('--gate') ?? (args.length === 1 && args[0] === '--baseline' ? 'G0' : null);
  const baselineOnly = args.length === 1 && args[0] === '--baseline';
  if (!/^G[0-6]$/.test(gateId ?? '') || (!baselineOnly && (args.length !== 2 || args[0] !== '--gate'))) {
    console.error(
      'usage: verify-production.mjs --baseline | --gate G0..G6 | --check-report file | --check-manifest file',
    );
    process.exit(2);
  }
  if (!['G0', 'G1', 'G2', 'G3'].includes(gateId)) {
    console.error(`${gateId} suite is NOT_RUN: owner tasks and Gate-specific tests are not implemented yet`);
    process.exit(2);
  }
  await runBaseline({ gateId, baselineOnly });
}

async function runBaseline({ gateId, baselineOnly }) {
  const started = Date.now();
  const state = JSON.parse(await readFile(path.join(root, 'docs/production-roadmap/tasks.json'), 'utf8'));
  const gate = state.gates.find((item) => item.id === gateId);
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const runDir = path.join(root, `runs/production-roadmap/${gateId === 'G0' ? 'T00' : gateId}`, runId);
  await mkdir(runDir, { recursive: true });
  // Qualification processes share a fresh TEST-ONLY registry. Never let a
  // developer's interrupted local runs or PID reuse contaminate test fixtures,
  // nor let test reclamation operate on the user's actual run registry.
  process.env.GODOT_HARNESS_RUN_REGISTRY_PATH = path.join(runDir, 'test-run-registry.json');
  const source = await sourceIdentity(root);
  const godot = process.env.GODOT_PATH ?? '';
  let godotVersion = 'NOT_RUN';
  try {
    if ((await stat(godot)).isFile())
      godotVersion = execFileSync(godot, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
  } catch {
    /* prerequisite remains NOT_RUN */
  }
  const environment = {
    node: process.version,
    npm: process.env.npm_config_user_agent?.match(/npm\/([\d.]+)/)?.[1] ?? 'NOT_RUN',
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    godot: godotVersion,
    renderer: 'real headless EditorPlugin + rendered runtime fixtures; human desktop editor UI NOT_RUN',
    project: process.env.REAL_GODOT_PROJECT ?? 'NOT_RUN',
  };
  const commands = [];
  let stdoutLog = '',
    stderrLog = '';
  function execute(name, program, argv, required = true, testReport = false, envOverride = {}) {
    const start = Date.now();
    // Test-only scratch lives in a unique root, never in the developer's shared Temp.
    const testTempRoot = testReport ? mkdtempSync(path.join(os.tmpdir(), 'wheel-gate-')) : undefined;
    const useNpmCli = process.platform === 'win32' && program === 'npm.cmd' && process.env.npm_execpath;
    const executable = useNpmCli ? process.execPath : program;
    const executableArgs = useNpmCli ? [process.env.npm_execpath, ...argv] : argv;
    const result = spawnSync(executable, executableArgs, {
      cwd: root,
      env: {
        ...process.env,
        ...envOverride,
        ...(testTempRoot ? { TEMP: testTempRoot, TMP: testTempRoot } : {}),
      },
      encoding: 'utf8',
      timeout: testReport && name === 'full-tests' ? 1800000 : 900000,
      maxBuffer: 16 * 1024 * 1024,
      shell: process.platform === 'win32' && program === 'npm.cmd' && !useNpmCli,
    });
    const stdout = result.stdout ?? '',
      stderr = result.stderr ?? result.error?.message ?? '';
    stdoutLog += `\n[${name}]\n${stdout}`;
    stderrLog += `\n[${name}]\n${stderr}`;
    const assessed = testReport ? assessTestRun(result.status, stdout) : null;
    const status = assessed?.status ?? (result.status === 0 ? 'PASS' : 'FAIL');
    const record = {
      name,
      argv: [program, ...argv],
      required,
      status,
      exitCode: result.status,
      signal: result.signal,
      durationMs: Date.now() - start,
      outputHash: sha256(stdout + stderr),
      tests: assessed?.summary
        ? {
            tests: assessed.summary.tests,
            passed: assessed.summary.passed,
            failed: assessed.summary.failed,
            skipped: assessed.summary.skipped,
            cancelled: assessed.summary.cancelled,
            todo: assessed.summary.todo,
          }
        : undefined,
      reportError: assessed?.reportError,
    };
    if (testTempRoot) {
      try {
        const tempParent = path.resolve(os.tmpdir());
        const exactRoot = path.resolve(testTempRoot);
        if (
          path.dirname(exactRoot) !== tempParent ||
          !/^wheel-gate-[A-Za-z0-9]+$/.test(path.basename(exactRoot)) ||
          lstatSync(exactRoot).isSymbolicLink()
        )
          throw new Error('Test scratch cleanup target escaped its owned Temp root');
        rmSync(exactRoot, { recursive: true, force: false, maxRetries: 10, retryDelay: 250 });
        record.tempCleanup = 'PASS';
      } catch (error) {
        record.status = 'FAIL';
        record.tempCleanup = 'FAIL';
        record.tempRoot = testTempRoot;
        record.tempCleanupError = error.message;
      }
    }
    commands.push(record);
    console.log(`${name}: ${record.status}${record.tests ? ' ' + JSON.stringify(record.tests) : ''}`);
    return { ...record, stdout };
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const build = execute('build', npm, ['run', 'build']);
  if (build.status === 'PASS') {
    execute('format:check', npm, ['run', 'format:check']);
    execute('lint', npm, ['run', 'lint']);
    const files = (await readdir(path.join(root, 'build/tests')))
      .filter((name) => name.endsWith('.test.js'))
      .map((name) => `build/tests/${name}`);
    let fullTestRun;
    if (files.length)
      fullTestRun = execute(
        'full-tests',
        process.execPath,
        ['--test', '--test-concurrency=2', '--test-reporter=./scripts/lib/json-test-reporter.mjs', ...files],
        true,
        true,
      );
    else
      commands.push({
        name: 'full-tests',
        argv: [],
        required: true,
        status: 'NOT_RUN',
        exitCode: null,
        signal: null,
        durationMs: 0,
        outputHash: sha256('missing test files'),
      });
    if (godotVersion !== 'NOT_RUN') {
      const smokeFiles = [
        'editor-fixture-isolation',
        'process-evidence',
        'validated-project-write',
        'editor-scene-save',
        'editor-scene-rpc',
        'editor-instance-rpc',
        'inherited-scene-roundtrip',
        'scene-move',
        'ui-authoring-e2e',
        'runtime-3d-e2e',
        'physics-authoring-e2e',
        'animation-authoring-e2e',
        'shader-authoring-e2e',
        'content-workflows-e2e',
        'script-semantic-service',
        'resource-roundtrip',
        'resource-sharing',
        'editor-bridge-e2e',
        'editor-scene-operations',
        'readme-smoke',
        'runtime-behavior-e2e',
        'runtime-error-contract',
        'runtime-property-roundtrip',
        'persistent-events-e2e',
        'bridge-handshake',
        'fresh-validation',
        'session-isolation',
        'reload-scene',
        'shutdown',
      ].map((name) => `build/tests/${name}.test.js`);
      const smokeRun = execute(
        'godot-smoke',
        process.execPath,
        ['--test', '--test-concurrency=2', '--test-reporter=./scripts/lib/json-test-reporter.mjs', ...smokeFiles],
        true,
        true,
      );
      if (gateId === 'G3') {
        const required = [
          'official MCP three-level inherited override',
          'official MCP native settings/inventory UI',
          'T18 real native physics authoring',
          'T19 real editor creates bounded animation clips',
          'T20 native shader resources are authored',
          'T21 official MCP PNG import',
          'T21 live editor scans committed PNG',
          'T21 2D UI/combat slice',
          'T21 3D interaction slice',
        ];
        const checks = [];
        for (const run of [fullTestRun, smokeRun]) {
          let passed = [];
          try {
            passed = run.stdout
              .split('\n')
              .filter(Boolean)
              .map((line) => JSON.parse(line))
              .filter((event) => event.type === 'test:pass' && !event.data?.skip && !event.data?.todo)
              .map((event) => event.data?.name);
          } catch {
            /* malformed output remains a required failure */
          }
          for (const name of required)
            checks.push({
              run: run === fullTestRun ? 'full-tests' : 'godot-smoke',
              name,
              status: run.status === 'PASS' && passed.some((item) => item?.startsWith(name)) ? 'PASS' : 'FAIL',
            });
        }
        const assessment = {
          sourceHash: source.sourceHash,
          checks,
          status: checks.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL',
        };
        await writeFile(path.join(runDir, 'G3-assessment.json'), JSON.stringify(assessment, null, 2));
        commands.push({
          name: 'G3-content-workflow-assessment',
          argv: ['assess-frozen-required-cases'],
          required: true,
          status: assessment.status,
          exitCode: assessment.status === 'PASS' ? 0 : 1,
          signal: null,
          durationMs: 0,
          outputHash: sha256(JSON.stringify(assessment)),
        });
        console.log(`G3-content-workflow-assessment: ${assessment.status}`);
      }
      if (gateId === 'G1') {
        execute(
          'G1-authorization-and-lifecycle',
          process.execPath,
          [
            '--test',
            '--test-reporter=./scripts/lib/json-test-reporter.mjs',
            ...[
              'method-authorization',
              'streamable-http-security',
              'session-isolation',
              'runtime-error-contract',
              'persistent-events-e2e',
            ].map((name) => `build/tests/${name}.test.js`),
          ],
          true,
          true,
        );
      }
      if (gateId === 'G2') {
        let nativeSummary,
          nativePath,
          issues = [];
        try {
          const directory = path.join(root, 'runs/production-roadmap/T15');
          for (const name of (await readdir(directory)).sort().reverse()) {
            const candidate = path.join(directory, name, 'summary.json');
            const value = await readFile(candidate, 'utf8')
              .then(JSON.parse)
              .catch(() => null);
            if (value?.sourceHash === source.sourceHash && Date.parse(value.startedAt) >= started) {
              nativeSummary = value;
              nativePath = candidate;
              break;
            }
          }
          if (
            fullTestRun?.status !== 'PASS' ||
            !fullTestRun.stdout.split('\n').some((line) => {
              try {
                const e = JSON.parse(line);
                return e.type === 'test:pass' && e.data?.name?.startsWith('20 consecutive isolated official MCP');
              } catch {
                return false;
              }
            })
          )
            issues.push('required real 20-cycle test did not PASS in this run');
          if (
            nativeSummary?.status !== 'PASS' ||
            nativeSummary.rounds?.length !== 20 ||
            new Set(nativeSummary.rounds?.map((r) => r.index)).size !== 20
          )
            issues.push('fresh same-source native 20-cycle summary missing/invalid');
          else
            for (const item of nativeSummary.rounds) {
              if (item.status !== 'PASS' || item.sourceHash !== source.sourceHash)
                issues.push(`round ${item.index}: source/status mismatch`);
              for (const [target, expected] of [
                [path.join(item.root, 'main.tscn'), item.sceneSha256],
                [path.join(item.root, `.harness/render-${item.index}/scene.png`), item.pngSha256],
              ])
                if (sha256(await readFile(target)) !== expected)
                  issues.push(`round ${item.index}: artifact hash mismatch`);
            }
        } catch (error) {
          issues.push(error.message);
        }
        const relative = nativePath ? path.relative(root, nativePath) : null;
        await writeFile(
          path.join(runDir, 'T15-assessment.json'),
          JSON.stringify(
            {
              status: issues.length ? 'FAIL' : 'PASS',
              sourceHash: source.sourceHash,
              summary: relative,
              summarySha256: nativeSummary ? sha256(await readFile(nativePath)) : null,
              issues,
            },
            null,
            2,
          ),
        );
        commands.push({
          name: 'G2-native-authoring-20-cycles',
          argv: ['assess-current-full-tests', relative ?? 'NOT_RUN'],
          required: true,
          status: issues.length ? 'FAIL' : 'PASS',
          exitCode: issues.length ? 1 : 0,
          signal: null,
          durationMs: 0,
          outputHash: sha256(JSON.stringify({ relative, issues })),
          issues,
        });
        console.log(`G2-native-authoring-20-cycles: ${commands.at(-1).status}`);
      }
    } else
      commands.push({
        name: 'godot-smoke',
        argv: [],
        required: true,
        status: 'NOT_RUN',
        exitCode: null,
        signal: null,
        durationMs: 0,
        outputHash: sha256('missing Godot'),
      });
    if (!baselineOnly && gate.tasks.every((id) => state.tasks.find((task) => task.id === id)?.status === 'done')) {
      const reportPath = path.join(runDir, 'T01-summary.json');
      if (godotVersion !== 'NOT_RUN') {
        const defectRun = execute(
          'defect-baseline',
          process.execPath,
          ['tests/production-baseline/run.mjs'],
          true,
          false,
          { WHEEL_BASELINE_SUMMARY_PATH: reportPath },
        );
        let issues = [];
        let defectSummary;
        try {
          defectSummary = JSON.parse(await readFile(reportPath, 'utf8'));
          issues = validateBaselineSummary(defectSummary);
          if (gateId === 'G1') {
            for (const id of ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D10']) {
              if (defectSummary.cases?.find((item) => item.id === id)?.status !== 'PASS')
                issues.push(`${id} must be PASS for G1`);
            }
          }
          if (gateId === 'G2')
            for (const id of ['D07', 'D08'])
              if (defectSummary.cases?.find((item) => item.id === id)?.status !== 'PASS')
                issues.push(`${id} must be PASS for G2`);
          if (defectSummary.sourceHash !== source.sourceHash) issues.push('candidate source hash mismatch');
          if (defectSummary.errors?.length) issues.push(...defectSummary.errors);
        } catch (error) {
          issues.push(`missing or invalid defect report: ${error.message}`);
        }
        commands.push({
          name: 'defect-baseline-assessment',
          argv: ['validateBaselineSummary', 'T01-summary.json'],
          required: true,
          status: defectRun.status === 'PASS' && issues.length === 0 ? 'PASS' : 'FAIL',
          exitCode: defectRun.status === 'PASS' && issues.length === 0 ? 0 : 1,
          signal: null,
          durationMs: 0,
          outputHash: sha256(JSON.stringify({ issues, sourceHash: defectSummary?.sourceHash })),
          issues,
        });
        console.log(`defect-baseline-assessment: ${commands.at(-1).status}`);
      } else
        commands.push({
          name: 'defect-baseline',
          argv: [],
          required: true,
          status: 'NOT_RUN',
          exitCode: null,
          signal: null,
          durationMs: 0,
          outputHash: sha256('missing Godot'),
        });
    }
  }
  let tools = [];
  if (build.status === 'PASS') {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, 'build/src/mcp-server-sdk.js')],
      stderr: 'pipe',
      env: { GODOT_HARNESS_RUN_REGISTRY_PATH: process.env.GODOT_HARNESS_RUN_REGISTRY_PATH },
    });
    const client = new Client({ name: 'production-baseline', version: '1.0.0' });
    try {
      await client.connect(transport);
      tools = (await client.listTools()).tools.map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema }));
    } catch (error) {
      stderrLog += `\n[tools/list]\n${error.message}`;
    } finally {
      await client.close().catch(() => {});
    }
  }
  await writeFile(path.join(runDir, 'tools.json'), JSON.stringify({ tools }, null, 2));
  let contracts = [];
  if (build.status === 'PASS') contracts = (await import('../build/src/cli-mcp-matrix.js')).cliMcpContracts;
  const exposedTools = new Set(tools.map((tool) => tool.name));
  const mappingIssues = contracts
    .filter((contract) => !exposedTools.has(contract.mcpTool))
    .map((contract) => `${contract.cliCommand} -> ${contract.mcpTool}`);
  await writeFile(path.join(runDir, 'cli-mcp-contracts.json'), JSON.stringify({ contracts }, null, 2));
  await writeFile(path.join(runDir, 'stdout.log'), stdoutLog);
  await writeFile(path.join(runDir, 'stderr.log'), stderrLog);
  await writeFile(
    path.join(runDir, 'requests.jsonl'),
    JSON.stringify({
      operation: 'tools/list',
      resultCount: tools.length,
      source: build.status === 'PASS' ? 'REAL' : 'NOT_RUN',
    }) + '\n',
  );
  const complete =
    (await sourceIdentity(root)).sourceHash === source.sourceHash &&
    commands.every((command) => !command.required || command.status === 'PASS') &&
    tools.length > 0 &&
    contracts.length > 0 &&
    mappingIssues.length === 0;
  const gateTasksDone = gate.tasks.every((id) => state.tasks.find((task) => task.id === id)?.status === 'done');
  const predecessorsPassed = gate.predecessorGates.every(
    (id) => state.gates.find((item) => item.id === id)?.status === 'PASS',
  );
  const status =
    ['G2', 'G3'].includes(gateId) && godotVersion === 'NOT_RUN'
      ? 'NOT_RUN'
      : complete && (baselineOnly || (gateTasksDone && predecessorsPassed))
        ? 'PASS'
        : complete
          ? 'NOT_RUN'
          : 'FAIL';
  const results = {
    schemaVersion: 1,
    gateId,
    baselineOnly,
    status,
    commands,
    toolsCount: tools.length,
    cliContractsCount: contracts.length,
    mappingIssues,
    pendingTasks: gate.tasks.filter((id) => state.tasks.find((task) => task.id === id)?.status !== 'done'),
    predecessorsPassed,
  };
  await writeFile(path.join(runDir, 'results.json'), JSON.stringify(results, null, 2));
  const evidence = [];
  for (const name of [
    'results.json',
    'tools.json',
    'cli-mcp-contracts.json',
    'requests.jsonl',
    'stdout.log',
    'stderr.log',
    ...(!baselineOnly && (await stat(path.join(runDir, 'T01-summary.json')).catch(() => null))
      ? ['T01-summary.json']
      : []),
    ...((await stat(path.join(runDir, 'T15-assessment.json')).catch(() => null)) ? ['T15-assessment.json'] : []),
    ...((await stat(path.join(runDir, 'G3-assessment.json')).catch(() => null)) ? ['G3-assessment.json'] : []),
  ])
    evidence.push({ path: name, sha256: sha256(await readFile(path.join(runDir, name))) });
  const finished = Date.now();
  const manifest = {
    schemaVersion: 1,
    caseId: gateId === 'G0' ? 'T00-baseline' : `${gateId}-gate`,
    taskId: gateId === 'G0' ? 'T00' : gateId === 'G1' ? 'T08' : gateId === 'G2' ? 'T15' : 'T21',
    gateId,
    source,
    environment,
    commands,
    inputSnapshotHash: sha256(JSON.stringify({ gateId, sourceHash: source.sourceHash, project: environment.project })),
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    testDouble: 'MIXED',
    evidence,
  };
  const errors = validateRunManifest(manifest);
  await writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(
    JSON.stringify(
      {
        status: errors.length ? 'FAIL' : status,
        runDir: path.relative(root, runDir),
        sourceHash: source.sourceHash,
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length || status !== 'PASS') process.exitCode = 1;
}

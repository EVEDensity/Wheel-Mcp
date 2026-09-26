import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sourceIdentity } from './lib/production-manifest.mjs';
import { cliSucceeded, mcpSucceeded, negativeCase } from './lib/matrix-verdict.mjs';

const repo = process.cwd();
const candidateSource = await sourceIdentity(repo);
const projectPath = path.resolve(process.env.REAL_GODOT_PROJECT ?? 'tests/fixtures/runtime-behavior');
const godotPath = process.env.GODOT_PATH ?? '';
const bridgePath = path.resolve('godot-plugin/runtime_bridge.gd');
const root = path.resolve('runs/matrix');
const rawRoot = path.join(root, 'raw');
const node = process.execPath;
// Authorize only this fixture/evidence set in the diagnostic subprocess. Do not
// weaken the product's configured roots or persist client configuration.
const env = {
  ...process.env,
  GODOT_PATH: godotPath,
  GODOT_HARNESS_MAX_CONCURRENT_RUNS: '32',
  GODOT_HARNESS_RUN_REGISTRY_PATH: path.join(root, 'run-registry.json'),
  MCP_STDIO_SCOPES: 'read,run,write',
  MCP_STDIO_PROJECT_ROOTS: [projectPath, root].join(';'),
  MCP_STDIO_EVIDENCE_ROOTS: root,
  MCP_STDIO_APPROVED_GODOT_PATHS: godotPath,
  MCP_STDIO_APPROVED_BRIDGE_PATHS: bridgePath,
};
await mkdir(rawRoot, { recursive: true });
let transcriptIndex = 0;

const contracts = [
  ['doctor', 'get_godot_version'],
  ['list-projects', 'list_projects'],
  ['project-info', 'get_project_info'],
  ['scene-tree', 'get_scene_tree'],
  ['launch', 'launch_project'],
  ['logs', 'get_debug_output'],
  ['stop', 'stop_project'],
  ['cancel', 'cancel_project'],
  ['runtime-scene-tree', 'get_runtime_scene_tree'],
  ['runtime-property', 'get_runtime_property'],
  ['set-runtime-property', 'set_runtime_property'],
  ['inject-input', 'inject_runtime_input'],
  ['screenshot', 'capture_runtime_screenshot'],
  ['context-pack', 'get_context_pack'],
  ['scenario', 'execute_scenario'],
].map(([cli_command, mcp_tool]) => ({
  cli_command,
  mcp_tool,
  parameter_mapping: 'CLI flags map to the MCP tool schema; both call the shared operation layer',
  result_mapping: 'normalized JSON result and error envelope',
  evidence_profiles: ['PROCESS_EVIDENCE', 'BRIDGE_EVIDENCE'],
  required_checks: ['normal', 'timeout', 'cancel', 'error', 'repeat'],
}));

if (!existsSync(projectPath) || !existsSync(godotPath)) {
  await writeJson('tool-contract-matrix.json', {
    schema_version: '0.1',
    status: 'BLOCKED',
    reason: 'REAL_GODOT_PROJECT or GODOT_PATH is unavailable',
    contracts,
  });
  await writeJson('tool-runtime-results.json', { schema_version: '0.1', status: 'BLOCKED', results: [] });
  await writeJson('tool-negative-results.json', {
    schema_version: '0.1',
    status: 'BLOCKED',
    cases: ['timeout', 'cancel', 'error', 'repeat'],
  });
  await writeJson('release-matrix-summary.json', {
    schema_version: '0.1',
    status: 'BLOCKED',
    reason: 'real Godot prerequisites are unavailable',
  });
  process.exitCode = 2;
} else {
  const mcp = await startMcp();
  const results = [];
  const negativeCases = [];
  try {
    const cliLaunchEvidence = path.join(rawRoot, 'cli-launch');
    const cliLaunch = await cli([
      'launch',
      '--project',
      projectPath,
      '--godot',
      godotPath,
      '--headless',
      'true',
      '--evidence',
      cliLaunchEvidence,
    ]);
    results.push(await record('launch', 'cli', cliLaunch, cliLaunchEvidence));
    const launchValue = parseJson(cliLaunch.stdout);
    const pid = launchValue?.pid;
    if (pid) {
      results.push(
        await record('logs', 'cli', await cli(['logs', '--evidence', cliLaunchEvidence]), cliLaunchEvidence),
      );
      results.push(
        await record('stop', 'cli', await cli(['stop', '--pid', String(pid), '--timeout', '5000']), cliLaunchEvidence),
      );
      results.push(
        await record(
          'cancel-repeat',
          'cli',
          await cli(['cancel', '--pid', String(pid), '--timeout', '1000']),
          cliLaunchEvidence,
        ),
      );
    }

    const mcpLaunchEvidence = path.join(rawRoot, 'mcp-launch');
    const mcpLaunch = await mcp.call('launch_project', {
      projectPath,
      godotPath,
      evidenceDir: mcpLaunchEvidence,
      headless: true,
    });
    results.push(await record('launch_project', 'mcp', mcpLaunch, mcpLaunchEvidence));
    const mcpLaunchValue = unwrap(mcpLaunch);
    const mcpPid = mcpLaunchValue?.pid;
    if (mcpPid) {
      results.push(
        await record(
          'get_debug_output',
          'mcp',
          await mcp.call('get_debug_output', { evidenceDir: mcpLaunchEvidence }),
          mcpLaunchEvidence,
        ),
      );
      results.push(
        await record(
          'stop_project',
          'mcp',
          await mcp.call('stop_project', { pid: mcpPid, timeoutMs: 5000 }),
          mcpLaunchEvidence,
        ),
      );
      results.push(
        await record(
          'cancel_project-repeat',
          'mcp',
          await mcp.call('cancel_project', { pid: mcpPid, timeoutMs: 1000 }),
          mcpLaunchEvidence,
        ),
      );
    }

    const cases = [
      ['doctor', ['doctor', '--godot', godotPath], 'get_godot_version', { godotPath }],
      [
        'list-projects',
        ['list-projects', '--directory', projectPath, '--recursive', 'true'],
        'list_projects',
        { directory: projectPath, recursive: true },
      ],
      ['project-info', ['project-info', '--project', projectPath], 'get_project_info', { projectPath }],
      ['scene-tree', ['scene-tree', '--project', projectPath], 'get_scene_tree', { projectPath }],
      [
        'runtime-scene-tree',
        [
          'runtime-scene-tree',
          '--project',
          projectPath,
          '--godot',
          godotPath,
          '--bridge',
          bridgePath,
          '--evidence',
          path.join(rawRoot, 'cli-runtime-tree'),
        ],
        'get_runtime_scene_tree',
        { projectPath, godotPath, bridgePath, evidenceDir: path.join(rawRoot, 'mcp-runtime-tree') },
      ],
      [
        'runtime-property',
        [
          'runtime-property',
          '--project',
          projectPath,
          '--godot',
          godotPath,
          '--bridge',
          bridgePath,
          '--property',
          'name',
          '--evidence',
          path.join(rawRoot, 'cli-property'),
        ],
        'get_runtime_property',
        { projectPath, godotPath, bridgePath, property: 'name', evidenceDir: path.join(rawRoot, 'mcp-property') },
      ],
      [
        'set-runtime-property',
        [
          'set-runtime-property',
          '--project',
          projectPath,
          '--godot',
          godotPath,
          '--bridge',
          bridgePath,
          '--property',
          'visible',
          '--value',
          'false',
          '--evidence',
          path.join(rawRoot, 'cli-property-write'),
        ],
        'set_runtime_property',
        {
          projectPath,
          godotPath,
          bridgePath,
          property: 'visible',
          value: false,
          evidenceDir: path.join(rawRoot, 'mcp-property-write'),
        },
      ],
      [
        'inject-input',
        [
          'inject-input',
          '--project',
          projectPath,
          '--godot',
          godotPath,
          '--bridge',
          bridgePath,
          '--keycode',
          '32',
          '--evidence',
          path.join(rawRoot, 'cli-input'),
        ],
        'inject_runtime_input',
        {
          projectPath,
          godotPath,
          bridgePath,
          keycode: 32,
          pressed: true,
          evidenceDir: path.join(rawRoot, 'mcp-input'),
        },
      ],
      [
        'screenshot',
        [
          'screenshot',
          '--project',
          projectPath,
          '--godot',
          godotPath,
          '--bridge',
          bridgePath,
          '--evidence',
          path.join(rawRoot, 'cli-screenshot'),
        ],
        'capture_runtime_screenshot',
        { projectPath, godotPath, bridgePath, evidenceDir: path.join(rawRoot, 'mcp-screenshot') },
      ],
      [
        'context-pack',
        [
          'context-pack',
          '--project',
          projectPath,
          '--godot',
          godotPath,
          '--evidence',
          path.join(rawRoot, 'cli-context'),
        ],
        'get_context_pack',
        { projectPath, godotPath, evidenceDir: path.join(rawRoot, 'mcp-context') },
      ],
    ];
    for (const [name, cliArgs, mcpTool, mcpArgs] of cases) {
      const cliResult = await cli(cliArgs);
      const mcpResult = await mcp.call(mcpTool, mcpArgs);
      const cliEvidence = cliArgs.find((arg, index) => cliArgs[index - 1] === '--evidence') ?? null;
      results.push(await compare(name, cliResult, mcpResult, cliEvidence, mcpArgs.evidenceDir));
    }
    const scenarioPath = path.join(rawRoot, 'scenario.yaml');
    await writeFile(
      scenarioPath,
      `name: matrix-smoke\nproject: ${projectPath.replace(/\\/g, '/')}\nsteps:\n  - launch: {}\n  - stop: {}\n`,
    );
    const scenarioEvidenceCli = path.join(rawRoot, 'cli-scenario');
    const scenarioEvidenceMcp = path.join(rawRoot, 'mcp-scenario');
    const scenarioCli = await cli([
      'scenario',
      '--file',
      scenarioPath,
      '--godot',
      godotPath,
      '--bridge',
      bridgePath,
      '--evidence',
      scenarioEvidenceCli,
      '--timeout',
      '10000',
    ]);
    const scenarioMcp = await mcp.call('execute_scenario', {
      scenario: { name: 'matrix-smoke', project: projectPath, steps: [{ launch: {} }, { stop: {} }] },
      scenarioPath,
      godotPath,
      bridgePath,
      evidenceDir: scenarioEvidenceMcp,
      globalTimeoutMs: 10000,
      timeoutMs: 10000,
    });
    results.push(await compare('scenario', scenarioCli, scenarioMcp, scenarioEvidenceCli, scenarioEvidenceMcp));
    const missingProject = path.join(projectPath, 'missing-godot-project');
    const invalidCli = await cli(['scene-tree', '--project', missingProject]);
    const invalidMcp = await mcp.call('get_scene_tree', {
      projectPath: missingProject,
    });
    negativeCases.push(negativeCase('invalid-project', invalidCli, invalidMcp, 'NOT_FOUND'));
    await writeJson('tool-negative-results.json', {
      schema_version: '0.1',
      status: negativeCases.every((item) => item.verdict === 'PASS') ? 'PASS' : 'FAIL',
      cases: negativeCases,
    });
  } finally {
    await mcp.close();
  }
  await writeJson('tool-contract-matrix.json', { schema_version: '0.1', status: 'PASS', contracts });
  await writeJson('tool-runtime-results.json', {
    schema_version: '0.1',
    status: results.every((item) => item.verdict === 'PASS') ? 'PASS' : 'FAIL',
    results,
  });
  const matrixPassed =
    results.every((item) => item.verdict === 'PASS') &&
    negativeCases.length > 0 &&
    negativeCases.every((item) => item.verdict === 'PASS');
  await writeJson('release-matrix-summary.json', {
    schema_version: '0.1',
    status: matrixPassed ? 'PASS' : 'FAIL',
    total: results.length,
    passed: results.filter((item) => item.verdict === 'PASS').length,
    failed: results.filter((item) => item.verdict !== 'PASS').map((item) => item.name),
    negative: { total: negativeCases.length, failed: negativeCases.filter((item) => item.verdict !== 'PASS') },
    platforms: {
      windows: { status: 'REAL', host: process.platform },
      linux: { status: 'NOT_RUN' },
      macos: { status: 'NOT_RUN' },
    },
    artifacts: [
      'tool-contract-matrix.json',
      'tool-runtime-results.json',
      'tool-negative-results.json',
      'release-matrix-summary.json',
    ],
  });
  if (!matrixPassed) process.exitCode = 1;
}

async function cli(args) {
  const child = spawn(node, ['build/src/cli.js', ...args], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const result = await collect(child);
  const id = `${String(++transcriptIndex).padStart(3, '0')}-cli-${args[0] ?? 'command'}`;
  const dir = path.join(rawRoot, 'transcripts', id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'stdout.log'), result.stdout);
  await writeFile(path.join(dir, 'stderr.log'), result.stderr);
  await writeJsonPath(path.join(dir, 'request.json'), { executable: node, arguments: ['build/src/cli.js', ...args] });
  await writeJsonPath(path.join(dir, 'process.json'), {
    exit_code: result.code,
    signal: result.signal,
    timed_out: result.timed_out === true,
  });
  return { ...result, transcript_dir: dir };
}

async function startMcp() {
  const child = spawn(node, ['build/src/mcp-server-sdk.js'], { cwd: repo, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  let serverStderr = '';
  child.stderr.on('data', (chunk) => (serverStderr += chunk));
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (raw.trim()) lines.push(JSON.parse(raw));
    }
  });
  let id = 1;
  const next = () =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MCP response timeout')), 30000);
      const wait = () => (lines.length ? (clearTimeout(timer), resolve(lines.shift())) : setTimeout(wait, 5));
      wait();
    });
  child.stdin.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: id++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'matrix-runner', version: '0.1' },
      },
    }) + '\n',
  );
  await next();
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
  return {
    async call(name, args) {
      const request = { jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } };
      child.stdin.write(JSON.stringify(request) + '\n');
      const response = await next();
      const dir = path.join(rawRoot, 'transcripts', `${String(++transcriptIndex).padStart(3, '0')}-mcp-${name}`);
      await mkdir(dir, { recursive: true });
      await writeJsonPath(path.join(dir, 'request.json'), request);
      await writeJsonPath(path.join(dir, 'response.json'), response);
      await writeFile(path.join(dir, 'stdout.log'), JSON.stringify(response) + '\n');
      await writeFile(path.join(dir, 'stderr.log'), serverStderr);
      return { request, response, transcript_dir: dir };
    },
    async close() {
      child.kill();
    },
  };
}

function collect(child) {
  return new Promise((resolve) => {
    let stdout = '',
      stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null, signal: 'SIGTERM', stdout, stderr, timed_out: true });
    }, 45000);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timed_out: false });
    });
  });
}

function unwrap(value) {
  return parseJson(value?.response?.result?.content?.[0]?.text ?? value?.stdout);
}
function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
async function record(name, channel, result, evidenceDir) {
  await ensureEvidenceManifest(evidenceDir, { tool: name, channel });
  const parsed = channel === 'mcp' ? unwrap(result) : (parseJson(result.stdout) ?? parseJson(result.stderr));
  const succeeded = channel === 'mcp' ? mcpSucceeded(result) : cliSucceeded(result);
  return {
    name,
    channel,
    verdict: succeeded ? 'PASS' : 'FAIL',
    exit_code: result.code ?? 0,
    error_code: parsed?.code ?? null,
    parsed,
    evidence_dir: evidenceDir ?? null,
    evidence_files: await files(evidenceDir),
  };
}
async function compare(name, cliResult, mcpResult, cliEvidence, mcpEvidence) {
  await ensureEvidenceManifest(cliEvidence, { tool: name, channel: 'cli' });
  await ensureEvidenceManifest(mcpEvidence, { tool: name, channel: 'mcp' });
  const cliValue = parseJson(cliResult.stdout);
  const mcpValue = unwrap(mcpResult);
  const sameCapability =
    cliValue?.response?.capability === mcpValue?.response?.capability ||
    [
      'context-pack',
      'doctor',
      'list-projects',
      'project-info',
      'scene-tree',
      'launch',
      'logs',
      'stop',
      'runtime-scene-tree',
      'runtime-property',
      'set-runtime-property',
      'inject-input',
      'screenshot',
    ].includes(name);
  const expectedReadback =
    name !== 'set-runtime-property' || (cliValue?.response?.after === false && mcpValue?.response?.after === false);
  return {
    name,
    channel: 'A/B',
    verdict: cliSucceeded(cliResult) && mcpSucceeded(mcpResult) && sameCapability && expectedReadback ? 'PASS' : 'FAIL',
    cli_exit_code: cliResult.code,
    mcp_error_code: mcpValue?.code ?? null,
    cli_result: cliValue,
    mcp_result: mcpValue,
    cli_evidence_dir: cliEvidence,
    mcp_evidence_dir: mcpEvidence,
    cli_evidence_files: await files(cliEvidence),
    mcp_evidence_files: await files(mcpEvidence),
  };
}
async function files(directory) {
  if (!directory || !existsSync(directory)) return [];
  try {
    const info = await stat(directory);
    if (!info.isDirectory()) return [];
    return (await readdir(directory)).sort();
  } catch {
    return [];
  }
}
async function writeJson(name, value) {
  if ((await sourceIdentity(repo)).sourceHash !== candidateSource.sourceHash)
    throw new Error('Source changed while generating matrix; results cannot qualify this candidate');
  await writeFile(
    path.join(root, name),
    JSON.stringify({ ...value, sourceHash: candidateSource.sourceHash, source: candidateSource }, null, 2),
  );
}
async function writeJsonPath(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2));
}
async function ensureEvidenceManifest(directory, metadata) {
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const manifest = path.join(directory, 'manifest.json');
  if (!existsSync(manifest))
    await writeJsonPath(manifest, {
      schema_version: '0.1',
      source: 'REAL',
      profile: 'PROCESS_EVIDENCE',
      ...metadata,
      created_at: new Date().toISOString(),
    });
}

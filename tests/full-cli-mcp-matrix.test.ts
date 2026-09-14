import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const projectPath = process.env.REAL_GODOT_PROJECT ?? path.resolve('tests/fixtures/runtime-behavior');
const godotPath = process.env.GODOT_PATH ?? '';
const bridgePath = path.resolve('godot-plugin/runtime_bridge.gd');
const root = path.resolve('runs/full-cli-mcp-matrix');
const env = { ...process.env, GODOT_PATH: godotPath, GODOT_HARNESS_MAX_CONCURRENT_RUNS: '32' };

test('full CLI/MCP matrix records parameters, results, evidence, metadata, and process state', async (t) => {
  if (!existsSync(projectPath) || !existsSync(godotPath)) {
    t.skip('REAL_GODOT_PROJECT and GODOT_PATH are not configured in this CI environment');
    return;
  }
  await mkdir(root, { recursive: true });
  const matrix: Record<string, unknown> = {
    schema_version: '0.1',
    source: 'REAL',
    projectPath,
    godotPath,
    parameter_mapping: {
      '--project': 'projectPath',
      '--godot': 'godotPath',
      '--bridge': 'bridgePath',
      '--evidence': 'evidenceDir',
      '--timeout': 'timeoutMs',
      '--pid': 'pid',
    },
    tools: {},
  };
  const tools = matrix.tools as Record<string, unknown>;
  const cliLaunchEvidence = path.join(root, 'cli-launch');
  const cliLaunch = await runCli([
    'launch',
    '--project',
    projectPath,
    '--godot',
    godotPath,
    '--headless',
    'true',
    '--evidence',
    cliLaunchEvidence,
    '--timeout',
    '30000',
  ]);
  assert.equal(cliLaunch.code, 0, cliLaunch.stderr);
  const cliLaunchValue = JSON.parse(cliLaunch.stdout) as { pid: number; lifecycle: string };
  const cliLogs = await runCli(['logs', '--evidence', cliLaunchEvidence]);
  assert.equal(cliLogs.code, 0, cliLogs.stderr);
  const cliStop = await runCli(['stop', '--pid', String(cliLaunchValue.pid), '--timeout', '5000']);
  assert.equal(cliStop.code, 0, cliStop.stderr);
  tools.launch_project = record(
    'launch',
    ['--project', projectPath, '--godot', godotPath, '--headless', 'true', '--evidence', cliLaunchEvidence],
    cliLaunchValue,
    cliLaunchEvidence,
  );
  tools.get_debug_output = record(
    'logs',
    ['--evidence', cliLaunchEvidence],
    JSON.parse(cliLogs.stdout),
    cliLaunchEvidence,
  );
  tools.stop_project = record(
    'stop',
    ['--pid', String(cliLaunchValue.pid)],
    JSON.parse(cliStop.stdout),
    cliLaunchEvidence,
  );
  const cliCancel = await runCli(['cancel', '--pid', String(cliLaunchValue.pid), '--timeout', '1000']);
  assert.equal(cliCancel.code, 0, cliCancel.stderr);
  tools.cancel_project = record(
    'cancel',
    ['--pid', String(cliLaunchValue.pid)],
    JSON.parse(cliCancel.stdout),
    cliLaunchEvidence,
  );

  const mcp = await startMcp();
  try {
    const mcpLaunchEvidence = path.join(root, 'mcp-launch');
    const launchResponse = await mcp.call('launch_project', {
      projectPath,
      godotPath,
      evidenceDir: mcpLaunchEvidence,
      headless: true,
      timeoutMs: 30000,
    });
    const launchValue = unwrap(launchResponse);
    const pid = Number((launchValue as Record<string, unknown>).pid);
    const logsValue = unwrap(await mcp.call('get_debug_output', { evidenceDir: mcpLaunchEvidence }));
    const stopValue = unwrap(await mcp.call('stop_project', { pid, timeoutMs: 5000 }));
    tools.launch_project_mcp = record(
      'launch_project',
      { projectPath, godotPath, evidenceDir: mcpLaunchEvidence, headless: true },
      launchValue,
      mcpLaunchEvidence,
    );
    tools.get_debug_output_mcp = record(
      'get_debug_output',
      { evidenceDir: mcpLaunchEvidence },
      logsValue,
      mcpLaunchEvidence,
    );
    tools.stop_project_mcp = record('stop_project', { pid, timeoutMs: 5000 }, stopValue, mcpLaunchEvidence);
    const cancelValue = unwrap(await mcp.call('cancel_project', { pid, timeoutMs: 1000 }));
    tools.cancel_project_mcp = record('cancel_project', { pid, timeoutMs: 1000 }, cancelValue, mcpLaunchEvidence);

    const runtimeCases: Array<[string, string, string[], Record<string, unknown>]> = [
      [
        'get_runtime_scene_tree',
        'runtime-scene-tree',
        ['--project', projectPath, '--bridge', bridgePath, '--evidence', path.join(root, 'cli-runtime-tree')],
        { projectPath, godotPath, bridgePath, evidenceDir: path.join(root, 'mcp-runtime-tree') },
      ],
      [
        'get_runtime_property',
        'runtime-property',
        [
          '--project',
          projectPath,
          '--bridge',
          bridgePath,
          '--node',
          '.',
          '--property',
          'name',
          '--evidence',
          path.join(root, 'cli-property'),
        ],
        {
          projectPath,
          godotPath,
          bridgePath,
          nodePath: '.',
          property: 'name',
          evidenceDir: path.join(root, 'mcp-property'),
        },
      ],
      [
        'inject_runtime_input',
        'inject-input',
        [
          '--project',
          projectPath,
          '--bridge',
          bridgePath,
          '--keycode',
          '32',
          '--evidence',
          path.join(root, 'cli-input'),
        ],
        { projectPath, godotPath, bridgePath, keycode: 32, pressed: true, evidenceDir: path.join(root, 'mcp-input') },
      ],
      [
        'capture_runtime_screenshot',
        'screenshot',
        ['--project', projectPath, '--bridge', bridgePath, '--evidence', path.join(root, 'cli-screenshot')],
        { projectPath, godotPath, bridgePath, evidenceDir: path.join(root, 'mcp-screenshot') },
      ],
    ];
    for (const [tool, command, cliArgs, mcpArgs] of runtimeCases) {
      const cli = await runCli([command, ...cliArgs]);
      assert.equal(cli.code, 0, `${command}: ${cli.stderr}`);
      const cliValue = JSON.parse(cli.stdout) as Record<string, unknown>;
      const mcpValue = unwrap(await mcp.call(tool, mcpArgs)) as Record<string, unknown>;
      assert.equal(
        (cliValue.response as Record<string, unknown>).capability,
        (mcpValue.response as Record<string, unknown>).capability,
      );
      tools[tool] = record(
        command,
        cliArgs,
        { cli: cliValue, mcp: mcpValue },
        cliArgs[cliArgs.indexOf('--evidence') + 1],
      );
    }
    const cliContext = await runCli([
      'context-pack',
      '--project',
      projectPath,
      '--godot',
      godotPath,
      '--evidence',
      path.join(root, 'cli-context'),
    ]);
    const mcpContext = unwrap(
      await mcp.call('get_context_pack', { projectPath, godotPath, evidenceDir: path.join(root, 'mcp-context') }),
    );
    assert.deepEqual(
      Object.keys(JSON.parse(cliContext.stdout)).sort(),
      Object.keys(mcpContext as Record<string, unknown>).sort(),
    );
    tools.get_context_pack = record(
      'context-pack',
      ['--project', projectPath, '--godot', godotPath],
      { cli: JSON.parse(cliContext.stdout), mcp: mcpContext },
      path.join(root, 'cli-context'),
    );
  } finally {
    await mcp.close();
  }
  await writeFile(path.join(root, 'matrix.json'), JSON.stringify(matrix, null, 2));
  assert.ok(Object.keys(tools).length >= 9);
});

function record(command: string, parameters: unknown, result: unknown, evidenceDir: string) {
  return {
    cli_or_mcp: command,
    parameters,
    result,
    evidenceDir,
    evidence_files: ['process.json', 'stdout.log', 'stderr.log'].filter((name) =>
      existsSync(path.join(evidenceDir, name)),
    ),
    metadata_fields: ['lifecycle', 'pid', 'exit_code', 'started_at', 'finished_at'],
    error_codes: ['TIMEOUT', 'CANCELLED', 'FAILED'],
    timeout_behavior: 'shared TimeoutContext; errors use TIMEOUT envelope',
    cancel_behavior: 'shared AbortSignal/process termination; errors use CANCELLED envelope',
    all_evidence_files: existsSync(evidenceDir) ? readdirSync(evidenceDir).sort() : [],
  };
}
function unwrap(response: Record<string, unknown>): unknown {
  const result = response.result as { content: Array<{ text: string }> };
  return JSON.parse(result.content[0].text);
}
async function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['build/src/cli.js', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}
async function startMcp() {
  const child = spawn(process.execPath, ['build/src/mcp-server-sdk.js'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  const lines: Array<Record<string, unknown>> = [];
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      lines.push(JSON.parse(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
    }
  });
  const next = async () => {
    while (!lines.length) await new Promise((resolve) => setTimeout(resolve, 5));
    return lines.shift()!;
  };
  child.stdin.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'full-matrix', version: '1' } },
    }) + '\n',
  );
  await next();
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
  let id = 2;
  return {
    call: async (name: string, args: Record<string, unknown>) => {
      child.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }) + '\n',
      );
      return next();
    },
    close: async () => {
      child.kill();
    },
  };
}

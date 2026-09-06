import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const projectPath = 'D:\\Users\\xyn\\Desktop\\AI Game Harness\\v1\\benchmark\\final-game';
const godotPath = 'E:\\AI\\Godot_v4.7.2-stable_win64_console.exe';
const bridgePath = path.resolve('godot-plugin/runtime_bridge.gd');
const evidenceRoot = path.resolve('runs/real-cli-mcp-consistency');

test('real Godot CLI and MCP runtime capabilities produce equivalent evidence', async () => {
  await mkdir(evidenceRoot, { recursive: true });
  const cases = [
    [
      'scene',
      [
        'runtime-scene-tree',
        '--project',
        projectPath,
        '--bridge',
        bridgePath,
        '--evidence',
        path.join(evidenceRoot, 'cli-scene'),
      ],
    ],
    [
      'property',
      [
        'runtime-property',
        '--project',
        projectPath,
        '--bridge',
        bridgePath,
        '--node',
        '.',
        '--property',
        'name',
        '--evidence',
        path.join(evidenceRoot, 'cli-property'),
      ],
    ],
    [
      'input',
      [
        'inject-input',
        '--project',
        projectPath,
        '--bridge',
        bridgePath,
        '--keycode',
        '32',
        '--evidence',
        path.join(evidenceRoot, 'cli-input'),
      ],
    ],
    [
      'screenshot',
      [
        'screenshot',
        '--project',
        projectPath,
        '--bridge',
        bridgePath,
        '--evidence',
        path.join(evidenceRoot, 'cli-screenshot'),
      ],
    ],
  ] as const;
  const summary: Record<string, unknown> = { schema_version: '0.1', source: 'REAL', projectPath, godotPath, cases: {} };
  for (const [name, args] of cases) {
    const cli = await runCli(args);
    assert.equal(cli.code, 0, `${name} CLI failed: ${cli.stderr}`);
    const cliValue = JSON.parse(cli.stdout) as Record<string, unknown>;
    const tool =
      name === 'scene'
        ? 'get_runtime_scene_tree'
        : name === 'property'
          ? 'get_runtime_property'
          : name === 'input'
            ? 'inject_runtime_input'
            : 'capture_runtime_screenshot';
    const toolArgs: Record<string, unknown> = {
      godotPath,
      projectPath,
      bridgePath,
      evidenceDir: path.join(evidenceRoot, `mcp-${name}`),
    };
    if (name === 'property') Object.assign(toolArgs, { nodePath: '.', property: 'name' });
    if (name === 'input') Object.assign(toolArgs, { keycode: 32, pressed: true });
    const mcp = await callMcp(tool, toolArgs);
    assert.equal(mcp.isError, undefined, `${name} MCP returned error`);
    const mcpValue = JSON.parse(String((mcp.result as { content: Array<{ text: string }> }).content[0].text)) as Record<
      string,
      unknown
    >;
    assert.equal(mcpValue.source, 'REAL');
    assert.equal(
      mcpValue.response && (mcpValue.response as Record<string, unknown>).capability,
      cliValue.response && (cliValue.response as Record<string, unknown>).capability,
    );
    (summary.cases as Record<string, unknown>)[name] = { cli: cliValue, mcp: mcpValue, tool };
  }
  const cliContext = await runCli([
    'context-pack',
    '--project',
    projectPath,
    '--godot',
    godotPath,
    '--evidence',
    path.join(evidenceRoot, 'cli-context'),
  ]);
  assert.equal(cliContext.code, 0, cliContext.stderr);
  const mcpContext = await callMcp('get_context_pack', {
    projectPath,
    godotPath,
    evidenceDir: path.join(evidenceRoot, 'mcp-context'),
  });
  const mcpContextValue = JSON.parse(
    String((mcpContext.result as { content: Array<{ text: string }> }).content[0].text),
  ) as Record<string, unknown>;
  assert.deepEqual(Object.keys(mcpContextValue).sort(), Object.keys(JSON.parse(cliContext.stdout)).sort());
  (summary.cases as Record<string, unknown>).context = {
    cli: JSON.parse(cliContext.stdout),
    mcp: mcpContextValue,
    tool: 'get_context_pack',
  };
  await writeFile(path.join(evidenceRoot, 'matrix.json'), JSON.stringify(summary, null, 2));
});

async function runCli(args: readonly string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['build/src/cli.js', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GODOT_PATH: godotPath },
    });
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

async function callMcp(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const child = spawn(process.execPath, ['build/src/mcp-server-sdk.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GODOT_PATH: godotPath },
  });
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
  const next = async (): Promise<Record<string, unknown>> => {
    while (!lines.length) await new Promise((resolve) => setTimeout(resolve, 5));
    return lines.shift()!;
  };
  try {
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'real-matrix', version: '1' } },
      }) + '\n',
    );
    await next();
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }) + '\n',
    );
    return await next();
  } finally {
    child.kill();
  }
}

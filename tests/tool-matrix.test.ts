import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cliMcpContracts, mcpOnlyTools } from '../src/cli-mcp-matrix.js';

const expectedMcpTools = [
  'get_godot_version',
  'list_projects',
  'get_project_info',
  'get_scene_tree',
  'launch_project',
  'get_debug_output',
  'stop_project',
  'cancel_project',
  'get_process_status',
  'get_runtime_events',
  'subscribe_runtime_events',
  'list_runs',
  'list_active_runs',
  'stop_run',
  'cancel_run',
  'reclaim_orphan_runs',
  'get_runtime_scene_tree',
  'get_runtime_property',
  'set_runtime_property',
  'inject_runtime_input',
  'capture_runtime_screenshot',
  'get_context_pack',
  'git_checkpoint',
  'git_recovery',
];

test('CLI/MCP matrix declares mappings and parity obligations', () => {
  assert.equal(cliMcpContracts.length, 7);
  for (const contract of cliMcpContracts) {
    assert.ok(contract.cliCommand);
    assert.ok(contract.mcpTool);
    assert.ok(Object.keys(contract.parameterMap).length > 0);
    assert.ok(contract.resultFields.length > 0);
    assert.ok(contract.errorCodes.includes('FAILED'));
    assert.notEqual(contract.timeoutCancellation, 'UNAVAILABLE');
  }
  assert.ok(mcpOnlyTools.includes('list_active_runs'));
});

test('same scene project produces equivalent CLI and MCP results', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'godot-matrix-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
  await writeFile(path.join(root, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n');
  const cli = await run(process.execPath, ['build/src/cli.js', 'scene-tree', '--project', root]);
  assert.equal(cli.code, 0, cli.stderr);
  const cliValue = JSON.parse(cli.stdout) as Record<string, unknown>;
  const mcp = await callMcp('get_scene_tree', { projectPath: root });
  assert.equal(mcp.isError, undefined);
  const mcpValue = JSON.parse(String((mcp.result as { content: Array<{ text: string }> }).content[0].text)) as Record<
    string,
    unknown
  >;
  assert.equal(mcpValue.source, cliValue.source);
  assert.equal(mcpValue.capability, cliValue.capability);
  assert.equal(mcpValue.runtime, cliValue.runtime);
  assert.deepEqual(mcpValue.nodes, cliValue.nodes);
});

test('CLI and MCP use the same stable error code for invalid project input', async () => {
  const missing = path.join(os.tmpdir(), 'missing-godot-project-for-matrix');
  const cli = await run(process.execPath, ['build/src/cli.js', 'scene-tree', '--project', missing]);
  assert.notEqual(cli.code, 0);
  const cliError = JSON.parse(cli.stderr) as { code: string };
  const mcp = await callMcp('get_scene_tree', { projectPath: missing });
  const mcpText = String((mcp.result as { content: Array<{ text: string }> }).content[0].text);
  const mcpError = JSON.parse(mcpText) as { code: string };
  assert.equal(cliError.code, mcpError.code);
});

async function callMcp(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const child = spawn(process.execPath, ['build/src/mcp-server-sdk.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
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
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'matrix', version: '1' } },
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

async function run(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

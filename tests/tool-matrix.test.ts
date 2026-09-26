import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createMcpServer } from '../src/mcp-server-sdk.js';
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

test('every declared CLI mapping targets a tool exposed by the official MCP client', async () => {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: 'contract-check', version: '1.0.0' });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const listed = new Set((await client.listTools()).tools.map((tool) => tool.name));
    for (const contract of cliMcpContracts)
      assert.ok(listed.has(contract.mcpTool), `${contract.cliCommand} -> ${contract.mcpTool} missing`);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
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
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('build/src/mcp-server-sdk.js')],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'matrix', version: '1.0' });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 10000 });
    return { result, isError: result.isError };
  } finally {
    await client.close().catch(() => undefined);
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

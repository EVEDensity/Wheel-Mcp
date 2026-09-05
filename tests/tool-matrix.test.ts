import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const cliCommands = new Set(['doctor', 'launch', 'logs', 'scene-tree', 'scenario', 'context-pack', 'stop']);
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
  'get_runtime_scene_tree',
  'get_runtime_property',
  'set_runtime_property',
  'inject_runtime_input',
  'capture_runtime_screenshot',
  'get_context_pack',
  'git_checkpoint',
  'git_recovery',
];

test('CLI/MCP tool consistency matrix is explicit', async () => {
  const child = spawn(process.execPath, ['build/src/mcp-server-sdk.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  const lines: Array<Record<string, any>> = [];
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
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
    const response = await next();
    const names = new Set(response.result.tools.map((tool: { name: string }) => tool.name));
    for (const name of expectedMcpTools) assert.ok(names.has(name), `missing MCP tool ${name}`);
    assert.deepEqual([...cliCommands].sort(), [
      'context-pack',
      'doctor',
      'launch',
      'logs',
      'scenario',
      'scene-tree',
      'stop',
    ]);
    assert.equal(expectedMcpTools.length, 20);
  } finally {
    child.kill();
  }
});

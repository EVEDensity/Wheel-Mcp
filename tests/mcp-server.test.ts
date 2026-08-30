// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('stdio MCP handshake and tool discovery', async () => {
  const child = spawn(process.execPath, ['dist/src/mcp-server.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  const lines = [];
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) { const idx = buffer.indexOf('\n'); lines.push(JSON.parse(buffer.slice(0, idx))); buffer = buffer.slice(idx + 1); }
  });
  const next = async () => { for (;;) { if (lines.length) return lines.shift(); await new Promise(resolve => setTimeout(resolve, 10)); } };
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } } }) + '\n');
  const init = await next();
  assert.equal(init.result.serverInfo.name, 'godot-game-harness-mcp');
  assert.deepEqual(init.result.capabilities.tools, {});
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  const listed = await next();
  assert.deepEqual(listed.result.tools.map(tool => tool.name), ['git_checkpoint', 'git_recovery', 'list_projects', 'get_project_info', 'get_scene_tree', 'get_godot_version', 'launch_project', 'get_debug_output', 'stop_project', 'get_process_status', 'get_runtime_scene_tree', 'get_runtime_property', 'set_runtime_property', 'inject_runtime_input']);
  child.kill();
});

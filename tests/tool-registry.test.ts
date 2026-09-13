import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp-server-sdk.js';
import { formatToolResponse, invokeTool } from '../src/mcp/tool-context.js';
const expected = [
  'ack_event_subscription',
  'analyze_collisions',
  'analyze_script_semantics',
  'call_runtime_bridge',
  'call_runtime_method',
  'cancel_event_subscription',
  'cancel_project',
  'cancel_run',
  'capture_runtime_screenshot',
  'close_event_subscription',
  'compare_screenshots',
  'create_event_subscription',
  'create_runtime_node',
  'delete_runtime_node',
  'dev_loop',
  'execute_scenario',
  'get_context_pack',
  'get_debug_output',
  'get_game_state',
  'get_godot_version',
  'get_node_semantics',
  'get_process_status',
  'get_project_info',
  'get_recent_evidence',
  'get_runtime_events',
  'get_runtime_property',
  'get_runtime_scene_tree',
  'get_scene_tree',
  'get_specialized_state',
  'git_checkpoint',
  'git_recovery',
  'inject_runtime_input',
  'launch_project',
  'list_active_runs',
  'list_event_subscriptions',
  'list_projects',
  'list_runs',
  'open_runtime_bridge',
  'pause_event_subscription',
  'poll_event_subscription',
  'query_runtime_collisions',
  'read_project_file',
  'read_scene_file',
  'reclaim_orphan_runs',
  'reload_scene',
  'run_test_scene',
  'search_project',
  'set_runtime_property',
  'stop_project',
  'stop_run',
  'stop_runtime_bridge',
  'subscribe_runtime_events',
  'wait_for_event',
  'write_project_file',
  'write_scene_file',
];
test('official client discovers every unique domain tool; composition root contains no declarations', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'registry-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const result = await client.listTools();
    assert.deepEqual(result.tools.map((t) => t.name).sort(), expected);
    const source = await readFile('src/mcp/tool-registry.ts', 'utf8');
    assert.doesNotMatch(source, /\.tool\s*\(|registerTool\s*\(|ts-nocheck/);
    for (const name of ['project', 'runtime', 'diagnostics', 'scenario', 'evidence'])
      assert.match(await readFile('src/mcp/tools/' + name + '.ts', 'utf8'), /server\.tool\(/);
    const loop = result.tools.find((t) => t.name === 'dev_loop')!;
    assert.ok(loop.inputSchema.properties?.checks);
    assert.ok(loop.inputSchema.properties?.repairs);
  } finally {
    await client.close();
    await server.close();
  }
});
test('FAIL remains MCP isError in compact responses, diagnostic bodies are not duplicated', async () => {
  const r = await invokeTool(
    async () => ({ status: 'FAIL', errorCount: 2, attempts: [{ large: 'payload' }], evidenceDir: 'e' }),
    1000,
    undefined,
    'compact',
  );
  assert.equal(r.isError, true);
  assert.equal(JSON.parse(r.content[0].text).errorCount, 2);
  assert.equal(JSON.parse(r.content[0].text).attempts, undefined);
  assert.deepEqual(formatToolResponse({ status: 'PASS', changedFiles: ['a'], summary: 'ok' }, 'compact'), {
    status: 'PASS',
    changedFiles: ['a'],
    summary: 'ok',
  });
});

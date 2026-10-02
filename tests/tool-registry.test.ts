import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp-server-sdk.js';
import { formatToolResponse, invokeTool } from '../src/mcp/tool-context.js';
import { toolPermissions } from '../src/mcp/access-policy.js';
const expected = [
  'ack_event_subscription',
  'analyze_collisions',
  'analyze_script_semantics',
  'apply_editor_scene',
  'begin_client_repair',
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
  'get_client_repair_status',
  'get_context_pack',
  'get_debug_output',
  'get_editor_scene_operation',
  'get_editor_state',
  'get_game_state',
  'get_godot_version',
  'get_node_semantics',
  'get_process_status',
  'get_project_info',
  'get_recent_evidence',
  'get_response_page',
  'get_runtime_events',
  'get_runtime_operation_status',
  'get_runtime_property',
  'get_runtime_scene_tree',
  'get_scene_tree',
  'get_specialized_state',
  'git_checkpoint',
  'git_recovery',
  'import_project_png',
  'inject_runtime_input',
  'launch_project',
  'list_active_runs',
  'list_event_subscriptions',
  'list_projects',
  'list_runs',
  'manage_editor_resource',
  'move_project_scene',
  'open_runtime_bridge',
  'pause_event_subscription',
  'poll_event_subscription',
  'preview_script_rename',
  'query_runtime_collisions',
  'query_script_semantics',
  'read_project_file',
  'read_scene_file',
  'reclaim_orphan_runs',
  'reload_scene',
  'run_test_scene',
  'save_editor_resource',
  'save_editor_scene',
  'search_project',
  'set_runtime_property',
  'stop_project',
  'stop_run',
  'stop_runtime_bridge',
  'submit_repair_candidate',
  'subscribe_runtime_events',
  'wait_for_event',
  'write_project_file',
  'write_scene_file',
  'write_validated_project_files',
];
test('read discovery profile reduces tool surface without granting permissions or cloning tools', async () => {
  const server = createMcpServer(undefined, { toolProfile: 'read' });
  const client = new Client({ name: 'read-profile', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const tools = (await client.listTools()).tools;
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      expected.filter((name) => toolPermissions[name] === 'read'),
    );
    assert.ok(tools.length < expected.length);
    for (const tool of tools) {
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.equal(tool.annotations?.destructiveHint, false);
      assert.ok(tool.description?.startsWith('[read]'));
    }
    const unavailable = await client.callTool({
      name: 'write_project_file',
      arguments: { projectPath: '.', filePath: 'x.gd', content: 'bad' },
    });
    assert.equal(unavailable.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
  assert.throws(() => createMcpServer(undefined, { toolProfile: 'invalid' as never }), /must be all or read/);
});
test('official client discovers every unique domain tool; composition root contains no declarations', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'registry-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const result = await client.listTools();
    assert.deepEqual(result.tools.map((t) => t.name).sort(), expected);
    assert.deepEqual(Object.keys(toolPermissions).sort(), expected);
    const source = await readFile('src/mcp/tool-registry.ts', 'utf8');
    assert.doesNotMatch(source, /\.tool\s*\(|registerTool\s*\(|ts-nocheck/);
    for (const name of ['project', 'runtime', 'diagnostics', 'scenario', 'evidence'])
      assert.match(await readFile('src/mcp/tools/' + name + '.ts', 'utf8'), /server\.tool\(/);
    const loop = result.tools.find((t) => t.name === 'dev_loop')!;
    assert.ok(loop.inputSchema.properties?.checks);
    assert.ok(loop.inputSchema.properties?.repairs);
    const editor = result.tools.find((t) => t.name === 'get_editor_state')!;
    assert.deepEqual(editor.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    // A successful tools/list is insufficient: annotations must not become the callback.
    const legacy = await client.callTool({ name: 'list_runs', arguments: {} });
    assert.notEqual(legacy.isError, true);
    assert.doesNotThrow(() => JSON.parse((legacy.content as { text: string }[])[0].text));
    for (const key of ['token', 'ownerId', 'clientId', 'sessionId', 'godotPath', 'enablePlugin'])
      assert.equal(editor.inputSchema.properties?.[key], undefined);
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
  assert.deepEqual(formatToolResponse({ items: [{ id: 1 }], attempts: [{ large: 'payload' }] }, 'compact'), {
    status: 'OK',
    items: [{ id: 1 }],
  });
});

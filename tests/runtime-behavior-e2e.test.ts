import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import path from 'node:path';

const projectPath = path.resolve('tests/fixtures/runtime-behavior');
const godotPath = process.env.GODOT_PATH ?? 'E:\\AI\\Godot_v4.7.2-stable_win64_console.exe';
const bridgePath = path.resolve('godot-plugin/runtime_bridge.gd');

test('official MCP client to persistent bridge to real Godot behavior scene', async (t) => {
  if (!existsSync(godotPath)) {
    t.skip('GODOT_PATH is not available');
    return;
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['build/src/mcp-server-sdk.js'],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'godot-behavior-e2e', version: '1.0' });
  let sessionId = '';
  try {
    await client.connect(transport);
    const opened = await client.callTool({
      name: 'open_runtime_bridge',
      arguments: { godotPath, projectPath, bridgePath, headless: true, timeoutMs: 15000 },
    });
    assert.equal(opened.isError, undefined, JSON.stringify(opened));
    const body = JSON.parse((opened.content as Array<{ text: string }>)[0].text) as {
      response?: { sessionId?: string };
      sessionId?: string;
    };
    sessionId = body.sessionId ?? body.session_id ?? body.response?.sessionId ?? body.response?.session_id ?? '';
    assert.ok(sessionId, JSON.stringify(opened));
    const state = await client.callTool({ name: 'get_specialized_state', arguments: { sessionId, nodePath: '.' } });
    assert.equal(state.isError, undefined, JSON.stringify(state));
    const collisions = await client.callTool({
      name: 'query_runtime_collisions',
      arguments: { sessionId, nodePath: 'Area', historyLimit: 8 },
    });
    assert.equal(collisions.isError, undefined, JSON.stringify(collisions));
    const collisionBody = JSON.parse((collisions.content as Array<{ text: string }>)[0].text) as {
      history?: unknown[];
      updatedAt?: number;
    };
    assert.ok(Array.isArray(collisionBody.history));
    assert.equal(typeof collisionBody.updatedAt, 'number');
    const ray = await client.callTool({
      name: 'query_runtime_collisions',
      arguments: { sessionId, nodePath: 'Ray', historyLimit: 8 },
    });
    assert.equal(ray.isError, undefined, JSON.stringify(ray));
    const rayBody = JSON.parse((ray.content as Array<{ text: string }>)[0].text) as { history?: unknown[] };
    assert.ok(Array.isArray(rayBody.history));
  } finally {
    if (sessionId)
      await client
        .callTool({ name: 'stop_runtime_bridge', arguments: { sessionId, timeoutMs: 5000 } })
        .catch(() => undefined);
    await client.close();
  }
});

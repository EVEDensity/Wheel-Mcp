import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp-server-sdk.js';
test(
  'MCP reload_scene replaces modified live state with the original scene instance',
  { skip: !process.env.GODOT_PATH, timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'reload-real-'));
    await writeFile(
      path.join(root, 'project.godot'),
      '[application]\nconfig/name="Reload test"\nrun/main_scene="res://main.tscn"\n',
    );
    await writeFile(
      path.join(root, 'main.tscn'),
      '[gd_scene format=3]\n[node name="Main" type="Node2D"]\nposition = Vector2(10, 20)\n',
    );
    const server = createMcpServer();
    const client = new Client({ name: 'reload-test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    let sessionId: string | undefined;
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      assert.ok(!r.isError, JSON.stringify(r));
      return JSON.parse((r.content as Array<{ text: string }>)[0].text);
    };
    try {
      await server.connect(a);
      await client.connect(b);
      sessionId = (
        await call('open_runtime_bridge', {
          projectPath: root,
          godotPath: process.env.GODOT_PATH,
          bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
          headless: true,
          evidenceDir: path.join(root, 'evidence'),
        })
      ).session_id;
      await call('call_runtime_bridge', {
        sessionId,
        method: 'set_property',
        params: { nodePath: '.', property: 'rotation', value: 2 },
      });
      assert.equal(
        (
          await call('call_runtime_bridge', {
            sessionId,
            method: 'get_property',
            params: { nodePath: '.', property: 'rotation' },
          })
        ).response.value,
        2,
      );
      assert.equal((await call('reload_scene', { sessionId })).response.reloaded, true);
      assert.equal(
        (
          await call('call_runtime_bridge', {
            sessionId,
            method: 'get_property',
            params: { nodePath: '.', property: 'rotation' },
          })
        ).response.value,
        0,
      );
    } finally {
      if (sessionId) await call('stop_runtime_bridge', { sessionId });
      await client.close();
      await server.close();
    }
  },
);

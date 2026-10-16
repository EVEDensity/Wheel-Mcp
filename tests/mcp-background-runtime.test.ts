import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, realpath, lstat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp-server-sdk.js';
import { runRegistry } from '../src/run-registry.js';

async function connect() {
  const server = createMcpServer();
  const client = new Client({ name: 'background-runtime-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  return { server, client };
}

test('MCP launch tools advertise background defaults and retain an explicit windowed option', async () => {
  const { server, client } = await connect();
  try {
    const tools = (await client.listTools()).tools;
    for (const name of ['launch_project', 'open_runtime_bridge']) {
      const tool = tools.find((item) => item.name === name)!;
      const schema = tool.inputSchema.properties?.headless as { type?: string; default?: boolean };
      assert.equal(schema.type, 'boolean');
      assert.equal(schema.default, true);
      assert.ok(!tool.inputSchema.required?.includes('headless'));
      assert.match(tool.description!, /headless:false/);
    }
    assert.match(tools.find((item) => item.name === 'open_runtime_bridge')!.description!, /Reuse its sessionId/);
    for (const name of ['open_runtime_bridge', 'capture_runtime_screenshot']) {
      const tool = tools.find((item) => item.name === name)!;
      const schema = tool.inputSchema.properties?.background as { type?: string; default?: boolean };
      assert.equal(schema.type, 'boolean');
      assert.equal(schema.default, true);
      assert.ok(!tool.inputSchema.required?.includes('background'));
      assert.match(tool.description!, /background:false/);
    }
  } finally {
    await client.close();
    await server.close();
  }
});

const godot = process.env.GODOT_PATH ?? '';
test(
  'real MCP omitted headless uses no-display Godot and repeated RPCs retain one process and state',
  { skip: !existsSync(godot), timeout: 45000 },
  async () => {
    const parent = await realpath(os.tmpdir());
    const root = await realpath(await mkdtemp(path.join(parent, 'wheel-background-')));
    await writeFile(
      path.join(root, 'project.godot'),
      '[application]\nconfig/name="Background MCP probe"\nrun/main_scene="res://main.tscn"\n',
    );
    await writeFile(
      path.join(root, 'main.gd'),
      'extends Node2D\nvar counter: int = 0\nfunc _ready():\n\tprint("MCP_DISPLAY=" + DisplayServer.get_name())\n',
    );
    await writeFile(
      path.join(root, 'main.tscn'),
      '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="Probe" type="Node2D"]\nscript = ExtResource("1")\n',
    );
    const { server, client } = await connect();
    let sessionId = '';
    let launchPid = 0;
    let passed = false;
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return result.structuredContent as Record<string, any>;
    };
    try {
      const launch = await call('launch_project', {
        godotPath: godot,
        projectPath: root,
        evidenceDir: path.join(root, 'launch'),
      });
      launchPid = launch.pid;
      assert.ok(launch.arguments.includes('--headless'));
      for (let i = 0; i < 50; i++) {
        if ((await readFile(launch.stdout, 'utf8')).includes('MCP_DISPLAY=headless')) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.match(await readFile(launch.stdout, 'utf8'), /MCP_DISPLAY=headless/);
      assert.equal((await call('stop_project', { pid: launchPid })).stopped, true);
      launchPid = 0;
      const opened = await call('open_runtime_bridge', {
        godotPath: godot,
        projectPath: root,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        evidenceDir: path.join(root, 'bridge'),
      });
      sessionId = opened.session_id;
      assert.equal(opened.handshake.runtimeConditions.displayServer, 'headless');
      const run = runRegistry.get(sessionId)!;
      const identity = run.processIdentity;
      assert.ok(identity, 'The persistent process must have a captured OS identity');
      for (let i = 1; i <= 10; i++) {
        await call('call_runtime_bridge', {
          sessionId,
          method: 'set_property',
          params: { nodePath: '.', property: 'counter', value: i },
        });
        const read = await call('call_runtime_bridge', {
          sessionId,
          method: 'get_property',
          params: { nodePath: '.', property: 'counter' },
        });
        assert.equal(read.response.value, i);
        assert.equal(runRegistry.get(sessionId)?.pid, opened.pid);
        assert.deepEqual(runRegistry.get(sessionId)?.processIdentity, identity);
      }
      assert.equal(runRegistry.active().filter((item) => item.projectPath === root).length, 1);
      await call('stop_runtime_bridge', { sessionId });
      sessionId = '';
      const process = JSON.parse(await readFile(path.join(root, 'bridge', 'process.json'), 'utf8'));
      assert.ok(process.arguments.includes('--headless'));
      assert.equal(runRegistry.active().filter((item) => item.projectPath === root).length, 0);
      passed = true;
    } finally {
      if (sessionId) await client.callTool({ name: 'stop_runtime_bridge', arguments: { sessionId } }).catch(() => {});
      if (launchPid) await client.callTool({ name: 'stop_project', arguments: { pid: launchPid } }).catch(() => {});
      await client.close();
      await server.close();
      if (passed) {
        assert.equal(path.dirname(await realpath(root)), parent);
        assert.match(path.basename(root), /^wheel-background-[A-Za-z0-9]+$/);
        assert.equal((await lstat(root)).isSymbolicLink(), false);
        await rm(root, { recursive: true, force: false });
      }
    }
  },
);

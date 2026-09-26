import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp-server-sdk.js';
import { drainMcpOperations, McpOperationLifecycle } from '../src/mcp/operation-lifecycle.js';
import { ProjectTransactions } from '../src/project/transactions.js';
import { getProcessStatus } from '../src/godot-runtime.js';
import { enableFixtureApproval } from './helpers/project-approval.js';

test('session drain waits for cancellation convergence and rejects new requests', async () => {
  const lifecycle = new McpOperationLifecycle();
  let converged = false;
  const pending = lifecycle.run(async (signal) => {
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    converged = true;
  });
  await lifecycle.drain();
  assert.equal(converged, true);
  await pending;
  await assert.rejects(
    lifecycle.run(async () => true),
    /closing/,
  );
  await lifecycle.drain();
});

test(
  'MCP disconnect during real Godot validation stops the process, rolls back and releases the durable lock',
  {
    skip: !process.env.GODOT_PATH,
    timeout: 45000,
  },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-tx-disconnect-'));
    await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
    await writeFile(
      path.join(root, 'main.tscn'),
      '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://state.gd" id="1"]\n[node name="Main" type="Node2D"]\nscript = ExtResource("1")\n',
    );
    await writeFile(path.join(root, 'state.gd'), 'extends Node2D\nvar value = 1\n');
    const evidenceDir = path.join(root, 'evidence');
    const server = createMcpServer();
    const client = new Client(
      { name: 'disconnect-fixture', version: '1' },
      { capabilities: { elicitation: { form: {} } } },
    );
    enableFixtureApproval(client);
    const [a, b] = InMemoryTransport.createLinkedPair();
    let pid = 0;
    try {
      await server.connect(a);
      await client.connect(b);
      // Attach a rejection handler immediately: the wire closes before the server's rollback completes.
      const pending = client
        .callTool({
          name: 'dev_loop',
          arguments: {
            projectPath: root,
            godotPath: process.env.GODOT_PATH,
            bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
            evidenceDir,
            waitEvent: 'never-emitted',
            timeoutMs: 30000,
            edits: [{ path: 'state.gd', find: 'value = 1', replace: 'value = 2' }],
            checks: [{ id: 'tree', method: 'get_scene_tree', op: 'exists' }],
          },
        })
        .catch(() => undefined);
      for (let index = 0; index < 600 && !pid; index++) {
        for (const dir of await readdir(evidenceDir).catch(() => [])) {
          try {
            pid = JSON.parse(await readFile(path.join(evidenceDir, dir, 'attempt-0', 'persistent.json'), 'utf8')).pid;
          } catch {
            /* startup has not persisted the runtime identity yet */
          }
        }
        if (!pid) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(pid, 'required real Godot must start before disconnect');
      assert.match(await readFile(path.join(root, 'state.gd'), 'utf8'), /value = 2/);
      await client.close();
      await drainMcpOperations(server);
      await pending;
      assert.equal(getProcessStatus(pid).running, false);
      assert.match(await readFile(path.join(root, 'state.gd'), 'utf8'), /value = 1/);
      const tx = new ProjectTransactions({ projectPath: root, ownerId: 'local-client' });
      assert.deepEqual(
        (await tx.list()).map((item) => item.state),
        ['ROLLED_BACK'],
      );
      await assert.rejects(readFile(path.join(root, '.harness', 'transactions', '.project.lock')), /ENOENT/);
    } finally {
      await client.close();
      await drainMcpOperations(server);
      await server.close();
    }
  },
);

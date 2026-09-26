import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../src/mcp-server-sdk.js';
import { createClientPolicy } from '../src/mcp/access-policy.js';
import { EditorBridge } from '../src/editor/editor-bridge.js';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { writeFile } from 'node:fs/promises';
import { applyEditorScene } from '../src/editor/scene-service.js';
import { startEditorFixture } from './helpers/editor-fixture.js';
const real = { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 };
async function wire(
  root: string,
  approval?: (message: string) => Promise<ElicitResult>,
  scopes: ('read' | 'write')[] = ['read', 'write'],
  owner = 'local-client',
) {
  const policy = createClientPolicy({ clientId: owner, scopes, projectRoots: [root], evidenceRoots: [root] });
  const server = createMcpServer(policy);
  const client = new Client(
    { name: 'editor-write-e2e', version: '1' },
    { capabilities: approval ? { elicitation: { form: {} } } : {} },
  );
  if (approval) client.setRequestHandler(ElicitRequestSchema, (request) => approval(request.params.message));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
const operations = [
  { kind: 'create' as const, parent: '.', name: 'NewMarker', type: 'Marker2D' as const },
  {
    kind: 'set' as const,
    path: 'NewMarker',
    property: 'position' as const,
    value: { type: 'Vector2' as const, x: 8, y: 9 },
  },
];
const body = (r: Awaited<ReturnType<Client['callTool']>>) => r.structuredContent as Record<string, any>;
test('native editor MCP write requires explicit opt-in, permission and host confirmation', real, async () => {
  const fixture = await startEditorFixture(process.env.GODOT_PATH!);
  const connection = await wire(fixture.root, async () => ({ action: 'accept', content: { confirm: true } }));
  try {
    const r = await connection.client.callTool({
      name: 'apply_editor_scene',
      arguments: { projectPath: fixture.root, operations, approved: true },
    });
    assert.equal(body(r).code, 'FORBIDDEN');
    assert.equal(await readFile(path.join(fixture.root, 'main.tscn'), 'utf8'), fixture.scene);
  } finally {
    await connection.close();
    await fixture.stop();
  }
});
test('native editor MCP exact approved batch is unsaved, owner-bound, queryable and idempotent', real, async () => {
  const fixture = await startEditorFixture(process.env.GODOT_PATH!, { writeEnabled: true });
  let confirmations = 0;
  const connection = await wire(fixture.root, async (message) => {
    confirmations++;
    assert.match(message, /NewMarker/);
    assert.match(message, /source SHA-256/);
    return { action: 'accept', content: { confirm: true } };
  });
  try {
    const args = { projectPath: fixture.root, operations, operationId: 'one-batch' };
    const r = await connection.client.callTool({ name: 'apply_editor_scene', arguments: args });
    assert.notEqual(r.isError, true, JSON.stringify(r));
    assert.equal(body(r).undoSteps, 1);
    assert.equal(body(r).persisted, false);
    const bridge = await EditorBridge.connect({ projectPath: fixture.root, ownerId: 'local-client' });
    try {
      assert.ok((await bridge.snapshot()).sceneTree.nodes.some((n) => n.path === 'NewMarker' && n.owner === '.'));
    } finally {
      bridge.close();
    }
    const replay = await connection.client.callTool({ name: 'apply_editor_scene', arguments: args });
    assert.notEqual(replay.isError, true, JSON.stringify(replay));
    assert.equal(body(replay).replayed, true);
    assert.equal(confirmations, 1);
    const conflict = await connection.client.callTool({
      name: 'apply_editor_scene',
      arguments: { ...args, operations: [{ ...operations[0], name: 'Different' }] },
    });
    assert.equal(body(conflict).code, 'CONFLICT');
    const status = await connection.client.callTool({
      name: 'get_editor_scene_operation',
      arguments: { projectPath: fixture.root, operationId: 'one-batch', sessionId: fixture.endpoint.sessionId },
    });
    assert.equal(body(status).operationState, 'COMPLETED');
    const other = await wire(fixture.root, undefined, ['read'], 'stdio-local');
    try {
      const missing = await other.client.callTool({
        name: 'get_editor_scene_operation',
        arguments: { projectPath: fixture.root, operationId: 'one-batch', sessionId: fixture.endpoint.sessionId },
      });
      assert.equal(body(missing).operationState, 'NOT_FOUND');
    } finally {
      await other.close();
    }
    assert.equal(await readFile(path.join(fixture.root, 'main.tscn'), 'utf8'), fixture.scene);
  } finally {
    await connection.close();
    await fixture.stop();
  }
});
test(
  'decline, absent confirmation, wrong approval binding and read-only policy never modify the editor',
  real,
  async () => {
    const fixture = await startEditorFixture(process.env.GODOT_PATH!, { writeEnabled: true });
    try {
      for (const [approval, scopes] of [
        [undefined, ['read', 'write']],
        [async () => ({ action: 'decline' }), ['read', 'write']],
        [async () => ({ action: 'accept', content: { confirm: true } }), ['read']],
      ] as [((m: string) => Promise<ElicitResult>) | undefined, ('read' | 'write')[]][]) {
        const c = await wire(fixture.root, approval, scopes);
        try {
          const r = await c.client.callTool({
            name: 'apply_editor_scene',
            arguments: { projectPath: fixture.root, operations },
          });
          assert.equal(body(r).code, 'FORBIDDEN');
        } finally {
          await c.close();
        }
      }
      await assert.rejects(
        applyEditorScene({
          projectPath: fixture.root,
          ownerId: 'local-client',
          operations,
          approve: async () => ({ actor: 'intruder', planHash: '0'.repeat(64), receipt: 'forged' }),
        }),
        { code: 'FORBIDDEN' },
      );
      const bridge = await EditorBridge.connect({ projectPath: fixture.root, ownerId: 'local-client' });
      try {
        assert.ok(!(await bridge.snapshot()).sceneTree.nodes.some((n) => n.path === 'NewMarker'));
      } finally {
        bridge.close();
      }
    } finally {
      await fixture.stop();
    }
  },
);
test('editor close during approval yields no commit, and later query never pretends rollback', real, async () => {
  const fixture = await startEditorFixture(process.env.GODOT_PATH!, { writeEnabled: true });
  const c = await wire(fixture.root, async () => {
    await fixture.stop();
    return { action: 'accept', content: { confirm: true } };
  });
  try {
    const r = await c.client.callTool({
      name: 'apply_editor_scene',
      arguments: { projectPath: fixture.root, operations, operationId: 'closed-editor' },
    });
    assert.equal(r.isError, true);
    assert.ok(['ENGINE_UNAVAILABLE', 'UNKNOWN'].includes(body(r).code));
    const status = await c.client.callTool({
      name: 'get_editor_scene_operation',
      arguments: { projectPath: fixture.root, operationId: 'closed-editor', sessionId: fixture.endpoint.sessionId },
    });
    assert.equal(body(status).code, 'UNKNOWN');
    assert.equal(await readFile(path.join(fixture.root, 'main.tscn'), 'utf8'), fixture.scene);
  } finally {
    await c.close();
    await fixture.stop();
  }
});
test('real MCP preserves a human edit and a changed source during exact approval', real, async () => {
  for (const mode of ['document', 'disk']) {
    const f = await startEditorFixture(process.env.GODOT_PATH!, { writeEnabled: true });
    const c = await wire(f.root, async () => {
      if (mode === 'document') await f.command('human-move');
      else await writeFile(path.join(f.root, 'main.tscn'), f.scene + '; human disk change\n');
      return { action: 'accept', content: { confirm: true } };
    });
    try {
      const r = await c.client.callTool({ name: 'apply_editor_scene', arguments: { projectPath: f.root, operations } });
      assert.equal(body(r).code, 'CONFLICT', JSON.stringify(r));
      const bridge = await EditorBridge.connect({ projectPath: f.root, ownerId: 'local-client' });
      try {
        assert.ok(!(await bridge.snapshot()).sceneTree.nodes.some((n) => n.path === 'NewMarker'));
      } finally {
        bridge.close();
      }
      assert.equal(
        await readFile(path.join(f.root, 'main.tscn'), 'utf8'),
        mode === 'disk' ? f.scene + '; human disk change\n' : f.scene,
      );
    } finally {
      await c.close();
      await f.stop();
    }
  }
});
test('real MCP instantiation participates in native Undo/Redo and preserves internal owner', real, async () => {
  const component =
    '[gd_scene format=3]\n[node name="Component" type="Node2D"]\n[node name="Tip" type="Marker2D" parent="."]\n';
  const f = await startEditorFixture(process.env.GODOT_PATH!, {
    writeEnabled: true,
    files: { 'component.tscn': component },
  });
  const c = await wire(f.root, async () => ({ action: 'accept', content: { confirm: true } }));
  try {
    const r = await c.client.callTool({
      name: 'apply_editor_scene',
      arguments: {
        projectPath: f.root,
        operations: [
          {
            kind: 'instantiate',
            parent: '.',
            name: 'Instance',
            scenePath: 'res://component.tscn',
            sourceHash: createHash('sha256').update(component).digest('hex'),
            policy: 'preserve',
          },
        ],
      },
    });
    assert.notEqual(r.isError, true, JSON.stringify(r));
    for (const [action, present] of [
      ['undo', false],
      ['redo', true],
    ] as const) {
      await f.command(action);
      const b = await EditorBridge.connect({ projectPath: f.root, ownerId: 'local-client' });
      try {
        const nodes = (await b.snapshot()).sceneTree.nodes;
        assert.equal(
          nodes.some((n) => n.path === 'Instance'),
          present,
        );
        if (present) assert.ok(nodes.some((n) => n.path === 'Instance/Tip' && n.owner === 'Instance'));
      } finally {
        b.close();
      }
    }
    assert.equal(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), f.scene);
    assert.ok(!f.output().includes('ERROR:'), f.output());
  } finally {
    await c.close();
    await f.stop();
  }
});
test(
  'read connector token cannot authorize raw native write and disconnected submitted results remain queryable',
  real,
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, { writeEnabled: true });
    const socket = net.createConnection({ host: '127.0.0.1', port: f.endpoint.port });
    let buffer = '';
    const replies = new Map<string, any>();
    socket.on('data', (bytes) => {
      buffer += bytes.toString();
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const r = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        replies.set(r.id, r);
      }
    });
    const send = (id: string, method: string, params: Record<string, unknown>) =>
      socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    const wait = async (id: string) => {
      for (let i = 0; i < 200; i++) {
        if (replies.has(id)) return replies.get(id);
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error('RPC timed out');
    };
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });
      send('hello', 'editor.hello', { ...f.endpoint, clientId: 'local-client', token: f.token });
      await wait('hello');
      send('forged', 'scene.prepare', {
        operationId: 'raw',
        operations,
        sessionId: f.endpoint.sessionId,
        authority: f.token,
        approved: true,
      });
      assert.equal((await wait('forged')).error.data.code, 'FORBIDDEN');
      const b = await EditorBridge.connect({ projectPath: f.root, ownerId: 'local-client' });
      const p = (await b.sceneRequest('scene.prepare', { operationId: 'disconnect', operations })) as any;
      const commit = b.sceneRequest('scene.commit', {
        operationId: 'disconnect',
        planId: p.planId,
        planHash: p.planHash,
      });
      b.close();
      await assert.rejects(commit, { code: 'UNKNOWN' });
      const retry = await EditorBridge.connect({ projectPath: f.root, ownerId: 'local-client' });
      try {
        const status = (await retry.sceneRequest('scene.status', { operationId: 'disconnect' })) as any;
        assert.ok(['PREPARED', 'COMPLETED'].includes(status.operationState), JSON.stringify(status));
        if (status.operationState === 'COMPLETED') assert.equal(status.result.undoSteps, 1);
      } finally {
        retry.close();
      }
    } finally {
      socket.destroy();
      await f.stop();
    }
  },
);

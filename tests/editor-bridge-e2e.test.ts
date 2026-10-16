import test from 'node:test';
import { fixtureStdioEnv } from './helpers/stdio-fixture.js';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile, symlink, mkdir } from 'node:fs/promises';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createClientPolicy } from '../src/mcp/access-policy.js';
import { TimeoutError } from '../src/timeout.js';
import { EditorBridge } from '../src/editor/editor-bridge.js';
import { startEditorFixture, waitUntil } from './helpers/editor-fixture.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createMcpServer } from '../src/mcp-server-sdk.js';

test('editor query without an enabled editor fails ENGINE_UNAVAILABLE, never launches a runtime substitute', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-no-editor-'));
  const server = createMcpServer();
  const client = new Client({ name: 'editor-unavailable-fixture', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const result = await client.callTool({ name: 'get_editor_state', arguments: { projectPath: root } });
    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as Record<string, unknown>)?.code, 'ENGINE_UNAVAILABLE');
  } finally {
    await client.close();
    await server.close();
  }
});

type Reply = { id: string; result?: any; error?: { data: { code: string } } };
async function wire(fixture: Awaited<ReturnType<typeof startEditorFixture>>) {
  const socket = net.createConnection({ host: '127.0.0.1', port: fixture.endpoint.port });
  const replies = new Map<string, Reply>();
  let buffer = '';
  let closed = false;
  socket.on('data', (bytes) => {
    buffer += bytes.toString();
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const reply = JSON.parse(buffer.slice(0, newline)) as Reply;
      buffer = buffer.slice(newline + 1);
      replies.set(reply.id, reply);
    }
  });
  socket.on('error', () => {
    closed = true;
  });
  socket.on('close', () => {
    closed = true;
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return {
    socket,
    replies,
    closed: () => closed,
    send(messages: Record<string, unknown>[]) {
      socket.write(messages.map((message) => JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n').join(''));
    },
    reply(id: string) {
      return waitUntil(async () => {
        const reply = replies.get(id);
        if (!reply && closed) throw new Error('Wire closed before reply');
        return reply;
      }, 5000);
    },
    hello(overrides: Record<string, unknown> = {}) {
      return {
        protocolVersion: fixture.endpoint.protocolVersion,
        plane: 'editor',
        projectPath: fixture.config.projectPath,
        projectId: fixture.config.projectId,
        sessionId: fixture.endpoint.sessionId,
        clientId: 'local-client',
        token: fixture.token,
        ...overrides,
      };
    },
  };
}

const realEditor = { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 };
test(
  'real editor query through the actual stdio entry binds stdio-local and MCP shutdown leaves editor alive',
  realEditor,
  async () => {
    const fixture = await startEditorFixture(process.env.GODOT_PATH!);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('build/src/mcp-server-sdk.js')],
      stderr: 'pipe',
      env: {
        ...fixtureStdioEnv(),
        MCP_STDIO_PROJECT_ROOTS: fixture.root,
        MCP_STDIO_EVIDENCE_ROOTS: fixture.root,
        MCP_STDIO_SCOPES: 'read',
      },
    });
    const client = new Client({ name: 'editor-stdio-fixture', version: '1' });
    let stderr = '';
    transport.stderr?.on('data', (bytes: Buffer) => {
      stderr += bytes.toString();
    });
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: 'get_editor_state',
        arguments: { projectPath: fixture.root, responseMode: 'compact' },
      });
      assert.notEqual(result.isError, true, stderr);
      const body = JSON.parse((result.content as { text: string }[])[0].text);
      assert.equal(body.plane, 'editor');
      assert.equal(body.sessionId, fixture.endpoint.sessionId);
      assert.equal(body.dirty.status, 'KNOWN');
      assert.equal(body.persisted, false);
      assert.equal(body.validation, 'NOT_RUN');
      await client.close();
      const bridge = await EditorBridge.connect({ projectPath: fixture.root, ownerId: 'local-client' });
      try {
        assert.equal((await bridge.snapshot()).sessionId, fixture.endpoint.sessionId);
      } finally {
        bridge.close();
      }
    } finally {
      await client.close();
      await fixture.stop();
    }
  },
);
test(
  'real editor rejects unauthenticated, wrong-token, owner, project, version, plane and stale-session clients',
  realEditor,
  async () => {
    const fixture = await startEditorFixture(process.env.GODOT_PATH!);
    const peer = await wire(fixture);
    try {
      peer.send([{ id: 'pre-auth', method: 'get_editor_state', params: {} }]);
      assert.equal((await peer.reply('pre-auth')).error?.data.code, 'FORBIDDEN');
      const negatives: [Record<string, unknown>, string][] = [
        [{ token: '0'.repeat(64) }, 'FORBIDDEN'],
        [{ clientId: 'intruder' }, 'FORBIDDEN'],
        [{ projectId: 'other' }, 'FORBIDDEN'],
        [{ projectPath: fixture.root + '-other' }, 'FORBIDDEN'],
        [{ protocolVersion: 'wheel-editor/999' }, 'PROTOCOL_MISMATCH'],
        [{ plane: 'runtime' }, 'PROTOCOL_MISMATCH'],
        [{ sessionId: '0'.repeat(32) }, 'FORBIDDEN'],
      ];
      for (const [index, [override, code]] of negatives.entries()) {
        const id = 'negative-' + index;
        peer.send([{ id, method: 'editor.hello', params: peer.hello(override) }]);
        const reply = await peer.reply(id);
        assert.equal(reply.error?.data.code, code);
        assert.ok(!JSON.stringify(reply).includes(fixture.token));
      }
      peer.send([
        { id: 'good', method: 'editor.hello', params: peer.hello() },
        { id: 'unknown', method: 'arbitrary_mutation', params: {} },
      ]);
      const good = await peer.reply('good');
      assert.equal(good.result.plane, 'editor');
      assert.ok(!JSON.stringify(good).includes(fixture.token));
      assert.equal((await peer.reply('unknown')).error?.data.code, 'UNSUPPORTED');
      await assert.rejects(EditorBridge.connect({ projectPath: fixture.root, ownerId: 'intruder' }), {
        code: 'FORBIDDEN',
      });
      const endpointFile = path.join(fixture.root, '.harness/editor-endpoint.json');
      for (const [override, code] of [
        [{ godotVersion: '4.6.stable' }, 'UNSUPPORTED'],
        [{ projectId: 'other' }, 'FORBIDDEN'],
        [{ plane: 'runtime' }, 'PROTOCOL_MISMATCH'],
      ] as const) {
        await writeFile(endpointFile, JSON.stringify({ ...fixture.endpoint, ...override }));
        await assert.rejects(EditorBridge.connect({ projectPath: fixture.root, ownerId: 'local-client' }), { code });
      }
      await writeFile(endpointFile, JSON.stringify(fixture.endpoint));
    } finally {
      peer.socket.destroy();
      await fixture.stop();
    }
  },
);

test(
  'real editor queue reports busy, cancellation acknowledgement, invalid limits and queued deadline expiry',
  realEditor,
  async () => {
    const fixture = await startEditorFixture(process.env.GODOT_PATH!);
    const peer = await wire(fixture);
    try {
      peer.send([{ id: 'auth', method: 'editor.hello', params: peer.hello() }]);
      await peer.reply('auth');
      const reads = Array.from({ length: 20 }, (_, i) => ({
        id: 'queued-' + i,
        method: 'get_editor_state',
        params: { limit: 10 },
        timeoutMs: 1,
      }));
      peer.send([...reads, { id: 'cancel', method: 'editor.cancel', params: { requestId: 'queued-15' } }]);
      assert.equal((await peer.reply('queued-15')).error?.data.code, 'CANCELLED');
      assert.deepEqual((await peer.reply('cancel')).result, { cancelled: true, state: 'CANCELLED' });
      const results = await Promise.all(reads.map((read) => peer.reply(read.id)));
      assert.ok(results.some((reply) => reply.error?.data.code === 'CONFLICT'));
      assert.ok(results.some((reply) => reply.error?.data.code === 'TIMEOUT'));
      peer.send([
        { id: 'invalid', method: 'get_editor_state', params: { limit: 101 } },
        { id: 'default', method: 'get_editor_state', params: {} },
        { id: 'not-pending', method: 'editor.cancel', params: { requestId: 'already-gone' } },
      ]);
      assert.equal((await peer.reply('invalid')).error?.data.code, 'INVALID_ARGUMENT');
      assert.equal((await peer.reply('default')).result.mainThread, true);
      assert.equal((await peer.reply('not-pending')).result.state, 'NOT_PENDING');
    } finally {
      peer.socket.destroy();
      await fixture.stop();
    }
  },
);

test(
  'real editor is read-only through official MCP SDK and transport authorization cannot be overridden in args',
  realEditor,
  async () => {
    const fixture = await startEditorFixture(process.env.GODOT_PATH!);
    const check = async (clientId: string, scopes: ('read' | 'run')[], projectRoots: string[], code?: string) => {
      const server = createMcpServer(createClientPolicy({ clientId, scopes, projectRoots, evidenceRoots: [] }));
      const client = new Client({ name: 'editor-policy-fixture', version: '1' });
      const [a, b] = InMemoryTransport.createLinkedPair();
      try {
        await server.connect(a);
        await client.connect(b);
        const result = await client.callTool({
          name: 'get_editor_state',
          arguments: { projectPath: fixture.root, clientId: 'local-client', ownerId: 'local-client' },
        });
        const content = JSON.parse((result.content as { text: string }[])[0].text);
        if (code) {
          assert.equal(result.isError, true);
          assert.equal(content.code, code);
        } else {
          assert.notEqual(result.isError, true);
          assert.equal(content.plane, 'editor');
          assert.equal(content.validation, 'NOT_RUN');
        }
        assert.ok(!JSON.stringify(result).includes(fixture.token));
      } finally {
        await client.close();
        await server.close();
      }
    };
    try {
      await check('local-client', ['read'], [fixture.root]);
      await check('intruder', ['read'], [fixture.root], 'FORBIDDEN');
      await check('local-client', ['run'], [fixture.root], 'FORBIDDEN');
      await check('local-client', ['read'], [], 'FORBIDDEN');
    } finally {
      await fixture.stop();
    }
  },
);

test(
  'real plugin disable closes pending reads and listener; re-enable changes identity and opt-out prevents listening',
  realEditor,
  async () => {
    const fixture = await startEditorFixture(process.env.GODOT_PATH!);
    let bridge: EditorBridge | undefined;
    const peer = await wire(fixture);
    try {
      bridge = await EditorBridge.connect({ projectPath: fixture.root, ownerId: 'local-client' });
      const cancelled = new AbortController();
      cancelled.abort();
      await assert.rejects(bridge.snapshot({ signal: cancelled.signal }), { code: 'CANCELLED' });
      const deadline = new AbortController();
      deadline.abort(new TimeoutError());
      await assert.rejects(bridge.snapshot({ signal: deadline.signal }), { code: 'TIMEOUT' });
      await assert.rejects(
        EditorBridge.connect({ projectPath: fixture.root, ownerId: 'local-client', signal: deadline.signal }),
        { code: 'TIMEOUT' },
      );
      peer.send([{ id: 'auth', method: 'editor.hello', params: peer.hello() }]);
      await peer.reply('auth');
      // One read per editor frame; another TEST-ONLY plugin disables via public API.
      const activeCancel = new AbortController();
      const activeRead = bridge.snapshot({ signal: activeCancel.signal });
      activeCancel.abort();
      await assert.rejects(
        activeRead,
        (error: any) => error.code === 'CANCELLED' && error.details.cancellation === 'REQUESTED_NOT_CONFIRMED',
      );
      const activeDeadline = new AbortController();
      const timedRead = bridge.snapshot({ signal: activeDeadline.signal });
      activeDeadline.abort(new TimeoutError());
      await assert.rejects(timedRead, { code: 'TIMEOUT' });
      assert.equal((await bridge.snapshot()).plane, 'editor');
      // Do not fill the global queue from another peer: that only proves CONFLICT.
      // Wait for the first real response so remaining reads are in this editor queue.
      const reads = Array.from({ length: 16 }, () => bridge!.snapshot());
      const pendingReads = Promise.allSettled(reads);
      await reads[0];
      await fixture.command('disable');
      assert.ok(
        (await pendingReads).some(
          (result) => result.status === 'rejected' && result.reason.code === 'ENGINE_UNAVAILABLE',
        ),
      );
      await waitUntil(async () => (peer.closed() ? true : undefined));
      assert.equal(existsSync(path.join(fixture.root, '.harness/editor-endpoint.json')), false);
      await assert.rejects(bridge.snapshot(), { code: 'ENGINE_UNAVAILABLE' });
      await assert.rejects(EditorBridge.connect({ projectPath: fixture.root, ownerId: 'local-client' }), {
        code: 'ENGINE_UNAVAILABLE',
      });
      await assert.rejects(wire(fixture), (error: any) => error.code === 'ECONNREFUSED');
      await fixture.command('enable');
      const next = await waitUntil(fixture.readEndpoint);
      assert.notEqual(next.sessionId, fixture.endpoint.sessionId);
      await fixture.command('disable');
      const configFile = path.join(fixture.root, '.harness/editor-bridge.json');
      await writeFile(configFile, JSON.stringify({ ...fixture.config, authorized: false }));
      await fixture.command('enable');
      assert.equal(existsSync(path.join(fixture.root, '.harness/editor-endpoint.json')), false);
      await assert.rejects(EditorBridge.connect({ projectPath: fixture.root, ownerId: 'local-client' }), {
        code: 'FORBIDDEN',
      });
      await writeFile(configFile, JSON.stringify({ ...fixture.config, enabled: false }));
      await assert.rejects(EditorBridge.connect({ projectPath: fixture.root, ownerId: 'local-client' }), {
        code: 'ENGINE_UNAVAILABLE',
      });
      assert.equal(await readFile(path.join(fixture.root, 'main.tscn'), 'utf8'), fixture.scene);
      assert.ok(!fixture.output().includes('SCRIPT ERROR'), fixture.output());
    } finally {
      bridge?.close();
      peer.socket.destroy();
      await fixture.stop();
    }
  },
);

test('editor connector rejects linked private metadata rather than following it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-editor-link-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'wheel-editor-private-'));
  await mkdir(path.join(outside, 'private'));
  await symlink(
    path.join(outside, 'private'),
    path.join(root, '.harness'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(EditorBridge.connect({ projectPath: root, ownerId: 'local-client' }), { code: 'FORBIDDEN' });
});

test(
  'real editor bounds malformed frames and a second editor cannot replace its endpoint or lease',
  realEditor,
  async () => {
    const fixture = await startEditorFixture(process.env.GODOT_PATH!);
    const peer = await wire(fixture);
    let bridge: EditorBridge | undefined;
    try {
      peer.socket.write('not-json\n');
      await waitUntil(async () => (peer.closed() ? true : undefined));
      const oversized = await wire(fixture);
      try {
        oversized.socket.write('x'.repeat(65538));
        await waitUntil(async () => (oversized.closed() ? true : undefined));
      } finally {
        oversized.socket.destroy();
      }
      bridge = await EditorBridge.connect({ projectPath: fixture.root, ownerId: 'local-client' });
      // Even a competing editor must use the fixture's self-contained profile,
      // not the installed engine's global editor settings.
      const isolatedGodot = path.join(fixture.root, '.harness/engine', path.basename(process.env.GODOT_PATH!));
      assert.ok(existsSync(path.join(path.dirname(isolatedGodot), '_sc_')));
      await promisify(execFile)(
        isolatedGodot,
        [
          '--headless',
          '--editor',
          '--path',
          fixture.root,
          '--quit-after',
          '30',
          '--log-file',
          path.join(fixture.root, 'second-editor.log'),
        ],
        { windowsHide: true, timeout: 30000 },
      );
      const endpoint = await fixture.readEndpoint();
      assert.equal(endpoint?.sessionId, fixture.endpoint.sessionId);
      assert.equal((await bridge.snapshot()).sessionId, fixture.endpoint.sessionId);
      assert.equal(existsSync(path.join(fixture.root, '.harness/editor-lease')), true);
      await fixture.command('disable');
      assert.equal(existsSync(path.join(fixture.root, '.harness/editor-lease')), false);
      assert.equal(existsSync(path.join(fixture.root, '.harness/editor-endpoint.json')), false);
    } finally {
      peer.socket.destroy();
      bridge?.close();
      await fixture.stop();
    }
  },
);

test(
  'real enabled editor reads scene, dirty state, selection and filesystem without saving or running a game',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 },
  async () => {
    const fixture = await startEditorFixture(process.env.GODOT_PATH!);
    let bridge: EditorBridge | undefined;
    try {
      bridge = await EditorBridge.connect({ projectPath: fixture.root, ownerId: 'local-client' });
      const state = await waitUntil(async () => {
        const value = await bridge!.snapshot();
        return value.currentScene ? value : undefined;
      });
      assert.equal(state.currentScene?.path, 'res://main.tscn');
      assert.equal(state.plane, 'editor');
      assert.equal(state.runtime, false);
      assert.equal(state.source, 'REAL');
      assert.equal(state.mainThread, true);
      assert.deepEqual(state.dirty.scenes, []);
      assert.equal(state.sceneTree.nodes.find((node) => node.path === 'Marker')?.owner, '.');
      const bounded = await bridge.snapshot({ limit: 1 });
      assert.equal(bounded.sceneTree.nodes.length, 1);
      assert.equal(bounded.sceneTree.truncated, true);
      await fixture.command('dirty-select');
      const changed = await bridge.snapshot();
      assert.deepEqual(changed.selection, [{ path: 'Marker', type: 'Node2D' }]);
      assert.deepEqual(changed.dirty.scenes, ['res://main.tscn']);
      assert.equal(changed.persisted, false);
      assert.equal(changed.validation, 'NOT_RUN');
      assert.equal(await readFile(path.join(fixture.root, 'main.tscn'), 'utf8'), fixture.scene);
      assert.equal(await readFile(path.join(fixture.root, 'project.godot'), 'utf8'), fixture.project);
      assert.ok(!fixture.output().includes('SCRIPT ERROR'), fixture.output());
    } finally {
      bridge?.close();
      await fixture.stop();
    }
  },
);

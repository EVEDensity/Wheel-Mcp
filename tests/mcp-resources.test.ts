import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp-server-sdk.js';
import { createClientPolicy } from '../src/mcp/access-policy.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer as createNetServer } from 'node:net';
import { startStreamableHttpServer } from '../src/transports/streamable-http.js';
import { drainMcpOperations } from '../src/mcp/operation-lifecycle.js';
function resourceText(contents: { uri: string; text?: string }[]) {
  assert.equal(typeof contents[0].text, 'string');
  return contents[0].text!;
}

test('official SDK resources are opaque, session-owned, refreshed and byte-bounded including outer wrapper', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-resources-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  await writeFile(
    path.join(root, 'main.tscn'),
    '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://missing.gd" id="1"]\n[node name="Root" type="Node"]\n',
  );
  await writeFile(
    path.join(root, 'main.gd'),
    'extends Node\n' + Array.from({ length: 1600 }, (_, n) => `var symbol_${n} = ${n}`).join('\n'),
  );
  const policy = createClientPolicy({
    clientId: 'resource-reader',
    scopes: ['read'],
    projectRoots: [root],
    evidenceRoots: [root],
  });
  async function connect() {
    const server = createMcpServer(policy);
    const client = new Client({ name: 'resources', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    return { server, client };
  }
  const first = await connect(),
    second = await connect();
  try {
    assert.equal(first.client.getServerCapabilities()!.resources!.subscribe, undefined);
    const list = await first.client.listResources();
    assert.equal(list.resources.length, 5);
    assert.equal(list.nextCursor, undefined);
    assert.ok(!JSON.stringify(list).includes(root));
    const templates = await first.client.listResourceTemplates();
    assert.equal(templates.resourceTemplates.length, 6);
    for (const view of ['nodes', 'diagnostics', 'dependencies']) {
      const resourceUri = list.resources.find((item) => item.uri.endsWith(`/${view}`))!.uri;
      const body = JSON.parse(resourceText((await first.client.readResource({ uri: resourceUri })).contents));
      assert.equal(body.analysisLevel, 'lexical');
      assert.equal(body.safeRefactor, false);
      if (view === 'nodes') assert.equal(body.data[0].name, 'Root');
      if (view === 'diagnostics') {
        assert.equal(body.data.engineValidation, 'NOT_RUN');
        assert.equal(body.data.unresolved[0].reason, 'missing-project-resource');
      }
      if (view === 'dependencies') assert.equal(body.data.unresolved[0].target, 'res://missing.gd');
    }
    const uri = list.resources.find((item) => item.uri.endsWith('/symbols'))!.uri;
    await assert.rejects(second.client.readResource({ uri }), /foreign/);
    let page = await first.client.readResource({ uri });
    const chunks: string[] = [];
    let foreignPage: string | undefined;
    for (;;) {
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 32768);
      const body = JSON.parse(resourceText(page.contents));
      assert.equal(body.encoding, 'json');
      chunks.push(body.chunk);
      if (!body.resourceContinuation) break;
      foreignPage ??= body.resourceContinuation;
      page = await first.client.readResource({ uri: body.resourceContinuation });
    }
    const whole = JSON.parse(chunks.join(''));
    assert.equal(whole.data.length, 1600);
    assert.equal(whole.data[1599].name, 'symbol_1599');
    await assert.rejects(second.client.readResource({ uri: foreignPage! }), /foreign/);
    const permittedRoots = policy.projectRoots;
    policy.projectRoots = [];
    await assert.rejects(first.client.readResource({ uri: foreignPage! }), /disabled|authorized/);
    policy.projectRoots = permittedRoots;
    const summaryUri = list.resources.find((item) => item.uri.endsWith('/summary'))!.uri;
    const old = JSON.parse(resourceText((await first.client.readResource({ uri: summaryUri })).contents));
    await writeFile(path.join(root, 'new.gd'), 'extends Node\n');
    const updated = JSON.parse(resourceText((await first.client.readResource({ uri: summaryUri })).contents));
    assert.notEqual(updated.sourceHash, old.sourceHash);
    assert.equal(updated.data.fileCount, 4);
    policy.scopes = new Set();
    assert.deepEqual((await first.client.listResources()).resources, []);
    await assert.rejects(first.client.readResource({ uri: foreignPage! }), /Read permission/);
    policy.scopes = new Set(['read']);
    await drainMcpOperations(first.server);
    await assert.rejects(first.client.readResource({ uri: summaryUri }), /closing/);
  } finally {
    await first.client.close();
    await first.server.close();
    await second.client.close();
    await second.server.close();
  }
});

test('official HTTP client discovers and reads resources and prompts through authenticated session transport', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-resources-http-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${port}`;
  const instance = await startStreamableHttpServer(
    {
      host: '127.0.0.1',
      port,
      path: '/mcp',
      allowedOrigins: [origin],
      allowedHosts: [`127.0.0.1:${port}`],
      requestTimeoutMs: 10000,
      clients: [
        {
          token: 'discovery-test-token',
          clientId: 'discovery-http',
          scopes: ['read'],
          projectRoots: [root],
          evidenceRoots: [root],
        },
      ],
    },
    createMcpServer,
  );
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { Authorization: 'Bearer discovery-test-token', Origin: origin } },
  });
  const client = new Client({ name: 'discovery-http', version: '1' });
  try {
    await client.connect(transport);
    const resources = await client.listResources();
    assert.equal(resources.resources.length, 5);
    const uri = resources.resources.find((resource) => resource.uri.endsWith('/summary'))!.uri;
    const body = JSON.parse(resourceText((await client.readResource({ uri })).contents));
    assert.equal(body.data.fileCount, 1);
    assert.equal((await client.listResourceTemplates()).resourceTemplates.length, 6);
    assert.equal((await client.listPrompts()).prompts.length, 4);
    const prompt = await client.getPrompt({
      name: 'verify_candidate',
      arguments: { task: 'Read only', acceptance: 'No writes' },
    });
    assert.equal(prompt.messages.length, 2);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    await instance.close();
  }
});

test('catalog omits non-project and unauthorized roots; foreign IDs cannot select arbitrary paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-resources-root-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'wheel-resources-denied-'));
  await writeFile(path.join(outside, 'project.godot'), '[application]\n');
  const policy = createClientPolicy({
    clientId: 'bounded',
    scopes: ['read'],
    projectRoots: [root],
    evidenceRoots: [root],
  });
  const server = createMcpServer(policy, { resourceProjects: [root, outside] });
  const client = new Client({ name: 'resources', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    assert.deepEqual((await client.listResources()).resources, []);
    await assert.rejects(client.readResource({ uri: 'wheel://projects/../../summary' }));
    await assert.rejects(client.readResource({ uri: 'wheel://projects/unknown/summary' }));
  } finally {
    await client.close();
    await server.close();
  }
  assert.throws(() => createMcpServer(policy, { resourceProjects: ['relative'] }), /explicit project roots/);
});

test('standard catalog pages are bounded and cursors cannot cross sessions', async () => {
  const roots: string[] = [];
  for (let n = 0; n < 7; n++) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-catalog-page-'));
    await writeFile(path.join(root, 'project.godot'), '[application]\n');
    roots.push(root);
  }
  async function connect() {
    const server = createMcpServer(undefined, { resourceProjects: roots });
    const client = new Client({ name: 'catalog', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    return { server, client };
  }
  const first = await connect(),
    second = await connect();
  try {
    const page = await first.client.listResources();
    assert.equal(page.resources.length, 32);
    assert.ok(page.nextCursor);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 32768);
    const last = await first.client.listResources({ cursor: page.nextCursor });
    assert.equal(last.resources.length, 3);
    assert.equal(last.nextCursor, undefined);
    await assert.rejects(second.client.listResources({ cursor: page.nextCursor }), /foreign/);
    await assert.rejects(first.client.listResources({ cursor: 'bad' }), /cursor/);
  } finally {
    await first.client.close();
    await first.server.close();
    await second.client.close();
    await second.server.close();
  }
});

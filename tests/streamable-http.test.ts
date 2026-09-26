import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { createMcpServer } from '../src/mcp-server-sdk.js';
import {
  readStreamableHttpConfig,
  startStreamableHttpServer,
  type StreamableHttpConfig,
} from '../src/transports/streamable-http.js';

type HttpResponse = { status: number; headers: Record<string, string | undefined>; body: string };

test('Streamable HTTP authenticates, validates origin, and isolates sessions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-http-'));
  const projectRoot = path.join(root, 'projects');
  const evidenceRoot = path.join(root, 'evidence');
  const port = await unusedPort();
  const config: StreamableHttpConfig = {
    host: '127.0.0.1',
    port,
    path: '/mcp',
    allowedOrigins: [`http://127.0.0.1:${port}`],
    allowedHosts: [`127.0.0.1:${port}`],
    requestTimeoutMs: 5000,
    clients: [
      {
        token: 'token-a',
        clientId: 'client-a',
        scopes: ['read', 'run', 'write'],
        projectRoots: [projectRoot],
        evidenceRoots: [evidenceRoot],
      },
      {
        token: 'token-b',
        clientId: 'client-b',
        scopes: ['read'],
        projectRoots: [projectRoot],
        evidenceRoots: [evidenceRoot],
      },
    ],
  };
  const instance = await startStreamableHttpServer(config, createMcpServer);
  const base = `http://${config.host}:${port}${config.path}`;
  const common = { Authorization: 'Bearer token-a', Origin: config.allowedOrigins[0] };
  try {
    assert.equal((await post(base, { headers: { Origin: config.allowedOrigins[0] } })).status, 401);
    assert.equal((await post(base, { headers: { ...common, Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await post(base, { headers: { ...common, Origin: 'http://evil.test' } })).status, 403);
    assert.equal((await post(base, { headers: { ...common, Host: 'evil.test' } })).status, 403);

    const initialized = await post(base, { headers: common, body: initializeRequest(1) });
    assert.equal(initialized.status, 200, initialized.body);
    const sessionId = initialized.headers['mcp-session-id'];
    assert.ok(sessionId);
    assert.equal(JSON.parse(initialized.body).result.serverInfo.name, 'wheel-mcp');

    const listed = await post(base, {
      headers: { ...common, 'Mcp-Session-Id': sessionId, 'Mcp-Protocol-Version': '2025-03-26' },
      body: rpcRequest(2, 'tools/list', {}),
    });
    assert.equal(listed.status, 200, listed.body);
    assert.ok(JSON.parse(listed.body).result.tools.length >= 17);

    const foreignSession = await post(base, {
      headers: {
        Authorization: 'Bearer token-b',
        Origin: config.allowedOrigins[0],
        'Mcp-Session-Id': sessionId,
        'Mcp-Protocol-Version': '2025-03-26',
      },
      body: rpcRequest(3, 'tools/list', {}),
    });
    assert.equal(foreignSession.status, 403);

    const deleted = await request(base, {
      method: 'DELETE',
      headers: { ...common, 'Mcp-Session-Id': sessionId, 'Mcp-Protocol-Version': '2025-03-26' },
    });
    assert.equal(deleted.status, 200, deleted.body);
    const afterDelete = await post(base, {
      headers: { ...common, 'Mcp-Session-Id': sessionId, 'Mcp-Protocol-Version': '2025-03-26' },
      body: rpcRequest(4, 'tools/list', {}),
    });
    assert.equal(afterDelete.status, 404);
  } finally {
    await instance.close();
  }
});

test('Streamable HTTP enforces client scopes and path roots before invoking tools', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-http-policy-'));
  const projectRoot = path.join(root, 'projects');
  const evidenceRoot = path.join(root, 'evidence');
  const outside = path.join(root, 'outside');
  const port = await unusedPort();
  const config: StreamableHttpConfig = {
    host: '127.0.0.1',
    port,
    path: '/mcp',
    allowedOrigins: [`http://127.0.0.1:${port}`],
    allowedHosts: [`127.0.0.1:${port}`],
    requestTimeoutMs: 5000,
    clients: [
      {
        token: 'read-only',
        clientId: 'read-only',
        scopes: ['read'],
        projectRoots: [projectRoot],
        evidenceRoots: [evidenceRoot],
      },
    ],
  };
  const instance = await startStreamableHttpServer(config, createMcpServer);
  const base = `http://${config.host}:${port}${config.path}`;
  const headers = { Authorization: 'Bearer read-only', Origin: config.allowedOrigins[0] };
  try {
    const initialized = await post(base, { headers, body: initializeRequest(10) });
    const sessionId = initialized.headers['mcp-session-id'];
    assert.ok(sessionId);
    const call = async (id: number, name: string, args: Record<string, unknown>) =>
      post(base, {
        headers: { ...headers, 'Mcp-Session-Id': sessionId, 'Mcp-Protocol-Version': '2025-03-26' },
        body: rpcRequest(id, 'tools/call', { name, arguments: args }),
      });

    const forbiddenScope = await call(11, 'launch_project', { projectPath: path.join(projectRoot, 'project.godot') });
    assert.equal(forbiddenScope.status, 200);
    assert.equal(JSON.parse(JSON.parse(forbiddenScope.body).result.content[0].text).code, 'FORBIDDEN');

    const forbiddenProject = await call(12, 'get_project_info', { projectPath: outside });
    assert.equal(forbiddenProject.status, 200);
    assert.equal(JSON.parse(JSON.parse(forbiddenProject.body).result.content[0].text).code, 'FORBIDDEN');

    const forbiddenEvidence = await call(13, 'get_debug_output', { evidenceDir: outside });
    assert.equal(forbiddenEvidence.status, 200);
    assert.equal(JSON.parse(JSON.parse(forbiddenEvidence.body).result.content[0].text).code, 'FORBIDDEN');
  } finally {
    await instance.close();
  }
});

test('Streamable HTTP configuration rejects unsafe defaults and invalid scopes', () => {
  assert.throws(
    () => readStreamableHttpConfig({ MCP_HTTP_HOST: '0.0.0.0', MCP_HTTP_BEARER_TOKEN: 'secret' }),
    /loopback/,
  );
  assert.throws(
    () =>
      readStreamableHttpConfig({
        MCP_HTTP_HOST: '0.0.0.0',
        MCP_HTTP_ALLOW_REMOTE: 'true',
        MCP_HTTP_BEARER_TOKEN: 'secret',
      }),
    /loopback/,
  );
  assert.throws(() => readStreamableHttpConfig({}), /BEARER_TOKEN/);
  assert.throws(
    () =>
      readStreamableHttpConfig({
        MCP_HTTP_BEARER_TOKEN: 'secret',
        MCP_HTTP_SCOPES: 'read,unknown',
      }),
    /invalid permission/,
  );
});

test('a direct HTTP server config cannot bypass the local-only path safety boundary', async () => {
  const local = readStreamableHttpConfig({ MCP_HTTP_BEARER_TOKEN: 'local-test-token' });
  await assert.rejects(
    () => startStreamableHttpServer({ ...local, host: '0.0.0.0' }, createMcpServer),
    /remote MCP HTTP bind is disabled/,
  );
});

function initializeRequest(id: number): string {
  return rpcRequest(id, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'http-test', version: '0.1.0' },
  });
}

function rpcRequest(id: number, method: string, params: Record<string, unknown>): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

function post(url: string, options: { headers?: Record<string, string>; body?: string }): Promise<HttpResponse> {
  return request(url, { method: 'POST', headers: options.headers, body: options.body });
}

function request(
  url: string,
  options: { method: string; headers?: Record<string, string>; body?: string },
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method: options.method,
        headers: {
          Accept: 'application/json, text/event-stream',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          const headers: Record<string, string | undefined> = {};
          for (const [key, value] of Object.entries(res.headers))
            headers[key] = Array.isArray(value) ? value[0] : value;
          resolve({ status: res.statusCode ?? 0, headers, body });
        });
      },
    );
    req.on('error', reject);
    if (options.body) req.end(options.body);
    else req.end();
  });
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to reserve a port');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

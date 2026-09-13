import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createMcpServer } from '../src/mcp-server-sdk.js';
import type { McpPermission } from '../src/mcp/access-policy.js';
import { startStreamableHttpServer, type StreamableHttpConfig } from '../src/transports/streamable-http.js';

test('Streamable HTTP works with the official MCP TypeScript client', async () => {
  const config = await securityConfig({
    rateLimitMaxRequests: 100,
    rateLimitMaxRequestsPerClient: 100,
  });
  const instance = await startStreamableHttpServer(config, createMcpServer);
  const url = new URL(`http://${config.host}:${config.port}${config.path}`);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: 'Bearer client-token', Origin: config.allowedOrigins[0] } },
  });
  const client = new Client({ name: 'official-sdk-e2e', version: '1.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === 'get_godot_version'));
    const result = await client.callTool({ name: 'get_godot_version', arguments: { godotPath: 'godot' } });
    assert.ok(Array.isArray(result.content));
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    await instance.close();
  }
});

test('HTTP rate and concurrency limits return 429 with Retry-After', async () => {
  const config = await securityConfig({
    rateLimitMaxRequests: 1,
    rateLimitMaxRequestsPerClient: 1,
    maxConcurrentRequests: 1,
    maxConcurrentRequestsPerClient: 1,
  });
  const instance = await startStreamableHttpServer(config, createMcpServer);
  const base = `http://${config.host}:${config.port}${config.path}`;
  const headers = { Authorization: 'Bearer client-token', Origin: config.allowedOrigins[0] };
  try {
    const first = await post(base, { headers, body: initializeRequest(1) });
    assert.equal(first.status, 200);
    const second = await post(base, { headers, body: initializeRequest(2) });
    assert.equal(second.status, 429);
    assert.ok(second.headers['retry-after']);
  } finally {
    await instance.close();
  }
});

test('token rotation accepts a new token, expires the old token, and preserves last good state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-http-rotation-'));
  const tokenFile = path.join(root, 'tokens.json');
  const config = await securityConfig({ tokenFile, tokenReloadIntervalMs: 1 });
  await writeFile(tokenFile, JSON.stringify([tokenEntry('rotated-token'), tokenEntry('previous-token')]));
  const instance = await startStreamableHttpServer(config, createMcpServer);
  const base = `http://${config.host}:${config.port}${config.path}`;
  try {
    const rotated = await post(base, { headers: headersFor(config, 'rotated-token'), body: initializeRequest(3) });
    assert.equal(rotated.status, 200);
    const previous = await post(base, { headers: headersFor(config, 'previous-token'), body: initializeRequest(30) });
    assert.equal(previous.status, 200);
    await writeFile(tokenFile, '{broken');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const stillValid = await post(base, { headers: headersFor(config, 'rotated-token'), body: initializeRequest(4) });
    assert.equal(stillValid.status, 200);
    await writeFile(
      tokenFile,
      JSON.stringify([tokenEntry('expired-token', new Date(Date.now() - 1000).toISOString())]),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const expired = await post(base, { headers: headersFor(config, 'expired-token'), body: initializeRequest(5) });
    assert.equal(expired.status, 401);
  } finally {
    await instance.close();
  }
});

test('HTTP audit log records security outcomes without credentials', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-http-audit-'));
  const auditLog = path.join(root, 'audit.jsonl');
  const config = await securityConfig({ auditLog, rateLimitMaxRequests: 1, rateLimitMaxRequestsPerClient: 1 });
  const instance = await startStreamableHttpServer(config, createMcpServer);
  const base = `http://${config.host}:${config.port}${config.path}`;
  try {
    await post(base, { headers: headersFor(config, 'wrong-secret'), body: initializeRequest(20) });
    await post(base, { headers: headersFor(config, 'client-token'), body: initializeRequest(21) });
    await post(base, { headers: headersFor(config, 'client-token'), body: initializeRequest(22) });
  } finally {
    await instance.close();
  }
  const lines = (await readFile(auditLog, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.ok(lines.some((line) => line.event === 'auth_failure' && line.status === 401));
  assert.ok(lines.some((line) => line.event === 'rate_limit_rejected' && line.status === 429));
  const serialized = JSON.stringify(lines);
  assert.equal(serialized.includes('wrong-secret'), false);
  assert.equal(serialized.includes('client-token'), false);
  assert.equal(serialized.includes('Authorization'), false);
});

test('HTTP concurrency slots cover tool execution and release after completion', async () => {
  let resolveStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => (resolveStarted = resolve));
  let releaseSlow: (() => void) | undefined;
  const serverFactory = (policy: Parameters<typeof createMcpServer>[0]) => {
    const server = createMcpServer(policy);
    server.tool('slow_slot', 'hold a concurrency slot', {}, async () => {
      resolveStarted?.();
      await new Promise<void>((resolve) => (releaseSlow = resolve));
      return { content: [{ type: 'text', text: 'done' }] };
    });
    return server;
  };
  const config = await securityConfig({
    maxConcurrentRequests: 1,
    maxConcurrentRequestsPerClient: 1,
    rateLimitMaxRequests: 100,
    rateLimitMaxRequestsPerClient: 100,
    clients: [{ ...tokenEntry('client-token'), scopes: ['admin'] as McpPermission[] }],
  });
  const instance = await startStreamableHttpServer(config, serverFactory);
  const base = `http://${config.host}:${config.port}${config.path}`;
  const headers = headersFor(config, 'client-token');
  try {
    const initialized = await post(base, { headers, body: initializeRequest(23) });
    const sessionId = initialized.headers['mcp-session-id'];
    assert.ok(sessionId);
    const pending = post(base, {
      headers: { ...headers, 'Mcp-Session-Id': sessionId! },
      body: rpcRequest(24, 'tools/call', { name: 'slow_slot', arguments: {} }),
    });
    await Promise.race([
      started,
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow tool did not start')), 2_000)),
    ]);
    const rejected = await post(base, {
      headers: { ...headers, 'Mcp-Session-Id': sessionId! },
      body: rpcRequest(25, 'tools/list', {}),
    });
    assert.equal(rejected.status, 429);
    assert.ok(rejected.headers['retry-after']);
    releaseSlow?.();
    const completed = await pending;
    assert.equal(completed.status, 200);
    const after = await post(base, {
      headers: { ...headers, 'Mcp-Session-Id': sessionId! },
      body: rpcRequest(26, 'tools/list', {}),
    });
    assert.equal(after.status, 200);
  } finally {
    releaseSlow?.();
    await instance.close();
  }
});
test('HTTP abort and graceful shutdown propagate cancellation to an MCP tool', async () => {
  let observedSignal: AbortSignal | undefined;
  let resolveStarted: (() => void) | undefined;
  const handlerStarted = new Promise<void>((resolve) => (resolveStarted = resolve));
  const serverFactory = (policy: Parameters<typeof createMcpServer>[0]) => {
    const server = createMcpServer(policy);
    server.tool('slow_test', 'wait for cancellation', { delayMs: z.number() }, async ({ delayMs }, extra) => {
      observedSignal = extra.signal;
      resolveStarted?.();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delayMs);
        extra.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      return { content: [{ type: 'text', text: JSON.stringify({ aborted: extra.signal.aborted }) }] };
    });
    return server;
  };
  const config = await securityConfig({
    requestTimeoutMs: 5_000,
    shutdownTimeoutMs: 1_000,
    clients: [{ ...tokenEntry('client-token'), scopes: ['admin'] as McpPermission[] }],
  });
  const instance = await startStreamableHttpServer(config, serverFactory);
  const base = `http://${config.host}:${config.port}${config.path}`;
  const headers = headersFor(config, 'client-token');
  try {
    const initialized = await post(base, { headers, body: initializeRequest(6) });
    const sessionId = initialized.headers['mcp-session-id'];
    assert.ok(sessionId);
    const pending = post(base, {
      headers: { ...headers, 'Mcp-Session-Id': sessionId! },
      body: rpcRequest(7, 'tools/call', { name: 'slow_test', arguments: { delayMs: 10_000 } }),
    });
    await Promise.race([handlerStarted, new Promise((resolve) => setTimeout(resolve, 1_000))]);
    await instance.close();
    await pending;
    assert.equal(observedSignal?.aborted, true);
  } finally {
    await instance.close();
  }
});

async function securityConfig(overrides: Partial<StreamableHttpConfig> = {}): Promise<StreamableHttpConfig> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-http-security-'));
  const port = await unusedPort();
  return {
    host: '127.0.0.1',
    port,
    path: '/mcp',
    allowedOrigins: [`http://127.0.0.1:${port}`],
    allowedHosts: [`127.0.0.1:${port}`],
    requestTimeoutMs: 5_000,
    clients: [tokenEntry('client-token')],
    rateLimitWindowMs: 50,
    rateLimitMaxRequests: 100,
    rateLimitMaxRequestsPerClient: 100,
    maxConcurrentRequests: 10,
    maxConcurrentRequestsPerClient: 10,
    shutdownTimeoutMs: 1_000,
    ...overrides,
  };
}

function tokenEntry(token: string, expiresAt?: string) {
  return {
    token,
    clientId: 'client-a',
    scopes: ['read', 'run', 'write'] as McpPermission[],
    projectRoots: [path.resolve('.')],
    evidenceRoots: [path.resolve('./runs')],
    expiresAt,
  };
}
function headersFor(config: StreamableHttpConfig, token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Origin: config.allowedOrigins[0] };
}
function initializeRequest(id: number): string {
  return rpcRequest(id, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'security-test', version: '1.0.0' },
  });
}
function rpcRequest(id: number, method: string, params: Record<string, unknown>): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}
type HttpResponse = { status: number; headers: Record<string, string | undefined>; body: string };
function post(url: string, options: { headers?: Record<string, string>; body?: string }): Promise<HttpResponse> {
  return fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', ...options.headers },
    body: options.body,
  }).then(async (response) => ({
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  }));
}
async function unusedPort(): Promise<number> {
  const server = (await import('node:http')).createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to reserve a port');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

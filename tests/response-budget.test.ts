import test from 'node:test';
import assert from 'node:assert/strict';
import {
  budgetResponse,
  DEFAULT_RESPONSE_BYTES,
  readResponsePage,
  runWithResponseOwner,
} from '../src/response-budget.js';
import { invokeTool } from '../src/mcp/tool-context.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp-server-sdk.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readEvidence } from '../src/godot-runtime.js';

test('empty and normal results retain their business fields', async () => {
  const empty = await invokeTool(async () => ({ properties: {} }));
  assert.equal(empty.isError, undefined);
  assert.deepEqual((empty.structuredContent as Record<string, unknown>).properties, {});
  const normal = await invokeTool(async () => ({ properties: { position: { type: 'Vector2', x: 2, y: 3 } } }));
  assert.equal(normal.isError, undefined);
  assert.deepEqual((normal.structuredContent as Record<string, any>).properties.position, {
    type: 'Vector2',
    x: 2,
    y: 3,
  });
});

test('large UTF-8 result returns a bounded continuation whose pages reconstruct the exact JSON', async () => {
  const original = { schema_version: '0.1', source: 'REAL', content: '世界🌐'.repeat(DEFAULT_RESPONSE_BYTES) };
  const first = budgetResponse(original);
  assert.equal(first.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < DEFAULT_RESPONSE_BYTES);
  let assembled = String(first.chunk);
  let next = first.continuation as { ref: string; cursor: number } | null;
  let pages = 1;
  while (next) {
    const page = readResponsePage(next.ref, next.cursor);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < DEFAULT_RESPONSE_BYTES);
    assembled += String(page.chunk);
    next = page.continuation as { ref: string; cursor: number } | null;
    pages++;
  }
  assert.ok(pages > 2);
  assert.deepEqual(JSON.parse(assembled), original);
  const result = await invokeTool(async () => ({ content: '长'.repeat(DEFAULT_RESPONSE_BYTES) }));
  assert.equal(result.isError, undefined);
  assert.equal((result.structuredContent as Record<string, unknown>).truncated, true);
});

test('nested failures and oversized failure bodies remain isError', async () => {
  const nested = await invokeTool(async () => ({
    response: { status: 'FAIL', code: 'NOT_FOUND', message: 'missing', payload: 'x'.repeat(DEFAULT_RESPONSE_BYTES) },
  }));
  assert.equal(nested.isError, true);
  assert.equal((nested.structuredContent as Record<string, unknown>).code, 'NOT_FOUND');
  const result = await invokeTool(async () => ({
    status: 'FAIL',
    code: 'NOT_FOUND',
    message: 'missing',
    payload: 'x'.repeat(DEFAULT_RESPONSE_BYTES),
  }));
  assert.equal(result.isError, true);
  assert.equal((result.structuredContent as Record<string, unknown>).truncated, true);
  assert.equal((result.structuredContent as Record<string, unknown>).code, 'NOT_FOUND');
  assert.equal((result.structuredContent as Record<string, unknown>).status, 'FAIL');
  assert.equal(JSON.parse(result.content[0].text).code, 'NOT_FOUND');
});

test('official MCP client can continue a large response through get_response_page', async () => {
  const original = { schema_version: '0.1', source: 'REAL', data: '页面🌐'.repeat(DEFAULT_RESPONSE_BYTES) };
  const first = budgetResponse(original);
  const next = first.continuation as { ref: string; cursor: number };
  const server = createMcpServer();
  const client = new Client({ name: 'response-budget', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const result = await client.callTool({ name: 'get_response_page', arguments: next });
    assert.equal(result.isError, undefined);
    const content = (result as { content: Array<{ type: string; text?: string }> }).content;
    const body = JSON.parse(content.find((item) => item.type === 'text')!.text!);
    assert.equal(body.encoding, 'json');
    assert.equal(typeof body.chunk, 'string');
  } finally {
    await client.close();
    await server.close();
  }
});

test('invalid and expired response references fail explicitly', () => {
  assert.throws(() => readResponsePage('missing', 0), /unavailable or expired/);
  const first = budgetResponse({ text: 'a'.repeat(DEFAULT_RESPONSE_BYTES) });
  const next = first.continuation as { ref: string; cursor: number };
  assert.throws(() => readResponsePage(next.ref, -1), /outside the stored snapshot/);
  assert.throws(() => runWithResponseOwner('other-client', () => readResponsePage(next.ref, 0)), /another client/);
});

test('process logs page by UTF-8 byte cursor and expose archived segment references', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-log-page-'));
  await writeFile(path.join(root, 'process.json'), JSON.stringify({ pid: 1 }));
  const original = '日志🌐'.repeat(10000);
  await writeFile(path.join(root, 'stdout.log'), original);
  await writeFile(path.join(root, 'stderr.log'), '');
  await writeFile(path.join(root, 'stdout.1790000000000-0000.log'), 'archived');
  let cursor = 0;
  let assembled = '';
  while (assembled.length < original.length) {
    const page = await readEvidence(root, { stdoutCursor: cursor, limitBytes: 1001 });
    assembled += page.stdout;
    assert.equal(page.metadata.pid, 1);
    assert.ok(page.availableSegments.includes('stdout.1790000000000-0000.log'));
    if (page.stdoutNextCursor === null) break;
    cursor = page.stdoutNextCursor;
  }
  assert.equal(assembled, original);
  const archived = await readEvidence(root, { stdoutSegment: 'stdout.1790000000000-0000.log' });
  assert.equal(archived.stdout, 'archived');
  await assert.rejects(readEvidence(root, { stdoutSegment: '../stderr.log' }), /unknown or wrong log segment/);
  await assert.rejects(readEvidence(root, { stdoutCursor: 1 }), /UTF-8 boundary/);
});

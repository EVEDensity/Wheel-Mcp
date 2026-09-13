import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

test('stdio MCP handshake and tool discovery', async () => {
  const child = spawn(process.execPath, ['build/src/mcp-server-sdk.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  const lines: Array<Record<string, any>> = [];
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const idx = buffer.indexOf('\n');
      lines.push(JSON.parse(buffer.slice(0, idx)));
      buffer = buffer.slice(idx + 1);
    }
  });
  const next = async () => {
    for (;;) {
      if (lines.length) return lines.shift();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  try {
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
      }) + '\n',
    );
    const init = (await next()) as Record<string, any>;
    assert.equal(init.result.serverInfo.name, 'godot-game-harness-mcp');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
    const listed = (await next()) as Record<string, any>;
    assert.ok(listed.result.tools.length >= 17);
  } finally {
    child.kill();
  }
});

test('official MCP client receives runtime event notifications', async () => {
  const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'mcp-notification-'));
  await writeFile(
    path.join(evidenceDir, 'events.jsonl'),
    JSON.stringify({
      schema_version: '0.1',
      source: 'REAL',
      run_id: 'notification-run',
      sequence: 1,
      timestamp: new Date().toISOString(),
      event: 'level_started',
      payload: { level: 1 },
    }) + '\n',
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['build/src/mcp-server-sdk.js'],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'notification-test', version: '1.0' });
  const notifications: Array<Record<string, unknown>> = [];
  client.setNotificationHandler(LoggingMessageNotificationSchema, async (notification) => {
    notifications.push(notification.params as Record<string, unknown>);
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: 'subscribe_runtime_events',
      arguments: { evidenceDir, continuous: true, maxEvents: 1, timeoutMs: 5000 },
    });
    assert.equal(Array.isArray(result.content), true);
    const deadline = Date.now() + 1000;
    while (notifications.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(notifications.length >= 1, true, JSON.stringify(result));
    assert.equal(notifications[0].logger as string, 'runtime-events');
    const payload = notifications[0].data as { subscription_id?: string; cursor?: unknown };
    assert.equal(typeof payload.subscription_id, 'string');
    assert.ok(payload.cursor !== undefined);
    const content = (result as { content: Array<{ text: string }> }).content[0].text;
    const body = JSON.parse(content) as { subscription_id?: string; status?: string };
    assert.equal(body.subscription_id, payload.subscription_id);
    assert.equal(body.status, 'ACTIVE');
  } finally {
    await client.close();
  }
});

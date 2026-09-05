import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

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
  assert.equal(listed.result.tools.length, 17);
  child.kill();
});

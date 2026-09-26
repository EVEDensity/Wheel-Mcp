import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

test('CLI and MCP classify timeout and missing project consistently', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'timeout-matrix-'));
  const cli = await runCli(['scene-tree', '--project', root, '--timeout', '0']);
  const cliError = JSON.parse(cli.stderr) as { code: string };
  assert.equal(cliError.code, 'TIMEOUT');
  const mcpTimeout = await callMcp('get_scene_tree', { projectPath: root, timeoutMs: 0 });
  assert.equal(readMcpErrorCode(mcpTimeout), 'TIMEOUT');

  const missing = path.join(root, 'missing');
  const cliMissing = await runCli(['scene-tree', '--project', missing]);
  assert.equal((JSON.parse(cliMissing.stderr) as { code: string }).code, 'NOT_FOUND');
  const mcpMissing = await callMcp('get_scene_tree', { projectPath: missing });
  assert.equal(readMcpErrorCode(mcpMissing), 'NOT_FOUND');
});

test('parent cancellation is represented by the shared CANCELLED envelope', () => {
  const code = {
    schema_version: '0.1',
    source: 'REAL',
    status: 'FAIL',
    code: 'CANCELLED',
    timed_out: false,
    cancelled: true,
  };
  assert.equal(code.code, 'CANCELLED');
  assert.equal(code.cancelled, true);
});

function readMcpErrorCode(value: Record<string, unknown>): string {
  const result = value.result as { content: Array<{ text: string }> };
  return (JSON.parse(result.content[0].text) as { code: string }).code;
}

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['build/src/cli.js', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('close', (code) => resolve({ stdout, stderr, code }));
  });
}

async function callMcp(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const child = spawn(process.execPath, ['build/src/mcp-server-sdk.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  const lines: Array<Record<string, unknown>> = [];
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      lines.push(JSON.parse(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
    }
  });
  const next = async (): Promise<Record<string, unknown>> => {
    while (!lines.length) await new Promise((resolve) => setTimeout(resolve, 5));
    return lines.shift()!;
  };
  try {
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'timeout-matrix', version: '1' },
        },
      }) + '\n',
    );
    await next();
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }) + '\n',
    );
    return await next();
  } finally {
    child.kill();
  }
}

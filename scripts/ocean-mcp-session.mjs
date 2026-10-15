import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

// Local development session for the user-authorized Plush Ocean project.
// No form handler supplies synthetic human approval. Exact write grants are
// verified by the server using the separately configured manifest.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.join(repo, 'examples', 'plush-ocean');
const candidate = path.join(process.env.TEMP, 'plush-ocean-preview-01a128f8');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(repo, 'build', 'src', 'mcp-server-sdk.js')],
  cwd: repo,
  env: {
    ...process.env,
    GODOT_HARNESS_ROOT: repo,
    GODOT_HARNESS_BRIDGE: path.join(repo, 'godot-plugin', 'runtime_bridge.gd'),
    MCP_STDIO_PROJECT_ROOTS: [project, candidate].join(';'),
    MCP_STDIO_EVIDENCE_ROOTS: path.join(repo, 'runs', 'plush-ocean'),
    MCP_STDIO_SCOPES: 'read,run,write',
    MCP_STDIO_PREAPPROVED_WRITES: path.join(repo, 'runs', 'plush-ocean', 'preapproved-writes.json'),
  },
  stderr: 'pipe',
});
const client = new Client({ name: 'plush-ocean-local-development', version: '1.0.0' });
await client.connect(transport);
transport.stderr?.on('data', chunk => process.stderr.write(chunk));
const lines = createInterface({ input: process.stdin, terminal: false });
console.log(JSON.stringify({ ready: true, project, candidate }));
try {
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line.startsWith('@') ? readFileSync(line.slice(1).trim(), 'utf8') : line);
      if (request.name === 'shutdown') break;
      const result = await client.callTool({ name: request.name, arguments: request.arguments ?? {} }, undefined, { timeout: 120000 });
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(request.id ?? '')) throw new Error('Invalid request id');
      const responseFile = path.join(repo, 'runs', 'plush-ocean', 'client-results', request.id + '.json');
      mkdirSync(path.dirname(responseFile), { recursive: true });
      writeFileSync(responseFile, JSON.stringify(result, null, 2));
      const data = result.structuredContent ?? {};
      console.log(JSON.stringify({ id: request.id, status: data.status, error: result.isError ?? false, responseFile }));
    } catch (error) {
      console.log(JSON.stringify({ id: request?.id, error: String(error?.message ?? error) }));
    }
  }
} finally {
  await client.close();
}

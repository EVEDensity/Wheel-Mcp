import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fixtureStdioEnv } from './stdio-fixture.js';
import { ElicitRequestSchema, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpPermission } from '../../src/mcp/access-policy.js';

/** Official SDK transport; form acceptance is an explicit TEST DOUBLE, not evidence of human UX. */
export async function wireEditor(
  root: string,
  options: {
    scopes?: McpPermission[];
    approval?: (message: string) => Promise<ElicitResult>;
    godotPath?: string;
    transport?: 'memory' | 'stdio';
    onStderr?: (chunk: Buffer) => void;
  } = {},
) {
  const server =
    (options.transport ?? productionCaseTransport()) === 'memory'
      ? (await import('../../src/mcp-server-sdk.js')).createMcpServer(
          (await import('../../src/mcp/access-policy.js')).createClientPolicy({
            clientId: 'local-client',
            scopes: options.scopes ?? ['read', 'write', 'run'],
            projectRoots: [root],
            evidenceRoots: [root],
            approvedGodotPaths: [options.godotPath ?? process.env.GODOT_PATH!],
            approvedBridgePaths: [process.cwd() + '/godot-plugin/runtime_bridge.gd'],
          }),
        )
      : undefined;
  const client = new Client(
    { name: 'native-authoring-acceptance', version: '1' },
    { capabilities: { elicitation: { form: {} } } },
  );
  client.setRequestHandler(
    ElicitRequestSchema,
    (request) =>
      options.approval?.(request.params.message) ?? Promise.resolve({ action: 'accept', content: { confirm: true } }),
  );
  if (server) {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
  } else {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('build/src/mcp-server-sdk.js')],
      stderr: 'pipe',
      env: fixtureStdioEnv({
        GODOT_HARNESS_RUN_REGISTRY_PATH:
          process.env.GODOT_HARNESS_RUN_REGISTRY_PATH ?? path.join(root, '.harness/stdio-fixture-registry.json'),
        GODOT_PATH: options.godotPath ?? process.env.GODOT_PATH ?? '',
        MCP_STDIO_SCOPES: (options.scopes ?? ['read', 'write', 'run']).join(','),
        MCP_STDIO_PROJECT_ROOTS: root,
        MCP_STDIO_EVIDENCE_ROOTS: root,
        MCP_STDIO_APPROVED_GODOT_PATHS: options.godotPath ?? process.env.GODOT_PATH ?? '',
        MCP_STDIO_APPROVED_BRIDGE_PATHS: path.resolve('godot-plugin/runtime_bridge.gd'),
        MCP_TOOL_PROFILE: 'all',
      }),
    });
    transport.stderr?.on('data', (chunk: Buffer) => options.onStderr?.(chunk));
    try {
      await client.connect(transport);
    } catch (error) {
      await transport.close();
      throw error;
    }
  }
  const tools = await client.listTools();
  const projectTools = new Set(
    tools.tools.filter((tool) => tool.inputSchema.properties?.projectPath).map((tool) => tool.name),
  );
  return {
    client,
    async call(name: string, args: Record<string, unknown> = {}, options: { signal?: AbortSignal } = {}) {
      // SDK 1.30 retains its anonymous abort callback on the supplied signal after resolution.
      // A request-local signal prevents completed requests being cancelled again as a burst.
      const controller = options.signal ? new AbortController() : undefined;
      const abort = () => controller?.abort(options.signal?.reason);
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      try {
        return await client.callTool(
          { name, arguments: { ...(projectTools.has(name) ? { projectPath: root } : {}), ...args } },
          undefined,
          { timeout: 120000, signal: controller?.signal },
        );
      } finally {
        options.signal?.removeEventListener('abort', abort);
      }
    },
    async close() {
      await client.close();
      await server?.close();
    },
  };
}

export function productionCaseTransport(): 'memory' | 'stdio' {
  const mode = process.env.WHEEL_CASE_TRANSPORT ?? 'memory';
  if (mode !== 'memory' && mode !== 'stdio') throw new Error('Unknown fixed case transport');
  return mode;
}
export function productionCaseTransportLabel(): string {
  return productionCaseTransport() === 'stdio' ? 'official SDK StdioClientTransport' : 'official SDK InMemoryTransport';
}

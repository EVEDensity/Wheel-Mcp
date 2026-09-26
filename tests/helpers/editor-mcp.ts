import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../../src/mcp-server-sdk.js';
import { createClientPolicy, type McpPermission } from '../../src/mcp/access-policy.js';

/** Official SDK transport; form acceptance is an explicit TEST DOUBLE, not evidence of human UX. */
export async function wireEditor(
  root: string,
  options: { scopes?: McpPermission[]; approval?: (message: string) => Promise<ElicitResult>; godotPath?: string } = {},
) {
  const server = createMcpServer(
    createClientPolicy({
      clientId: 'local-client',
      scopes: options.scopes ?? ['read', 'write', 'run'],
      projectRoots: [root],
      evidenceRoots: [root],
      approvedGodotPaths: [options.godotPath ?? process.env.GODOT_PATH!],
      approvedBridgePaths: [process.cwd() + '/godot-plugin/runtime_bridge.gd'],
    }),
  );
  const client = new Client(
    { name: 'native-authoring-acceptance', version: '1' },
    { capabilities: { elicitation: { form: {} } } },
  );
  client.setRequestHandler(
    ElicitRequestSchema,
    (request) =>
      options.approval?.(request.params.message) ?? Promise.resolve({ action: 'accept', content: { confirm: true } }),
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  return {
    client,
    async call(name: string, args: Record<string, unknown> = {}) {
      return client.callTool({ name, arguments: { projectPath: root, ...args } }, undefined, { timeout: 120000 });
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

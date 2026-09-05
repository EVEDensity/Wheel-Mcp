import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export function createSdkServer(info: { name: string; version: string }) {
  return new McpServer(info, { capabilities: { tools: {} } });
}

export async function connectSdkServer(server: McpServer) {
  await server.connect(new StdioServerTransport());
}

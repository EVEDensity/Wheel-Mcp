#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { authorizeToolCall, recordToolOwnership, type McpClientPolicy } from './mcp/access-policy.js';
import { z } from 'zod';
import { serverCapabilities, serverInfo } from './server-info.js';
import { registerAllTools } from './mcp/tool-registry.js';
import { createMergedAbortSignal, getHttpRequestLifecycle, getHttpRequestSignal } from './transports/http-lifecycle.js';

export function createMcpServer(policy?: McpClientPolicy): McpServer {
  const server = new McpServer(serverInfo, { capabilities: serverCapabilities });
  const originalTool = server.tool.bind(server);
  Object.defineProperty(server, 'tool', {
    value: (
      name: string,
      description: string,
      schema: Record<string, z.ZodTypeAny>,
      callback: (args: any, extra: any) => any,
    ) =>
      originalTool(name, description, schema, async (args, extra) => {
        try {
          if (policy) authorizeToolCall(policy, name, args as Record<string, unknown>);
          const lifecycle = getHttpRequestLifecycle();
          lifecycle?.retain();
          const merged = createMergedAbortSignal(extra.signal, getHttpRequestSignal());
          try {
            const response = await callback(args, merged ? { ...extra, signal: merged.signal } : extra);
            if (policy) recordToolOwnership(policy, name, response);
            return response;
          } finally {
            merged?.dispose();
            lifecycle?.release();
          }
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            (error as { code?: unknown }).code === 'FORBIDDEN'
          ) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    code: 'FORBIDDEN',
                    error: error instanceof Error ? error.message : 'forbidden',
                  }),
                },
              ],
            };
          }
          throw error;
        }
      }),
  });
  registerAllTools({ server });
  return server;
}

async function main(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}

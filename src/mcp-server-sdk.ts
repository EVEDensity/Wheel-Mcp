#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { authorizeToolCall, recordToolOwnership, type McpClientPolicy } from './mcp/access-policy.js';
import { z } from 'zod';
import {
  captureRuntimeScreenshot,
  getGodotVersion,
  getProcessStatus,
  getProjectInfo,
  getSceneTree,
  injectRuntimeInput,
  launchProject,
  listProjects,
  mutateRuntimeProperty,
  queryRuntimeProperty,
  queryRuntimeSceneTree,
  readEvidence,
  resolveGodotPath,
  stopProcess,
  cancelProcess,
  readRuntimeEventsSince,
  subscribeRuntimeEvents,
  streamRuntimeEvents,
  streamEventSubscription,
  createEventSubscription,
  pollEventSubscription,
  cancelEventSubscription,
  acknowledgeEventSubscription,
  pauseEventSubscription,
  closeEventSubscription,
  listEventSubscriptions,
} from './godot-runtime.js';
import { runRegistry } from './run-registry.js';
import { buildContextPack } from './context-pack.js';
import { gitCheckpoint, gitRecovery } from './git-recovery.js';
import { classifyError } from './error-schema.js';
import { createTimeoutContext, TimeoutContext } from './timeout.js';
import type { McpFailureResult, McpToolResult } from './tool-types.js';
import { serverCapabilities, serverInfo } from './server-info.js';
import { DEFAULT_COMMAND_TIMEOUT_MS, DEFAULT_STOP_TIMEOUT_MS } from './timeouts.js';
import { executeScenario, loadScenario } from './scenario-executor.js';
import { scenarioSchema } from './scenario-schema.js';
import { openRuntimeBridge, callRuntimeBridge, stopRuntimeBridge } from './persistent-runtime-bridge.js';
import { keycodeSchema, pidSchema, pressedSchema, timeoutMsSchema } from './input-schemas.js';
import {
  readSceneFile,
  writeSceneFile,
  readGodotDiagnostics,
  readProjectFile,
  writeProjectFile,
  searchProject,
  compareScreenshots,
  getRecentEvidence,
} from './godot-development.js';
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

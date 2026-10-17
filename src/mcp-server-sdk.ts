#!/usr/bin/env node
import './runtime-threads.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { authorizeToolCall, recordToolOwnership, toolPermissions, type McpClientPolicy } from './mcp/access-policy.js';
import { z } from 'zod';
import { serverCapabilities, serverInfo } from './server-info.js';
import { registerAllTools } from './mcp/tool-registry.js';
import { createMergedAbortSignal, getHttpRequestLifecycle, getHttpRequestSignal } from './transports/http-lifecycle.js';
import { classifyError, WheelError } from './error-schema.js';
import { runWithResponseOwner } from './response-budget.js';
import { runRegistry } from './run-registry.js';
import { stopRuntimeBridge } from './persistent-runtime-bridge.js';
import { createTimeoutContext } from './timeout.js';
import { DEFAULT_STOP_TIMEOUT_MS } from './timeouts.js';
import { createStdioPolicy } from './mcp/stdio-policy.js';
import { registerOperationLifecycle, drainMcpOperations } from './mcp/operation-lifecycle.js';
import { registerDiscovery } from './mcp/discovery.js';
import type { PreapprovedWritesConfig } from './mcp/preapproved-writes.js';
import { runWithRetryGuidance } from './mcp/retry-guidance.js';

export function createMcpServer(
  policy?: McpClientPolicy,
  options: {
    resourceProjects?: readonly string[];
    toolProfile?: 'all' | 'read';
    /** Trusted host configuration; HTTP and default factories do not inherit stdio grants. */
    preapprovedWrites?: PreapprovedWritesConfig;
  } = {},
): McpServer {
  const profile = options.toolProfile ?? process.env.MCP_TOOL_PROFILE ?? 'all';
  if (!['all', 'read'].includes(profile))
    throw new WheelError('INVALID_ARGUMENT', 'MCP_TOOL_PROFILE must be all or read');
  const server = new McpServer(serverInfo, { capabilities: serverCapabilities });
  const operations = registerOperationLifecycle(server);
  const originalRegisterTool = server.registerTool.bind(server);
  Object.defineProperty(server, 'tool', {
    value: (
      name: string,
      description: string,
      schema: Record<string, z.ZodTypeAny>,
      callback: (args: any, extra: any) => any,
    ) => {
      const permission = toolPermissions[name];
      if (!permission) throw new WheelError('FORBIDDEN', 'Tool lacks permission classification');
      if (profile === 'read' && permission !== 'read') return;
      return originalRegisterTool(
        name,
        {
          description: `[${permission}] ${description}`,
          title: name.replaceAll('_', ' '),
          annotations: {
            readOnlyHint: permission === 'read',
            destructiveHint: permission !== 'read',
            idempotentHint: permission === 'read',
            openWorldHint: false,
          },
          inputSchema: name === 'query_runtime_collisions' ? z.object(schema).strict() : schema,
        },
        async (args: any, extra: any) =>
          operations.run(async (closingSignal) => {
            try {
              if (policy) await authorizeToolCall(policy, name, args as Record<string, unknown>);
              const lifecycle = getHttpRequestLifecycle();
              lifecycle?.retain();
              const merged = createMergedAbortSignal(extra.signal, getHttpRequestSignal(), closingSignal);
              try {
                const response = await runWithResponseOwner(policy?.clientId ?? 'local', () =>
                  runWithRetryGuidance(name, args, () =>
                    callback(args, merged ? { ...extra, signal: merged.signal } : extra),
                  ),
                );
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
                const envelope = classifyError(error);
                return {
                  isError: true,
                  structuredContent: envelope,
                  content: [
                    {
                      type: 'text' as const,
                      text: JSON.stringify({
                        ...envelope,
                        error: error instanceof Error ? error.message : 'forbidden',
                      }),
                    },
                  ],
                };
              }
              throw error;
            }
          }),
      );
    },
  });
  registerAllTools({ server, policy, preapprovedWrites: options.preapprovedWrites });
  registerDiscovery(server, policy, operations, options.resourceProjects ?? policy?.projectRoots ?? []);
  return server;
}

/** Shared stdio entry for the packaged binary and the source checkout launcher. */
export async function startStdioServer(): Promise<void> {
  await runRegistry.reclaimOrphans(10_000);
  const policy = createStdioPolicy();
  if (!process.env.GODOT_PATH && policy.approvedGodotPaths.length === 1)
    process.env.GODOT_PATH = policy.approvedGodotPaths[0];
  const manifestPath = process.env.MCP_STDIO_PREAPPROVED_WRITES;
  const server = createMcpServer(policy, {
    ...(manifestPath !== undefined ? { preapprovedWrites: { manifestPath } } : {}),
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => (cleanupPromise ??= drainMcpOperations(server).then(() => cleanupCurrentOwnerResources()));
  const originalClose = transport.onclose;
  transport.onclose = () => {
    originalClose?.();
    void cleanup().catch((error) => console.error('Wheel-mcp stdio cleanup failed:', error));
  };
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void cleanup().then(
      () => process.exit(0),
      (error) => {
        console.error('Wheel-mcp shutdown cleanup failed:', error);
        process.exit(1);
      },
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.stdin.once('end', shutdown);
  process.stdin.once('close', shutdown);
}

export async function cleanupCurrentOwnerResources(): Promise<void> {
  const owned = runRegistry
    .list()
    .filter(
      (run) => run.ownerPid === process.pid && ['RUNNING', 'ORPHANED', 'STOPPING', 'CANCELLING'].includes(run.state),
    );
  const results = await Promise.allSettled(
    owned.map(async (run) => {
      const context = createTimeoutContext(DEFAULT_STOP_TIMEOUT_MS);
      try {
        if (run.kind === 'bridge') {
          try {
            await stopRuntimeBridge(run.runId, context);
            return;
          } catch {
            // A registered bridge may not be in the in-memory session map after startup failure.
          }
        }
        await runRegistry.stop(run.runId, context);
      } finally {
        context.dispose();
      }
    }),
  );
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      'stdio resource cleanup failed',
    );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await startStdioServer();
}

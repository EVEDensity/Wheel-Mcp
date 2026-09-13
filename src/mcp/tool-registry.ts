// Tool implementations are temporarily kept in this composition unit while domain modules expose
// focused registration entry points. The server-side wrapper remains the single authority for policy,
// request lifecycle, cancellation, ownership and timeout semantics.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
} from '../godot-runtime.js';
import { runRegistry } from '../run-registry.js';
import { buildContextPack } from '../context-pack.js';
import { gitCheckpoint, gitRecovery } from '../git-recovery.js';
import { classifyError } from '../error-schema.js';
import { createTimeoutContext, TimeoutContext } from '../timeout.js';
import type { McpFailureResult, McpToolResult } from '../tool-types.js';
import { serverCapabilities, serverInfo } from '../server-info.js';
import { DEFAULT_COMMAND_TIMEOUT_MS, DEFAULT_STOP_TIMEOUT_MS } from '../timeouts.js';
import { executeScenario, loadScenario } from '../scenario-executor.js';
import { scenarioSchema } from '../scenario-schema.js';
import { openRuntimeBridge, callRuntimeBridge, stopRuntimeBridge } from '../persistent-runtime-bridge.js';
import { keycodeSchema, pidSchema, pressedSchema, timeoutMsSchema } from '../input-schemas.js';
import {
  readSceneFile,
  writeSceneFile,
  readGodotDiagnostics,
  readProjectFile,
  writeProjectFile,
  searchProject,
  compareScreenshots,
  getRecentEvidence,
} from '../godot-development.js';

export type ToolRegistrationContext = { server: McpServer };

export function registerAllTools({ server }: ToolRegistrationContext): void {
  const projectPath = z.string();
  const godotPath = z.string().optional();
  const bridgePath = z.string();
  const evidenceDir = z.string().optional();
  const result = (value: unknown): McpToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  const failure = (error: unknown): McpFailureResult => ({
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify(classifyError(error)) }],
  });
  const timeoutMs = timeoutMsSchema;
  const responseMode = z.enum(['compact', 'normal', 'verbose']).optional();
  const compactResponse = (value: any): any => {
    if (!value || typeof value !== 'object') return value;
    const out: any = {
      status: value.status ?? (value.same === true ? 'PASS' : value.same === false ? 'FAIL' : undefined),
    };
    if (Array.isArray(value.diagnostics))
      out.errorCount = value.diagnostics.filter((d: any) => d.severity === 'error').length;
    for (const key of [
      'changedFiles',
      'screenshotPath',
      'screenshot',
      'diffPath',
      'evidencePath',
      'evidenceDir',
      'summary',
    ])
      if (value[key] !== undefined) out[key] = value[key];
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
  };
  const formatResponse = (value: any, mode?: string) => (mode === 'compact' ? compactResponse(value) : value);
  const cursor = z
    .union([
      z.number().int().nonnegative(),
      z.object({ run_id: z.string().min(1), sequence: z.number().int().nonnegative() }),
    ])
    .optional();
  const eventNames = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional();
  const eventPayload = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional();
  const runtimeMethod = z.enum([
    'get_scene_tree',
    'get_property',
    'set_property',
    'create_node',
    'delete_node',
    'call_method',
    'reload_scene',
    'inject_input',
    'capture_screenshot',
    'subscribe_events',
    'stop',
  ]);
  async function invoke<T>(
    operation: (context: TimeoutContext) => Promise<T>,
    requested: number | undefined,
    signal?: AbortSignal,
    responseMode?: string,
  ) {
    const context = createTimeoutContext(requested ?? DEFAULT_COMMAND_TIMEOUT_MS, signal);
    try {
      return result(formatResponse(await operation(context), responseMode));
    } catch (error: unknown) {
      return failure(error);
    } finally {
      context.dispose();
    }
  }

  server.tool(
    'get_godot_version',
    'Read the configured Godot version.',
    { godotPath, timeoutMs },
    async ({ godotPath, timeoutMs }, extra) =>
      invoke(
        async (context) => ({ version: await getGodotVersion(resolveGodotPath(godotPath), context) }),
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'list_projects',
    'Find Godot projects below a directory.',
    { directory: z.string(), recursive: z.boolean().optional(), timeoutMs },
    async ({ directory, recursive, timeoutMs }, extra) =>
      invoke((context) => listProjects(directory, recursive === true, context), timeoutMs, extra.signal),
  );
  server.tool(
    'get_project_info',
    'Read project metadata and files.',
    { projectPath, timeoutMs },
    async ({ projectPath, timeoutMs }, extra) =>
      invoke((context) => getProjectInfo(projectPath, context), timeoutMs, extra.signal),
  );
  server.tool(
    'get_scene_tree',
    'Read a static Godot scene tree.',
    { projectPath, scenePath: z.string().optional(), timeoutMs },
    async ({ projectPath, scenePath, timeoutMs }, extra) =>
      invoke((context) => getSceneTree(projectPath, scenePath ?? null, context), timeoutMs, extra.signal),
  );
  server.tool(
    'launch_project',
    'Launch a Godot project.',
    {
      godotPath,
      projectPath,
      evidenceDir,
      headless: z.boolean().optional(),
      extraArgs: z.array(z.string()).optional(),
      timeoutMs,
    },
    async (args, extra) =>
      invoke(
        async (context) =>
          (
            await launchProject({
              ...args,
              timeout: context,
              projectPath: args.projectPath,
              godotPath: args.godotPath || process.env.GODOT_PATH,
            })
          ).metadata,
        args.timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'get_debug_output',
    'Read process evidence.',
    { evidenceDir: z.string(), timeoutMs },
    async ({ evidenceDir, timeoutMs }, extra) =>
      invoke(
        async (context) => {
          context.throwIfCancelled();
          return readEvidence(evidenceDir);
        },
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool('stop_project', 'Stop a process.', { pid: pidSchema, timeoutMs }, async ({ pid, timeoutMs }, extra) =>
    invoke(
      (context) => stopProcess(pid, Math.min(timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS, context.remaining()), context),
      timeoutMs,
      extra.signal,
    ),
  );
  server.tool('cancel_project', 'Cancel a process.', { pid: pidSchema, timeoutMs }, async ({ pid, timeoutMs }, extra) =>
    invoke(
      (context) => cancelProcess(pid, Math.min(timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS, context.remaining()), context),
      timeoutMs,
      extra.signal,
    ),
  );
  server.tool(
    'get_process_status',
    'Inspect process state.',
    { pid: pidSchema, timeoutMs },
    async ({ pid, timeoutMs }, extra) =>
      invoke(
        async (context) => {
          context.throwIfCancelled();
          return getProcessStatus(pid);
        },
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'get_runtime_events',
    'Read runtime events from a cursor.',
    {
      evidenceDir: z.string(),
      subscriptionId: z.string().min(1).optional(),
      cursor,
      limit: z.number().int().positive().optional(),
      timeoutMs,
    },
    async ({ evidenceDir, cursor, limit, timeoutMs }, extra) =>
      invoke(
        async (context) => {
          context.throwIfCancelled();
          return readRuntimeEventsSince(evidenceDir, cursor ?? 0, limit ?? 100);
        },
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'subscribe_runtime_events',
    'Subscribe to runtime events with resumable cursor and filters.',
    {
      evidenceDir: z.string(),
      subscriptionId: z.string().min(1).optional(),
      cursor,
      event: eventNames,
      runId: z.string().min(1).optional(),
      payload: eventPayload,
      continuous: z.boolean().optional(),
      maxEvents: z.number().int().positive().optional(),
      pollIntervalMs: z.number().int().positive().optional(),
      limit: z.number().int().positive().optional(),
      timeoutMs: z.number().int().positive().optional(),
    },
    async (
      {
        evidenceDir,
        subscriptionId,
        cursor,
        event,
        runId,
        payload,
        continuous,
        maxEvents,
        pollIntervalMs,
        limit,
        timeoutMs,
      },
      extra,
    ) =>
      invoke(
        async (context) => {
          const filter = event || runId || payload ? { event, run_id: runId, payload } : undefined;
          if (!continuous) {
            return subscribeRuntimeEvents(evidenceDir, {
              cursor,
              signal: context.signal,
              limit,
              maxEvents: 1,
              pollIntervalMs,
              filter,
            });
          }
          const subscription = subscriptionId
            ? { subscription_id: subscriptionId }
            : await createEventSubscription(evidenceDir, { cursor, filter });
          const events = [];
          const stream = streamEventSubscription(evidenceDir, subscription.subscription_id, {
            signal: context.signal,
            limit,
            maxEvents: maxEvents ?? 100,
            pollIntervalMs,
          });
          while (events.length < (maxEvents ?? 100)) {
            const next = await stream.next();
            if (next.done) return { ...next.value, events };
            events.push(next.value);
            await server.sendLoggingMessage({
              level: 'info',
              logger: 'runtime-events',
              data: next.value,
            });
          }
          return {
            schema_version: '0.1',
            source: 'REAL',
            evidenceDir,
            subscription_id: subscription.subscription_id,
            status: 'ACTIVE',
            events,
            cancelled: false,
          };
        },
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'create_event_subscription',
    'Create a resumable runtime event subscription.',
    {
      evidenceDir: z.string(),
      cursor,
      event: eventNames,
      runId: z.string().min(1).optional(),
      payload: eventPayload,
      ackTimeoutMs: z.number().int().positive().optional(),
      timeoutMs,
    },
    async ({ evidenceDir, cursor, event, runId, payload, ackTimeoutMs, timeoutMs }, extra) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return createEventSubscription(evidenceDir, {
            cursor,
            filter: event || runId || payload ? { event, run_id: runId, payload } : undefined,
            ackTimeoutMs,
          });
        },
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'poll_event_subscription',
    'Poll a subscription and advance its persistent cursor.',
    {
      evidenceDir: z.string(),
      subscriptionId: z.string().min(1),
      limit: z.number().int().positive().optional(),
      timeoutMs,
    },
    async ({ evidenceDir, subscriptionId, limit, timeoutMs }, extra) =>
      invoke((context) => pollEventSubscription(evidenceDir, subscriptionId, limit ?? 100), timeoutMs, extra.signal),
  );
  server.tool(
    'cancel_event_subscription',
    'Cancel a persistent runtime event subscription.',
    { evidenceDir: z.string(), subscriptionId: z.string().min(1), timeoutMs },
    async ({ evidenceDir, subscriptionId, timeoutMs }, extra) =>
      invoke((context) => cancelEventSubscription(evidenceDir, subscriptionId), timeoutMs, extra.signal),
  );
  server.tool(
    'ack_event_subscription',
    'Acknowledge a received event cursor for reconnect-safe delivery.',
    {
      evidenceDir: z.string(),
      subscriptionId: z.string().min(1),
      cursor,
      timeoutMs,
    },
    async ({ evidenceDir, subscriptionId, cursor, timeoutMs }, extra) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          if (cursor === undefined) throw new Error('cursor is required');
          return acknowledgeEventSubscription(evidenceDir, subscriptionId, cursor);
        },
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'pause_event_subscription',
    'Pause a runtime event subscription.',
    { evidenceDir: z.string(), subscriptionId: z.string().min(1), timeoutMs },
    async ({ evidenceDir, subscriptionId, timeoutMs }, extra) =>
      invoke((context) => pauseEventSubscription(evidenceDir, subscriptionId), timeoutMs, extra.signal),
  );
  server.tool(
    'close_event_subscription',
    'Close a runtime event subscription permanently.',
    { evidenceDir: z.string(), subscriptionId: z.string().min(1), timeoutMs },
    async ({ evidenceDir, subscriptionId, timeoutMs }, extra) =>
      invoke((context) => closeEventSubscription(evidenceDir, subscriptionId), timeoutMs, extra.signal),
  );
  server.tool(
    'list_event_subscriptions',
    'List persisted runtime event subscriptions.',
    { evidenceDir: z.string(), timeoutMs },
    async ({ evidenceDir, timeoutMs }, extra) =>
      invoke((context) => listEventSubscriptions(evidenceDir), timeoutMs, extra.signal),
  );
  server.tool('list_active_runs', 'List currently active isolated runs.', { timeoutMs }, async ({ timeoutMs }, extra) =>
    invoke(
      async (context) => {
        context.throwIfCancelled();
        return { source: 'REAL', runs: runRegistry.active() };
      },

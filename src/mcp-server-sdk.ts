#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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
  createEventSubscription,
  pollEventSubscription,
  cancelEventSubscription,
  acknowledgeEventSubscription,
} from './godot-runtime.js';
import { runRegistry } from './run-registry.js';
import { buildContextPack } from './context-pack.js';
import { gitCheckpoint, gitRecovery } from './git-recovery.js';
import { classifyError } from './error-schema.js';
import { createTimeoutContext, TimeoutContext } from './timeout.js';
import type { McpFailureResult, McpToolResult } from './tool-types.js';

const info = { name: 'godot-game-harness-mcp', version: '0.1.0-preview.1' };
const server = new McpServer(info, { capabilities: { tools: {} } });
const projectPath = z.string();
const godotPath = z.string().optional();
const bridgePath = z.string();
const evidenceDir = z.string().optional();
const result = (value: unknown): McpToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const failure = (error: unknown): McpFailureResult => ({
  isError: true,
  content: [{ type: 'text' as const, text: JSON.stringify(classifyError(error)) }],
});
const timeoutMs = z.number().int().nonnegative().optional();
const cursor = z
  .union([
    z.number().int().nonnegative(),
    z.object({ run_id: z.string().min(1), sequence: z.number().int().nonnegative() }),
  ])
  .optional();
const eventNames = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional();
const eventPayload = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional();
async function invoke<T>(
  operation: (context: TimeoutContext) => Promise<T>,
  requested: number | undefined,
  signal?: AbortSignal,
) {
  const context = createTimeoutContext(requested ?? 30000, signal);
  try {
    return result(await operation(context));
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
server.tool(
  'stop_project',
  'Stop a process.',
  { pid: z.number().int(), timeoutMs },
  async ({ pid, timeoutMs }, extra) =>
    invoke(
      (context) => stopProcess(pid, Math.min(timeoutMs ?? 5000, context.remaining()), context),
      timeoutMs,
      extra.signal,
    ),
);
server.tool(
  'cancel_project',
  'Cancel a process.',
  { pid: z.number().int(), timeoutMs },
  async ({ pid, timeoutMs }, extra) =>
    invoke(
      (context) => cancelProcess(pid, Math.min(timeoutMs ?? 5000, context.remaining()), context),
      timeoutMs,
      extra.signal,
    ),
);
server.tool(
  'get_process_status',
  'Inspect process state.',
  { pid: z.number().int(), timeoutMs },
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
    { evidenceDir, cursor, event, runId, payload, continuous, maxEvents, pollIntervalMs, limit, timeoutMs },
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
        const events = [];
        const stream = streamRuntimeEvents(evidenceDir, {
          cursor,
          signal: context.signal,
          limit,
          maxEvents: maxEvents ?? 100,
          pollIntervalMs,
          filter,
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
        return { schema_version: '0.1', source: 'REAL', evidenceDir, events, cancelled: false };
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
    timeoutMs,
  },
  async ({ evidenceDir, cursor, event, runId, payload, timeoutMs }, extra) =>
    invoke(
      (context) => {
        context.throwIfCancelled();
        return createEventSubscription(evidenceDir, {
          cursor,
          filter: event || runId || payload ? { event, run_id: runId, payload } : undefined,
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
server.tool('list_active_runs', 'List currently active isolated runs.', { timeoutMs }, async ({ timeoutMs }, extra) =>
  invoke(
    async (context) => {
      context.throwIfCancelled();
      return { source: 'REAL', runs: runRegistry.active() };
    },
    timeoutMs,
    extra.signal,
  ),
);
server.tool(
  'stop_run',
  'Stop an isolated run by its run id.',
  { runId: z.string().min(1), timeoutMs },
  async ({ runId, timeoutMs }, extra) =>
    invoke(
      (context) => runRegistry.stop(runId, Math.min(timeoutMs ?? 5000, context.remaining())),
      timeoutMs,
      extra.signal,
    ),
);
server.tool(
  'cancel_run',
  'Cancel an isolated run by its run id.',
  { runId: z.string().min(1), timeoutMs },
  async ({ runId, timeoutMs }, extra) =>
    invoke(
      (context) => runRegistry.cancel(runId, Math.min(timeoutMs ?? 5000, context.remaining())),
      timeoutMs,
      extra.signal,
    ),
);
server.tool(
  'reclaim_orphan_runs',
  'Reclaim orphaned processes recorded by the run registry.',
  { timeoutMs },
  async ({ timeoutMs }, extra) =>
    invoke(
      (context) => runRegistry.reclaimOrphans(Math.min(timeoutMs ?? 5000, context.remaining())),
      timeoutMs,
      extra.signal,
    ),
);
server.tool('list_runs', 'List isolated runs and detect orphans.', { timeoutMs }, async ({ timeoutMs }, extra) =>
  invoke(
    async (context) => {
      context.throwIfCancelled();
      return { source: 'REAL', runs: runRegistry.list() };
    },
    timeoutMs,
    extra.signal,
  ),
);
server.tool(
  'get_runtime_scene_tree',
  'Query runtime scene tree.',
  { godotPath, projectPath, bridgePath, evidenceDir, timeoutMs },
  async (args, extra) =>
    invoke(
      (context) =>
        queryRuntimeSceneTree({
          ...args,
          timeout: context,
          projectPath: args.projectPath,
          bridgePath: args.bridgePath,
          godotPath: args.godotPath || process.env.GODOT_PATH,
        }),
      args.timeoutMs,
      extra.signal,
    ),
);
server.tool(
  'get_runtime_property',
  'Read a runtime property.',
  { godotPath, projectPath, bridgePath, evidenceDir, nodePath: z.string().optional(), property: z.string(), timeoutMs },
  async (args, extra) =>
    invoke(
      (context) =>
        queryRuntimeProperty({
          ...args,
          timeout: context,
          projectPath: args.projectPath,
          bridgePath: args.bridgePath,
          property: args.property,
          godotPath: args.godotPath || process.env.GODOT_PATH,
        }),
      args.timeoutMs,
      extra.signal,
    ),
);
server.tool(
  'set_runtime_property',
  'Write and read back a runtime property.',
  {
    godotPath,
    projectPath,
    bridgePath,
    evidenceDir,
    nodePath: z.string().optional(),
    property: z.string(),
    value: z.unknown(),
    timeoutMs,
  },
  async (args, extra) =>
    invoke(
      (context) =>
        mutateRuntimeProperty({
          ...args,
          timeout: context,
          projectPath: args.projectPath,
          bridgePath: args.bridgePath,
          property: args.property,
          value: args.value,
          godotPath: args.godotPath || process.env.GODOT_PATH,
        }),
      args.timeoutMs,
      extra.signal,
    ),
);
server.tool(
  'inject_runtime_input',
  'Inject a runtime key event.',
  {
    godotPath,
    projectPath,
    bridgePath,
    evidenceDir,
    keycode: z.number().int(),
    pressed: z.boolean().optional(),
    timeoutMs,
  },
  async (args, extra) =>
    invoke(
      (context) =>
        injectRuntimeInput({
          ...args,
          timeout: context,
          projectPath: args.projectPath,
          bridgePath: args.bridgePath,
          keycode: args.keycode,
          godotPath: args.godotPath || process.env.GODOT_PATH,
        }),
      args.timeoutMs,
      extra.signal,
    ),
);
server.tool(
  'capture_runtime_screenshot',
  'Capture a runtime PNG.',
  { godotPath, projectPath, bridgePath, evidenceDir, screenshotPath: z.string().optional(), timeoutMs },
  async (args, extra) =>
    invoke(
      (context) =>
        captureRuntimeScreenshot({
          ...args,
          timeout: context,
          projectPath: args.projectPath,
          bridgePath: args.bridgePath,
          godotPath: args.godotPath || process.env.GODOT_PATH,
        }),
      args.timeoutMs,
      extra.signal,
    ),
);
server.tool(
  'get_context_pack',
  'Build a read-only context pack.',
  { godotPath, projectPath, evidenceDir, scenePath: z.string().optional(), timeoutMs },
  async (args, extra) =>
    invoke(
      (context) =>
        buildContextPack({
          ...args,
          timeout: context,
          projectPath: args.projectPath,
          godotPath: args.godotPath || process.env.GODOT_PATH,
        }),
      args.timeoutMs,
      extra.signal,
    ),
);
server.tool(
  'git_checkpoint',
  'Capture Git checkpoint evidence.',
  { projectPath, evidenceDir, timeoutMs },
  async ({ projectPath, evidenceDir, timeoutMs }, extra) =>
    invoke(
      async (context) => {
        context.throwIfCancelled();
        return gitCheckpoint(projectPath, evidenceDir, context);
      },
      timeoutMs,
      extra.signal,
    ),
);
server.tool(
  'git_recovery',
  'Reverse an explicit patch.',
  { projectPath, patchPath: z.string(), timeoutMs },
  async ({ projectPath, patchPath, timeoutMs }, extra) =>
    invoke(
      async (context) => {
        context.throwIfCancelled();
        return gitRecovery(projectPath, patchPath, context);
      },
      timeoutMs,
      extra.signal,
    ),
);

await server.connect(new StdioServerTransport());

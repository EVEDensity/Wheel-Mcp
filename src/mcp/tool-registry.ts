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
      timeoutMs,
      extra.signal,
    ),
  );
  server.tool(
    'stop_run',
    'Stop an isolated run by its run id.',
    { runId: z.string().min(1), timeoutMs },
    async ({ runId, timeoutMs }, extra) =>
      invoke((context) => runRegistry.stop(runId, context), timeoutMs, extra.signal),
  );
  server.tool(
    'cancel_run',
    'Cancel an isolated run by its run id.',
    { runId: z.string().min(1), timeoutMs },
    async ({ runId, timeoutMs }, extra) =>
      invoke((context) => runRegistry.cancel(runId, context), timeoutMs, extra.signal),
  );
  server.tool(
    'reclaim_orphan_runs',
    'Reclaim orphaned processes recorded by the run registry.',
    { timeoutMs },
    async ({ timeoutMs }, extra) => invoke((context) => runRegistry.reclaimOrphans(context), timeoutMs, extra.signal),
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
    {
      godotPath,
      projectPath,
      bridgePath,
      evidenceDir,
      nodePath: z.string().optional(),
      property: z.string(),
      timeoutMs,
    },
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
    'create_runtime_node',
    'Create a node in the running Godot scene.',
    {
      sessionId: z.string().min(1),
      parentPath: z.string().optional(),
      type: z.string().min(1),
      name: z.string().optional(),
      properties: z.record(z.string(), z.unknown()).optional(),
      timeoutMs,
    },
    async ({ sessionId, parentPath, type, name, properties, timeoutMs }, extra) =>
      invoke(
        (context) =>
          callRuntimeBridge(
            sessionId,
            'create_node',
            { parentPath: parentPath ?? '.', type, name, properties: properties ?? {} },
            context,
          ),
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'delete_runtime_node',
    'Delete a node from the running Godot scene.',
    { sessionId: z.string().min(1), nodePath: z.string().min(1), timeoutMs },
    async ({ sessionId, nodePath, timeoutMs }, extra) =>
      invoke((context) => callRuntimeBridge(sessionId, 'delete_node', { nodePath }, context), timeoutMs, extra.signal),
  );
  server.tool(
    'call_runtime_method',
    'Call a script or engine method on a running Godot node.',
    {
      sessionId: z.string().min(1),
      nodePath: z.string().optional(),
      method: z.string().min(1),
      args: z.array(z.unknown()).optional(),
      timeoutMs,
    },
    async ({ sessionId, nodePath, method, args, timeoutMs }, extra) =>
      invoke(
        (context) =>
          callRuntimeBridge(sessionId, 'call_method', { nodePath: nodePath ?? '.', method, args: args ?? [] }, context),
        timeoutMs,
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
      keycode: keycodeSchema,
      pressed: pressedSchema,
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
    'open_runtime_bridge',
    'Open a persistent Godot runtime bridge session.',
    {
      godotPath,
      projectPath,
      bridgePath,
      evidenceDir,
      sessionId: z.string().min(1).optional(),
      headless: z.boolean().optional(),
      timeoutMs,
    },
    async ({ godotPath, projectPath, bridgePath, evidenceDir, sessionId, headless, timeoutMs }, extra) =>
      invoke(
        (context) =>
          openRuntimeBridge({
            godotPath: godotPath || process.env.GODOT_PATH,
            projectPath,
            bridgePath,
            evidenceDir,
            runId: sessionId,
            headless,
            timeout: context,
          }),
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'call_runtime_bridge',
    'Send a JSON-RPC request to a persistent Godot runtime bridge session.',
    {
      sessionId: z.string().min(1),
      method: runtimeMethod,
      params: z.record(z.string(), z.unknown()).optional(),
      timeoutMs,
    },
    async ({ sessionId, method, params, timeoutMs }, extra) =>
      invoke((context) => callRuntimeBridge(sessionId, method, params || {}, context), timeoutMs, extra.signal),
  );
  server.tool(
    'stop_runtime_bridge',
    'Stop a persistent Godot runtime bridge session.',
    { sessionId: z.string().min(1), timeoutMs },
    async ({ sessionId, timeoutMs }, extra) =>
      invoke((context) => stopRuntimeBridge(sessionId, context), timeoutMs, extra.signal),
  );
  server.tool(
    'wait_for_event',
    'Wait for one event from a persistent runtime bridge.',
    { sessionId: z.string().min(1), event: z.string().min(1), timeoutMs },
    async ({ sessionId, event, timeoutMs }, extra) =>
      invoke(
        async (context) => {
          const bridge = await import('./persistent-runtime-bridge.js').then((m) => m.getRuntimeBridge(sessionId));
          return { event: await bridge.waitForEvent(event, context) };
        },
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'reload_scene',
    'Reload the active scene in a persistent runtime bridge.',
    { sessionId: z.string().min(1), scenePath: z.string().optional(), timeoutMs },
    async ({ sessionId, scenePath, timeoutMs }, extra) =>
      invoke(
        (context) => callRuntimeBridge(sessionId, 'reload_scene', { scenePath }, context),
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'read_project_file',
    'Read a text file inside a Godot project.',
    { projectPath, filePath: z.string(), timeoutMs },
    async ({ projectPath, filePath, timeoutMs }, extra) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return readProjectFile(projectPath, filePath);
        },
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'write_project_file',
    'Write a text file inside a Godot project.',
    { projectPath, filePath: z.string(), content: z.string(), timeoutMs },
    async ({ projectPath, filePath, content, timeoutMs }, extra) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return writeProjectFile(projectPath, filePath, content);
        },
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'search_project',
    'Search project text files and return compact matching lines.',
    {
      projectPath,
      query: z.string().min(1),
      glob: z.string().optional(),
      maxResults: z.number().int().positive().max(1000).optional(),
      timeoutMs,
    },
    async ({ projectPath, query, glob, maxResults, timeoutMs }, extra) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return searchProject(projectPath, query, { glob, maxResults });
        },
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'get_script_errors',
    'Read parser/script diagnostics from evidence.',
    { evidenceDir: z.string(), projectPath: z.string().optional(), timeoutMs },
    async ({ evidenceDir, projectPath, timeoutMs }, extra) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return readGodotDiagnostics(evidenceDir, projectPath);
        },
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'get_runtime_errors',
    'Read runtime diagnostics from evidence.',
    { evidenceDir: z.string(), projectPath: z.string().optional(), timeoutMs },
    async ({ evidenceDir, projectPath, timeoutMs }, extra) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return readGodotDiagnostics(evidenceDir, projectPath);
        },
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'compare_screenshots',
    'Compare two screenshots for byte identity.',
    {
      firstPath: z.string(),
      secondPath: z.string(),
      threshold: z.number().int().min(0).max(255).optional(),
      ignoreAlpha: z.boolean().optional(),
      writeDiff: z.boolean().optional(),
      diffPath: z.string().optional(),
      responseMode,
      timeoutMs,
    },
    async ({ firstPath, secondPath, threshold, ignoreAlpha, writeDiff, diffPath, responseMode, timeoutMs }, extra) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return compareScreenshots(firstPath, secondPath, { threshold, ignoreAlpha, writeDiff, diffPath });
        },
        timeoutMs,
        extra.signal,
        responseMode,
      ),
  );
  server.tool(
    'get_recent_evidence',
    'List recent evidence artifacts.',
    { evidenceDir: z.string(), timeoutMs },
    async ({ evidenceDir, timeoutMs }, extra) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return getRecentEvidence(evidenceDir);
        },
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'read_scene_file',
    'Read a Godot .tscn scene file.',
    { projectPath, scenePath: z.string(), timeoutMs },
    async ({ projectPath, scenePath, timeoutMs }, extra) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return readSceneFile(projectPath, scenePath);
        },
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'write_scene_file',
    'Save a Godot .tscn scene file after explicit content edits.',
    { projectPath, scenePath: z.string(), content: z.string(), timeoutMs },
    async ({ projectPath, scenePath, content, timeoutMs }, extra) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return writeSceneFile(projectPath, scenePath, content);
        },
        timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'get_godot_diagnostics',
    'Parse Godot parser and runtime errors from an evidence directory.',
    { evidenceDir: z.string(), projectPath: z.string().optional(), timeoutMs },
    async ({ evidenceDir, projectPath, timeoutMs }, extra) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return readGodotDiagnostics(evidenceDir, projectPath);
        },
        timeoutMs,
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

  server.tool(
    'run_test_scene',
    'Run a Godot test scene through the scenario executor.',
    {
      scenario: scenarioSchema,
      scenarioPath: z.string().optional(),
      godotPath,
      bridgePath,
      evidenceDir,
      retries: z.number().int().nonnegative().optional(),
      timeoutMs,
    },
    async (args, extra) =>
      invoke(
        (context) => executeScenario({ ...args, globalTimeoutMs: args.timeoutMs, signal: extra.signal }),
        args.timeoutMs,
        extra.signal,
      ),
  );
  server.tool(
    'execute_scenario',
    'Execute a declarative Godot scenario with shared timeout and evidence semantics.',
    {
      scenario: scenarioSchema,
      scenarioPath: z.string().optional(),
      godotPath,
      bridgePath,
      evidenceDir,
      defaultStepTimeoutMs: z.number().int().positive().optional(),
      globalTimeoutMs: z.number().int().positive().optional(),
      retries: z.number().int().nonnegative().optional(),
      onFailure: z.enum(['stop', 'continue']).optional(),
      timeoutMs,
    },
    async (
      {
        scenario,
        scenarioPath,
        godotPath,
        bridgePath,
        evidenceDir,
        defaultStepTimeoutMs,
        globalTimeoutMs,
        retries,
        onFailure,
        timeoutMs,
      },
      extra,
    ) =>
      invoke(
        (context) =>
          executeScenario({
            scenario,
            scenarioPath,
            godotPath: godotPath || process.env.GODOT_PATH,
            bridgePath,
            evidenceDir,
            defaultStepTimeoutMs,
            globalTimeoutMs,
            retries,
            onFailure,
            signal: context.signal,
          }),
        timeoutMs,
        extra.signal,
      ),
  );
}

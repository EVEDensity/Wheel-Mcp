import { z } from 'zod';
import {
  captureRuntimeScreenshot,
  getProcessStatus,
  injectRuntimeInput,
  launchProject,
  mutateRuntimeProperty,
  queryRuntimeProperty,
  queryRuntimeSceneTree,
  stopProcess,
  cancelProcess,
  readRuntimeEventsSince,
  subscribeRuntimeEvents,
  streamEventSubscription,
  createEventSubscription,
  pollEventSubscription,
  cancelEventSubscription,
  acknowledgeEventSubscription,
  pauseEventSubscription,
  closeEventSubscription,
  listEventSubscriptions,
} from '../../godot-runtime.js';
import { runRegistry } from '../../run-registry.js';
import { DEFAULT_STOP_TIMEOUT_MS } from '../../timeouts.js';
import { openRuntimeBridge, callRuntimeBridge, stopRuntimeBridge } from '../../persistent-runtime-bridge.js';
import { keycodeSchema, pidSchema, pressedSchema } from '../../input-schemas.js';
import type { ToolRegistrationContext } from '../tool-context.js';
export function registerRuntimeTools(context: ToolRegistrationContext): void {
  const { server, invoke, schemas } = context;
  const sessionId = z.string().min(1);
  const {
    projectPath,
    godotPath,
    bridgePath,
    evidenceDir,
    timeoutMs,
    responseMode,
    cursor,
    eventNames,
    eventPayload,
    runtimeMethod,
  } = schemas;
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


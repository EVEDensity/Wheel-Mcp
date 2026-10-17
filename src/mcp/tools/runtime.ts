import { z } from 'zod';
import {
  captureRuntimeScreenshot,
  getProcessStatus,
  injectRuntimeInput,
  launchProject,
  mutateRuntimeProperty,
  queryRuntimeProperty,
  queryRuntimeSceneTree,
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
import {
  openRuntimeBridge,
  callRuntimeBridge,
  stopRuntimeBridge,
  getRuntimeOperationStatus,
} from '../../persistent-runtime-bridge.js';
import { keycodeSchema, pidSchema, pressedSchema } from '../../input-schemas.js';
import { collisionQuerySchema } from '../../runtime/physics-query.js';
import type { ToolRegistrationContext } from '../tool-context.js';
import { inspectOwnedProcess, stopOwnedProcess } from '../owned-process.js';
export function registerRuntimeTools(context: ToolRegistrationContext): void {
  const { server, invoke, schemas, policy } = context;
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
    sceneTreeQuery,
  } = schemas;
  server.tool(
    'launch_project',
    'Launch a Godot project in the background by default. Use headless:false only for a visible game/renderer. For repeated stateful operations, open one persistent runtime bridge instead of repeatedly launching.',
    {
      godotPath,
      projectPath,
      evidenceDir,
      headless: z
        .boolean()
        .default(true)
        .describe('Background logic/physics by default. Set false for visible preview or rendered screenshots.'),
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
    'stop_project',
    'Stop a registered process after OS identity verification.',
    { pid: pidSchema, timeoutMs },
    async ({ pid, timeoutMs }, extra) =>
      invoke(
        (context) => (policy ? stopOwnedProcess(policy, pid, context) : runRegistry.stopByPid(pid, context)),
        timeoutMs,
        extra.signal,
      ),
  );

  server.tool(
    'cancel_project',
    'Cancel a registered process after OS identity verification.',
    { pid: pidSchema, timeoutMs },
    async ({ pid, timeoutMs }, extra) =>
      invoke(
        (context) => (policy ? stopOwnedProcess(policy, pid, context, true) : runRegistry.cancelByPid(pid, context)),
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
          return policy ? inspectOwnedProcess(policy, pid, context) : getProcessStatus(pid);
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
      limit: z.number().int().min(1).max(500).optional(),
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
      maxEvents: z.number().int().min(1).max(500).optional(),
      pollIntervalMs: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(500).optional(),
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
            : await createEventSubscription(evidenceDir, { cursor, filter, ownerClientId: policy?.clientId });
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
            ownerClientId: policy?.clientId,
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
      limit: z.number().int().min(1).max(500).optional(),
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
      invoke(
        async (context) => {
          const subscriptions = await listEventSubscriptions(evidenceDir);
          context.throwIfCancelled();
          return policy && !policy.scopes.has('admin')
            ? subscriptions.filter((item) => item.owner_client_id === policy.clientId)
            : subscriptions;
        },
        timeoutMs,
        extra.signal,
      ),
  );

  server.tool('list_active_runs', 'List currently active isolated runs.', { timeoutMs }, async ({ timeoutMs }, extra) =>
    invoke(
      async (context) => {
        context.throwIfCancelled();
        return {
          source: 'REAL',
          runs:
            policy && !policy.scopes.has('admin')
              ? runRegistry.active().filter((run) => policy.ownedRunIds.has(run.runId))
              : runRegistry.active(),
        };
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
        return {
          source: 'REAL',
          runs:
            policy && !policy.scopes.has('admin')
              ? runRegistry.list().filter((run) => policy.ownedRunIds.has(run.runId))
              : runRegistry.list(),
        };
      },
      timeoutMs,
      extra.signal,
    ),
  );

  server.tool(
    'get_runtime_scene_tree',
    'Legacy one-shot: query the scene tree in a new background Godot process. For repeated queries, use call_runtime_bridge get_scene_tree with one explicit sessionId.',
    { godotPath, projectPath, bridgePath, evidenceDir, ...sceneTreeQuery, timeoutMs },
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
    'Legacy one-shot: read a runtime property in a new Godot process. For shared state, open_runtime_bridge and call_runtime_bridge with the same sessionId.',
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
    'Legacy one-shot: write and read back in a new Godot process; state is not retained. For shared state, use one explicit open_runtime_bridge sessionId.',
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
    'Legacy one-shot: inject a key in a new Godot process; later one-shot calls cannot observe that state. Use call_runtime_bridge with one sessionId for continuity.',
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
    'Capture a PNG from a new rendered Godot process. Background rendering is enabled by default: start off-screen, then minimize and disable focus before loading the scene. This is not headless. For shared state reuse call_runtime_bridge capture_screenshot on a session opened with headless:false, background:true. Set background:false only for an explicit visible preview. OS/driver startup dialogs are not suppressed.',
    {
      godotPath,
      projectPath,
      bridgePath,
      evidenceDir,
      screenshotPath: z.string().optional(),
      background: z.boolean().default(true),
      timeoutMs,
    },
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
    'Open one persistent Godot runtime bridge in headless mode by default. Reuse its sessionId for input, state and reload without restarting Godot. Use headless:false, background:true for minimized rendered screenshots, or headless:false, background:false for a visible preview; never implicitly attach to another session.',
    {
      godotPath,
      projectPath,
      bridgePath,
      evidenceDir,
      sessionId: z.string().min(1).optional(),
      scenePath: z.string().optional(),
      headless: z
        .boolean()
        .default(true)
        .describe('Background logic/physics by default. Set false for visible preview or rendered screenshots.'),
      background: z
        .boolean()
        .default(true)
        .describe(
          'With headless:false, start off-screen and minimize the unfocusable render window before scene loading. Ignored for headless sessions. Set false only for visible previews.',
        ),
      timeoutMs,
    },
    async (
      { godotPath, projectPath, bridgePath, evidenceDir, sessionId, scenePath, headless, background, timeoutMs },
      extra,
    ) =>
      invoke(
        (context) =>
          openRuntimeBridge({
            godotPath: godotPath || process.env.GODOT_PATH,
            projectPath,
            bridgePath,
            evidenceDir,
            runId: sessionId,
            scenePath,
            headless,
            background,
            timeout: context,
          }),
        timeoutMs,
        extra.signal,
      ),
  );

  server.tool(
    'call_runtime_bridge',
    'Send a JSON-RPC request to an owned persistent runtime session. step_character_2d requires character.step2d/v1 and params {nodePath,velocity:{x,y},frames}: velocity +/-1000 px/s, 1..30 native physics frames. Optional gravity 0..4000 world +Y px/s² and jumpSpeed >0..1000 require character.gravity2d/v1 (runtime 0.3.3); jump also requires positive gravity, initial velocity.y=0 and fresh flat-floor contact. No idle gravity, keyboard consumption or permanent controller; explicitly seed continuation from returned velocity. Reuse operationId after UNKNOWN only to inspect/replay the original command, never blindly submit new input/movement. inject_input supports type:text with text equal to one non-control Unicode scalar (input.text_scalar/v1, runtime 0.3.4): follows current game focus, not IME, paste, OS keyboard automation or node targeting. mouse_wheel uses direction up/down/left/right, viewport position {x,y}, factor >0..8 (default 1), requires input.mouse_wheel/v1. Acceptance is injection only; read actual GUI state to prove consumption.',
    {
      sessionId: z.string().min(1),
      method: runtimeMethod,
      params: z.record(z.string(), z.unknown()).optional(),
      operationId: z.string().min(1).max(128).optional(),
      responseMode,
      timeoutMs,
    },
    async ({ sessionId, method, params, operationId, responseMode, timeoutMs }, extra) =>
      invoke(
        (context) => callRuntimeBridge(sessionId, method, params || {}, context, operationId),
        timeoutMs,
        extra.signal,
        responseMode,
      ),
  );

  server.tool(
    'get_runtime_operation_status',
    'Inspect a write operation by sessionId and operationId after timeout or cancellation; never blindly retry an UNKNOWN write.',
    { sessionId: z.string().min(1), operationId: z.string().min(1).max(128), timeoutMs },
    async ({ sessionId, operationId, timeoutMs }, extra) =>
      invoke((context) => getRuntimeOperationStatus(sessionId, operationId), timeoutMs, extra.signal),
  );

  server.tool(
    'stop_runtime_bridge',
    'Stop a persistent Godot runtime bridge session.',
    { sessionId: z.string().min(1), timeoutMs },
    async ({ sessionId, timeoutMs }, extra) =>
      invoke((context) => stopRuntimeBridge(sessionId, context), timeoutMs, extra.signal),
  );

  server.tool(
    'get_game_state',
    'Read selected runtime properties.',
    { sessionId, nodePath: z.string().optional(), properties: z.array(z.string()).optional(), responseMode, timeoutMs },
    async (a: any, e: any) =>
      invoke(
        (c: any) =>
          callRuntimeBridge(
            a.sessionId,
            'get_game_state',
            {
              nodePath: a.nodePath,
              properties: a.properties,
            },
            c,
          ),
        a.timeoutMs,
        e.signal,
        a.responseMode,
      ),
  );

  server.tool(
    'get_specialized_state',
    'Read specialized runtime state.',
    { sessionId, nodePath: z.string().optional(), responseMode, timeoutMs },
    async (a: any, e: any) =>
      invoke(
        (c: any) => callRuntimeBridge(a.sessionId, 'get_specialized_state', { nodePath: a.nodePath }, c),
        a.timeoutMs,
        e.signal,
        a.responseMode,
      ),
  );

  server.tool(
    'query_runtime_collisions',
    'Query 2D collisions or physics-frame scheduled 3D overlap/ray/shape samples. History is not contact events.',
    {
      sessionId,
      ...collisionQuerySchema.shape,
      responseMode,
      timeoutMs,
    },
    async (a: any, e: any) =>
      invoke(
        (c: any) =>
          callRuntimeBridge(
            a.sessionId,
            'query_collisions',
            {
              nodePath: a.nodePath,
              historyLimit: a.historyLimit,
              refresh: a.refresh,
              queryMode: a.queryMode,
              collisionMask: a.collisionMask,
              collideWithBodies: a.collideWithBodies,
              collideWithAreas: a.collideWithAreas,
              exclude: a.exclude,
              margin: a.margin,
              maxResults: a.maxResults,
            },
            c,
          ),
        a.timeoutMs,
        e.signal,
        a.responseMode,
      ),
  );
}

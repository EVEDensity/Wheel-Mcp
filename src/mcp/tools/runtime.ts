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


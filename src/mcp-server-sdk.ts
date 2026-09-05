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
} from './godot-runtime.js';
import { runRegistry } from './run-registry.js';
import { buildContextPack } from './context-pack.js';
import { gitCheckpoint, gitRecovery } from './git-recovery.js';
import { classifyError } from './error-schema.js';
import { createTimeoutContext, TimeoutContext } from './timeout.js';

const info = { name: 'godot-game-harness-mcp', version: '0.1.0-preview.1' };
const server = new McpServer(info, { capabilities: { tools: {} } });
const projectPath = z.string();
const godotPath = z.string().optional();
const bridgePath = z.string();
const evidenceDir = z.string().optional();
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const failure = (error: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: JSON.stringify(classifyError(error)) }],
});
const timeoutMs = z.number().int().nonnegative().optional();
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
    invoke((context) => stopProcess(pid, Math.min(timeoutMs ?? 5000, context.remaining())), timeoutMs, extra.signal),
);
server.tool(
  'cancel_project',
  'Cancel a process.',
  { pid: z.number().int(), timeoutMs },
  async ({ pid, timeoutMs }, extra) =>
    invoke((context) => cancelProcess(pid, Math.min(timeoutMs ?? 5000, context.remaining())), timeoutMs, extra.signal),
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
    cursor: z.number().int().nonnegative().optional(),
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
  'Wait for the next matching runtime event.',
  {
    evidenceDir: z.string(),
    cursor: z.number().int().nonnegative().optional(),
    event: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
  },
  async ({ evidenceDir, cursor, event, timeoutMs }, extra) =>
    invoke(
      (context) =>
        subscribeRuntimeEvents(evidenceDir, {
          cursor,
          signal: context.signal,
          filter: event
            ? (item: unknown) =>
                typeof item === 'object' && item !== null && (item as { event?: unknown }).event === event
            : undefined,
        }),
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
        return gitCheckpoint(projectPath, evidenceDir);
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
        return gitRecovery(projectPath, patchPath);
      },
      timeoutMs,
      extra.signal,
    ),
);

await server.connect(new StdioServerTransport());

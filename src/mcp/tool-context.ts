import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { classifyError } from '../error-schema.js';
import { createTimeoutContext, type TimeoutContext } from '../timeout.js';
import type { McpToolResult } from '../tool-types.js';
import { createUnifiedResponse } from '../response-types.js';
import { timeoutMsSchema } from '../input-schemas.js';
import { DEFAULT_COMMAND_TIMEOUT_MS } from '../timeouts.js';

export const toolSchemas = {
  projectPath: z.string(),
  godotPath: z.string().optional(),
  bridgePath: z.string(),
  evidenceDir: z.string().optional(),
  timeoutMs: timeoutMsSchema,
  responseMode: z.enum(['compact', 'normal', 'verbose']).optional(),
  cursor: z
    .union([
      z.number().int().nonnegative(),
      z.object({ run_id: z.string().min(1), sequence: z.number().int().nonnegative() }),
    ])
    .optional(),
  eventNames: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  eventPayload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  runtimeMethod: z.enum([
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
    'wait_physics_frames',
    'get_specialized_state',
    'get_game_state',
    'query_collisions',
  ]),
};
export type ToolRegistrationContext = { server: McpServer; schemas: typeof toolSchemas; invoke: typeof invokeTool };
export function formatToolResponse(value: unknown, mode?: string): unknown {
  if (mode !== 'compact' || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  const out: Record<string, unknown> = {
    status: v.status ?? (v.same === true ? 'PASS' : v.same === false ? 'FAIL' : 'OK'),
  };
  for (const key of [
    'code',
    'message',
    'errorCount',
    'changedFiles',
    'screenshotPath',
    'diffPath',
    'evidencePath',
    'evidenceDir',
    'summary',
    'session_id',
    'pid',
    'cleanup',
    'metrics',
  ])
    if (v[key] !== undefined) out[key] = v[key];
  if (Array.isArray(v.diagnostics)) out.errorCount = v.diagnostics.filter((d) => d.severity === 'error').length;
  return out;
}
export async function invokeTool<T>(
  operation: (context: TimeoutContext) => Promise<T>,
  requested?: number,
  signal?: AbortSignal,
  mode?: string,
): Promise<McpToolResult> {
  const context = createTimeoutContext(requested ?? DEFAULT_COMMAND_TIMEOUT_MS, signal);
  let data: unknown;
  let failed = false;
  try {
    context.throwIfCancelled();
    data = formatToolResponse(await operation(context), mode);
  } catch (error) {
    data = classifyError(error);
    failed = true;
  } finally {
    context.dispose();
  }
  const body =
    data && typeof data === 'object' && !Array.isArray(data)
      ? createUnifiedResponse(data as Record<string, unknown>)
      : { schema_version: '0.1', source: 'REAL', data };
  if ((body as Record<string, unknown>).status === 'FAIL') failed = true;
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    structuredContent: body,
    ...(failed ? { isError: true } : {}),
  };
}

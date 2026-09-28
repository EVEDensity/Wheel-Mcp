import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { classifyError } from '../error-schema.js';
import { createTimeoutContext, type TimeoutContext } from '../timeout.js';
import type { McpToolResult } from '../tool-types.js';
import { assertNoNestedFailure, createUnifiedResponse } from '../response-types.js';
import { timeoutMsSchema } from '../input-schemas.js';
import { DEFAULT_COMMAND_TIMEOUT_MS } from '../timeouts.js';
import { budgetResponse } from '../response-budget.js';
import type { McpClientPolicy } from './access-policy.js';
import type { ApprovalVerifier } from '../project/transactions.js';

export const toolSchemas = {
  projectPath: z.string(),
  godotPath: z.string().optional(),
  bridgePath: z.string(),
  evidenceDir: z.string().optional(),
  timeoutMs: timeoutMsSchema,
  responseMode: z.enum(['compact', 'normal', 'verbose']).optional(),
  sceneTreeQuery: {
    subtree: z.string().min(1).optional(),
    depth: z.number().int().min(0).max(64).optional(),
    fields: z
      .array(z.enum(['name', 'type', 'parent', 'owner', 'path']))
      .max(5)
      .optional(),
    limit: z.number().int().min(1).max(500).optional(),
    cursor: z.number().int().nonnegative().optional(),
  },
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
export type ToolRegistrationContext = {
  server: McpServer;
  schemas: typeof toolSchemas;
  invoke: typeof invokeTool;
  policy?: McpClientPolicy;
  approveProjectTransaction: ApprovalVerifier;
  transactionOwnerId: string;
};
const compactBusinessFields: Record<string, readonly string[]> = {
  PERSISTENT_RUNTIME_BRIDGE: ['method', 'operation_id', 'response'],
  RUNTIME_GAME_STATE: ['nodePath', 'properties'],
  RUNTIME_SPECIALIZED_STATE: ['nodePath', 'state'],
  RUNTIME_COLLISION_QUERY: [
    'nodePath',
    'overlaps',
    'lastCollision',
    'updatedAt',
    'history',
    'historyLimit',
    'historyMode',
    'dimension',
    'queryMode',
    'coordinateSpace',
    'shapeOwnerTransformSpace',
    'schedule',
    'physicsFrame',
    'filterPolicy',
    'filters',
    'shapeOwners',
    'truncated',
    'contactHistory',
    'cached',
    'rayTargetSpace',
    'rayFrom',
    'rayTo',
    'rayEnabled',
    'collisionLayer',
    'physicsEngine',
  ],
  RUNTIME_SCENE_TREE: ['scene', 'nodes', 'next_cursor', 'truncated'],
  STATIC_SCENE_TREE: ['scenePath', 'nodes', 'next_cursor', 'truncated'],
};
export function formatToolResponse(value: unknown, mode?: string): unknown {
  if (mode !== 'compact' || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  const businessFields = compactBusinessFields[String(v.capability)];
  const out: Record<string, unknown> = {
    status: v.status ?? (v.same === true ? 'PASS' : v.same === false ? 'FAIL' : 'OK'),
  };
  for (const key of [
    'schema_version',
    'source',
    'capability',
    'runtime',
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
    ...(businessFields ?? []),
  ])
    if (v[key] !== undefined) out[key] = v[key];
  if (!businessFields) {
    const redundant = new Set(['events', 'diagnostics', 'attempts', 'stdout', 'stderr']);
    for (const [key, item] of Object.entries(v)) if (!redundant.has(key) && !(key in out)) out[key] = item;
  }
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
    const result = await operation(context);
    assertNoNestedFailure(result);
    data = formatToolResponse(result, mode);
  } catch (error) {
    data = classifyError(error);
    failed = true;
  } finally {
    context.dispose();
  }
  let body: Record<string, unknown> =
    data && typeof data === 'object' && !Array.isArray(data)
      ? createUnifiedResponse(data as Record<string, unknown>)
      : { schema_version: '0.1', source: 'REAL', data };
  if (body.status === 'FAIL') failed = true;
  try {
    body = budgetResponse(body);
  } catch (error) {
    body = classifyError(error) as unknown as Record<string, unknown>;
    failed = true;
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    structuredContent: body,
    ...(failed ? { isError: true } : {}),
  };
}

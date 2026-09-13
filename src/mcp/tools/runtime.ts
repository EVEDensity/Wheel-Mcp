import { z } from 'zod';
import type { ToolRegistrationContext } from '../tool-registry.js';
export function registerRuntimeTools({ server, functions, schemas, invoke }: ToolRegistrationContext): void {
  const responseMode = schemas.responseMode;
  const timeoutMs = schemas.timeoutMs;
  const sessionId = z.string().min(1);
  server.tool(
    'get_game_state',
    'Read selected runtime properties.',
    { sessionId, nodePath: z.string().optional(), properties: z.array(z.string()).optional(), responseMode, timeoutMs },
    async (a: any, e: any) =>
      invoke(
        (c: any) =>
          functions.callRuntimeBridge(a.sessionId, 'get_game_state', {
            nodePath: a.nodePath,
            properties: a.properties,
          }),
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
        (c: any) => functions.callRuntimeBridge(a.sessionId, 'get_specialized_state', { nodePath: a.nodePath }),
        a.timeoutMs,
        e.signal,
        a.responseMode,
      ),
  );
  server.tool(
    'query_runtime_collisions',
    'Query runtime collisions and history.',
    {
      sessionId,
      nodePath: z.string(),
      historyLimit: z.number().int().min(1).max(256).optional(),
      refresh: z.boolean().optional(),
      responseMode,
      timeoutMs,
    },
    async (a: any, e: any) =>
      invoke(
        (c: any) =>
          functions.callRuntimeBridge(a.sessionId, 'query_collisions', {
            nodePath: a.nodePath,
            historyLimit: a.historyLimit,
            refresh: a.refresh,
          }),
        a.timeoutMs,
        e.signal,
        a.responseMode,
      ),
  );
}

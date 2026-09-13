import { z } from 'zod';
import type { ToolRegistrationContext } from '../tool-registry.js';
export function registerScenarioTools({ server, invoke, schemas, functions }: ToolRegistrationContext): void {
  server.tool(
    'wait_for_event',
    'Wait for a runtime event in a bridge session.',
    {
      sessionId: z.string().min(1),
      event: z.string().min(1),
      timeoutMs: schemas.timeoutMs,
      responseMode: schemas.responseMode,
    },
    async (a: any, e: any) =>
      invoke(
        () => functions.getRuntimeBridge(a.sessionId).waitForEvent(a.event),
        a.timeoutMs,
        e.signal,
        a.responseMode,
      ),
  );
  server.tool(
    'reload_scene',
    'Reload the current or requested scene in a persistent bridge.',
    {
      sessionId: z.string().min(1),
      scenePath: z.string().optional(),
      timeoutMs: schemas.timeoutMs,
      responseMode: schemas.responseMode,
    },
    async (a: any, e: any) =>
      invoke(
        (c: any) => functions.callRuntimeBridge(a.sessionId, 'reload_scene', { scenePath: a.scenePath }, c),
        a.timeoutMs,
        e.signal,
        a.responseMode,
      ),
  );
}

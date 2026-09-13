import { z } from 'zod';
import type { ToolRegistrationContext } from '../tool-registry.js';
export function registerProjectTools({ server, invoke, schemas, functions }: ToolRegistrationContext): void {
  server.tool(
    'analyze_collisions',
    'Analyze static collision layers, masks and shapes in a Godot project.',
    {
      projectPath: schemas.projectPath,
      scenePath: z.string().optional(),
      responseMode: schemas.responseMode,
      timeoutMs: schemas.timeoutMs,
    },
    async (a: any, e: any) =>
      invoke(() => functions.analyzeCollisions(a.projectPath, a.scenePath), a.timeoutMs, e.signal, a.responseMode),
  );
  server.tool(
    'get_node_semantics',
    'Read semantic labels and recognized components from a Godot scene.',
    {
      projectPath: schemas.projectPath,
      scenePath: z.string().optional(),
      responseMode: schemas.responseMode,
      timeoutMs: schemas.timeoutMs,
    },
    async (a: any, e: any) =>
      invoke(() => functions.getNodeSemantics(a.projectPath, a.scenePath), a.timeoutMs, e.signal, a.responseMode),
  );
}

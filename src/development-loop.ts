import { z } from 'zod';
import { toolSchemas } from './mcp/tool-context.js';
export const developmentLoopSchema = z.object({
  projectPath: toolSchemas.projectPath,
  edits: z.array(z.object({ file: z.string().min(1), old: z.string().min(1), new: z.string() })).min(1),
  assertions: z.array(z.object({ type: z.enum(['scene_contains_node','node_has_property','script_parses','no_analyzer_errors']), scenePath: z.string().optional(), nodePath: z.string().optional(), property: z.string().optional(), expected: z.union([z.string(), z.number(), z.boolean()]).optional(), tolerance: z.number().optional() })).min(1),
  baselineEvidenceDir: z.string().optional(), responseMode: toolSchemas.responseMode, timeoutMs: toolSchemas.timeoutMs,
});

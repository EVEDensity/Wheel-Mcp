import { z } from 'zod';
import { compareScreenshots, getRecentEvidence } from '../../godot-development.js';
import { readResponsePage } from '../../response-budget.js';
import type { ToolRegistrationContext } from '../tool-context.js';
export function registerEvidenceTools(context: ToolRegistrationContext): void {
  const { server, invoke, schemas } = context;
  const { evidenceDir, timeoutMs, responseMode } = schemas;
  server.tool(
    'get_response_page',
    'Continue reading an oversized tool response from its opaque response reference.',
    { ref: z.string().uuid(), cursor: z.number().int().nonnegative(), timeoutMs },
    async ({ ref, cursor, timeoutMs }, extra) =>
      invoke(() => Promise.resolve(readResponsePage(ref, cursor)), timeoutMs, extra.signal),
  );
  server.tool(
    'compare_screenshots',
    'Compare two PNG screenshots with RGBA pixel diff.',
    {
      firstPath: z.string(),
      secondPath: z.string(),
      threshold: z.number().int().min(0).max(255).optional(),
      ignoreAlpha: z.boolean().optional(),
      writeDiff: z.boolean().optional(),
      diffPath: z.string().optional(),
      responseMode: responseMode,
      timeoutMs: timeoutMs,
    },
    async (a: any, e: any) =>
      invoke(() => compareScreenshots(a.firstPath, a.secondPath, a), a.timeoutMs, e.signal, a.responseMode),
  );

  server.tool(
    'get_recent_evidence',
    'Read recent evidence artifacts.',
    {
      evidenceDir: z.string(),
      limit: z.number().int().positive().max(100).optional(),
      responseMode: responseMode,
      timeoutMs: timeoutMs,
    },
    async (a: any, e: any) => invoke(() => getRecentEvidence(a.evidenceDir), a.timeoutMs, e.signal, a.responseMode),
  );
}

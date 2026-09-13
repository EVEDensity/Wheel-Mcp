import { z } from 'zod';
import type { ToolRegistrationContext } from '../tool-registry.js';
export function registerEvidenceTools({ server, invoke, schemas, functions }: ToolRegistrationContext): void {
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
      responseMode: schemas.responseMode,
      timeoutMs: schemas.timeoutMs,
    },
    async (a: any, e: any) =>
      invoke(() => functions.compareScreenshots(a.firstPath, a.secondPath, a), a.timeoutMs, e.signal, a.responseMode),
  );
  server.tool(
    'get_recent_evidence',
    'Read recent evidence artifacts.',
    {
      evidenceDir: z.string(),
      limit: z.number().int().positive().max(100).optional(),
      responseMode: schemas.responseMode,
      timeoutMs: schemas.timeoutMs,
    },
    async (a: any, e: any) =>
      invoke(() => functions.getRecentEvidence(a.evidenceDir, a.limit), a.timeoutMs, e.signal, a.responseMode),
  );
}

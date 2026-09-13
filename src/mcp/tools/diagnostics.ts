import { z } from 'zod';
import { readEvidence } from '../../godot-runtime.js';
import { analyzeScriptFile } from '../../script-analysis.js';
import type { ToolRegistrationContext } from '../tool-context.js';
export function registerDiagnosticsTools(context: ToolRegistrationContext): void {
  const { server, invoke, schemas } = context;
  const { projectPath, evidenceDir, timeoutMs, responseMode } = schemas;
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


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
    {
      evidenceDir: z.string(),
      stdoutCursor: z.number().int().nonnegative().optional(),
      stderrCursor: z.number().int().nonnegative().optional(),
      stdoutSegment: z.string().optional(),
      stderrSegment: z.string().optional(),
      limitBytes: z
        .number()
        .int()
        .min(1)
        .max(64 * 1024)
        .optional(),
      timeoutMs,
    },
    async ({ evidenceDir, stdoutCursor, stderrCursor, stdoutSegment, stderrSegment, limitBytes, timeoutMs }, extra) =>
      invoke(
        async (context) => {
          context.throwIfCancelled();
          return readEvidence(evidenceDir, { stdoutCursor, stderrCursor, stdoutSegment, stderrSegment, limitBytes });
        },
        timeoutMs,
        extra.signal,
      ),
  );

  server.tool(
    'analyze_script_semantics',
    'Analyze GDScript structure and state-machine transitions.',
    {
      projectPath: projectPath,
      scriptPath: z.string(),
      responseMode: responseMode,
      timeoutMs: timeoutMs,
    },
    async (a: any, e: any) =>
      invoke((c: any) => analyzeScriptFile(a.projectPath, a.scriptPath), a.timeoutMs, e.signal, a.responseMode),
  );
}

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

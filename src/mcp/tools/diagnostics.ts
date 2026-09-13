import { z } from 'zod';
import type { ToolRegistrationContext } from '../tool-registry.js';
export function registerDiagnosticsTools({ server, invoke, schemas, functions }: ToolRegistrationContext): void {
  server.tool(
    'analyze_script_semantics',
    'Analyze GDScript structure and state-machine transitions.',
    {
      projectPath: schemas.projectPath,
      scriptPath: z.string(),
      responseMode: schemas.responseMode,
      timeoutMs: schemas.timeoutMs,
    },
    async (a: any, e: any) =>
      invoke(
        (c: any) => functions.analyzeScriptFile(a.projectPath, a.scriptPath),
        a.timeoutMs,
        e.signal,
        a.responseMode,
      ),
  );
}

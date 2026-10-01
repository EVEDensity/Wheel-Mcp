import { z } from 'zod';
import { readEvidence } from '../../godot-runtime.js';
import { analyzeScriptFile } from '../../script-analysis.js';
import { GodotLspClient } from '../../project/godot-lsp-client.js';
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
    'Heuristic, read-only GDScript structure/state summary; not syntax diagnostics or safe refactoring.',
    {
      projectPath: projectPath,
      scriptPath: z.string(),
      responseMode: responseMode,
      timeoutMs: timeoutMs,
    },
    async (a: any, e: any) =>
      invoke((c: any) => analyzeScriptFile(a.projectPath, a.scriptPath), a.timeoutMs, e.signal, a.responseMode),
  );

  server.tool(
    'query_script_semantics',
    'Read Godot LSP symbols, references, definitions or syntax diagnostics from an already-authorized local editor. Raw references and definitions may resolve same-named strings/comments; none authorize refactoring.',
    {
      projectPath,
      scriptPath: z.string(),
      lspPort: z.number().int().min(1024).max(65535),
      query: z.enum(['symbols', 'references', 'definition', 'diagnostics']),
      line: z.number().int().nonnegative().optional(),
      character: z.number().int().nonnegative().optional(),
      responseMode,
      timeoutMs,
    },
    async ({ projectPath, scriptPath, lspPort, query, line, character, responseMode, timeoutMs }, extra) =>
      invoke(
        async (run) => {
          run.throwIfCancelled();
          const client = await GodotLspClient.connect({
            projectPath,
            ownerId: context.transactionOwnerId,
            lspPort,
            timeoutMs: Math.min(run.remaining(), 30000),
            signal: run.signal,
          });
          try {
            const result = await client.query(
              scriptPath,
              query,
              line === undefined || character === undefined ? undefined : { line, character },
              run.signal,
            );
            return { schema_version: '0.1', source: 'REAL', status: 'PASS', ...result };
          } finally {
            client.close();
          }
        },
        timeoutMs,
        extra.signal,
        responseMode,
      ),
  );
  server.tool(
    'preview_script_rename',
    'Read-only Godot LSP rename candidate with code-only checks, per-location definition agreement, project hash and manual impact review. Not approval or safe-refactor authorization; never writes files.',
    {
      projectPath,
      scriptPath: z.string(),
      lspPort: z.number().int().min(1024).max(65535),
      line: z.number().int().nonnegative(),
      character: z.number().int().nonnegative(),
      oldName: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
      newName: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
      responseMode,
      timeoutMs,
    },
    async ({ projectPath, scriptPath, lspPort, line, character, oldName, newName, responseMode, timeoutMs }, extra) =>
      invoke(
        async (run) => {
          run.throwIfCancelled();
          const client = await GodotLspClient.connect({
            projectPath,
            ownerId: context.transactionOwnerId,
            lspPort,
            timeoutMs: Math.min(run.remaining(), 30000),
            signal: run.signal,
          });
          try {
            const result = await client.previewDefinitionCheckedRename(
              scriptPath,
              { line, character },
              oldName,
              newName,
              run.signal,
            );
            return { schema_version: '0.1', source: 'REAL', status: 'PASS', ...result };
          } finally {
            client.close();
          }
        },
        timeoutMs,
        extra.signal,
        responseMode,
      ),
  );
}

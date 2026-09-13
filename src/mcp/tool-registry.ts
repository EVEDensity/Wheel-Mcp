import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { invokeTool, toolSchemas } from './tool-context.js';
import { registerProjectTools } from './tools/project.js';
import { registerRuntimeTools } from './tools/runtime.js';
import { registerDiagnosticsTools } from './tools/diagnostics.js';
import { registerScenarioTools } from './tools/scenario.js';
import { registerEvidenceTools } from './tools/evidence.js';
export type { ToolRegistrationContext } from './tool-context.js';

/** Composition only. Schemas and handlers belong to the five domain modules. */
export function registerAllTools({ server }: { server: McpServer }): void {
  const context = { server, invoke: invokeTool, schemas: toolSchemas };
  registerProjectTools(context);
  registerRuntimeTools(context);
  registerDiagnosticsTools(context);
  registerScenarioTools(context);
  registerEvidenceTools(context);
}

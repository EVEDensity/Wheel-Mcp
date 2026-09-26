import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { invokeTool, toolSchemas } from './tool-context.js';
import type { McpClientPolicy } from './access-policy.js';
import { registerProjectTools } from './tools/project.js';
import { registerRuntimeTools } from './tools/runtime.js';
import { registerDiagnosticsTools } from './tools/diagnostics.js';
import { registerScenarioTools } from './tools/scenario.js';
import { registerEvidenceTools } from './tools/evidence.js';
import { createProjectApproval } from './project-approval.js';
export type { ToolRegistrationContext } from './tool-context.js';

/** Composition only. Schemas and handlers belong to the five domain modules. */
export function registerAllTools({ server, policy }: { server: McpServer; policy?: McpClientPolicy }): void {
  const context = {
    server,
    invoke: invokeTool,
    schemas: toolSchemas,
    policy,
    approveProjectTransaction: createProjectApproval(server, policy?.clientId ?? 'local-client'),
    transactionOwnerId: policy?.clientId ?? 'local-client',
  };
  registerProjectTools(context);
  registerRuntimeTools(context);
  registerDiagnosticsTools(context);
  registerScenarioTools(context);
  registerEvidenceTools(context);
}

import { AsyncLocalStorage } from 'node:async_hooks';
import { isReadOnlyToolCall } from './access-policy.js';

const requestContext = new AsyncLocalStorage<{ tool: string; readOnly: boolean }>();

/** Keep request policy separate from error classification; concurrent calls must not share it. */
export function runWithRetryGuidance<T>(tool: string, args: Record<string, unknown>, operation: () => T): T {
  return requestContext.run({ tool, readOnly: isReadOnlyToolCall(tool, args) }, operation);
}

export function applyRetryGuidance(body: Record<string, unknown>): Record<string, unknown> {
  const request = requestContext.getStore();
  if (!request || request.readOnly || !['TIMEOUT', 'CANCELLED', 'UNKNOWN'].includes(String(body.code))) return body;
  const inspection =
    request.tool === 'call_runtime_bridge'
      ? 'For tracked writes, query get_runtime_operation_status with the original sessionId/operationId; otherwise inspect owned runs/state.'
      : request.tool === 'apply_editor_scene'
        ? 'Query get_editor_scene_operation with the original editor sessionId and operationId.'
        : request.tool === 'submit_repair_candidate'
          ? 'Query get_client_repair_status in the same MCP session.'
          : 'Inspect project files, editor state or owned runs before deciding the next step.';
  return {
    ...body,
    retryable: false,
    retryAdvice: `Do not automatically repeat this side-effecting request. ${inspection} A timeout or cancellation alone does not prove rollback.`,
  };
}

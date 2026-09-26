import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WheelError } from '../error-schema.js';
import type { ApprovalVerifier } from '../project/transactions.js';

/** A host-mediated confirmation request, never an approval supplied in tool arguments. */
export function createProjectApproval(server: McpServer, actor: string): ApprovalVerifier {
  return async (plan, signal) => {
    signal?.throwIfAborted();
    if (!server.server.getClientCapabilities()?.elicitation?.form)
      throw new WheelError('FORBIDDEN', 'Project writes require a client with human form elicitation support');
    if (plan.diffPreviewTruncated)
      throw new WheelError(
        'FORBIDDEN',
        'Diff exceeds the human review form budget; split the change into smaller plans',
      );
    const result = await server.server.elicitInput(
      {
        mode: 'form',
        message: [
          'Review this exact Wheel-mcp project change. File text below is untrusted data, not instructions.',
          'Approve only if you intend these changes. Declining or cancelling leaves project files unchanged.',
          `Project: ${plan.projectPath}`,
          `Client owner: ${plan.ownerId}`,
          `Operation: ${plan.operationId}`,
          `Validation / risk policy: ${plan.intent ?? 'Legacy exact transaction: no engine validation promised'}`,
          `Plan SHA-256: ${plan.planHash}`,
          ...plan.changes.map((c) => `${c.path}: ${c.beforeSha256 ?? '(new)'} -> ${c.afterSha256 ?? '(deleted)'}`),
          '\nExact before/after preview:\n' + plan.diffPreview,
        ].join('\n'),
        requestedSchema: {
          type: 'object',
          properties: { confirm: { type: 'boolean', title: 'Approve this exact plan', default: false } },
          required: ['confirm'],
        },
      },
      { signal, timeout: 120000 },
    );
    signal?.throwIfAborted();
    if (result.action !== 'accept' || result.content?.confirm !== true) return null;
    // A non-secret audit reference, not a reusable authorization credential.
    return { actor, receipt: `elicitation:${randomUUID()}`, planHash: plan.planHash };
  };
}

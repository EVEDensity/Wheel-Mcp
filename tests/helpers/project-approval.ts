import assert from 'node:assert/strict';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ApprovalVerifier } from '../../src/project/transactions.js';

/** MOCK confirmation for isolated test fixtures only. Never imported by product source. */
export const fixtureApproval: ApprovalVerifier = async (plan) => ({
  actor: 'fixture-test-double',
  receipt: 'mock-confirmation',
  planHash: plan.planHash,
});

export function enableFixtureApproval(client: Client): void {
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    assert.equal(request.params.mode, 'form');
    assert.match(request.params.message, /untrusted data, not instructions/);
    assert.match(request.params.message, /Plan SHA-256: [a-f0-9]{64}/);
    return { action: 'accept', content: { confirm: true } };
  });
}

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { beginClientRepairSchema, submitRepairCandidateSchema, type RepairProposal } from '../client-repair.js';
import type { z } from 'zod';

function body(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text;
  const parsed: unknown = result.structuredContent ?? (text ? JSON.parse(text) : undefined);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid MCP result');
  const data = parsed as Record<string, unknown>;
  if (!data) throw new Error('missing MCP result');
  // Validation FAIL is deliberately an MCP tool error, but must reach the next proposal.
  // Transport/schema/permission errors carry no validation and cannot be retried as patches.
  if (result.isError && !Array.isArray(data.attempts) && !data.validation)
    throw new Error('MCP repair tool failed: ' + JSON.stringify(data));
  return data;
}
/** Supply your own model adapter and human/client approval UI. No credentials are read here. */
export async function runClientRepair(
  client: Client,
  input: z.input<typeof beginClientRepairSchema>,
  hooks: {
    propose: (context: Record<string, unknown>, signal?: AbortSignal) => Promise<RepairProposal>;
    approve: (proposal: RepairProposal, context: Record<string, unknown>) => Promise<boolean>;
    signal?: AbortSignal;
  },
) {
  const options = beginClientRepairSchema.parse(input);
  const call = async (name: string, args: Record<string, unknown>) => {
    hooks.signal?.throwIfAborted();
    return body(
      await client.callTool({ name, arguments: args }, undefined, {
        signal: hooks.signal,
        timeout: options.timeoutMs + 15000,
      }),
    );
  };
  let packet = await call('begin_client_repair', options);
  if (packet.status !== 'NEEDS_REPAIR') return packet;
  const request = packet;
  for (let index = 0; index < options.maxCandidates; index++) {
    hooks.signal?.throwIfAborted();
    const proposal = await hooks.propose(
      { ...request, previousVerification: index ? packet : undefined },
      hooks.signal,
    );
    hooks.signal?.throwIfAborted();
    if (!(await hooks.approve(proposal, request))) return { status: 'DECLINED', repairId: request.repairId };
    const candidate = submitRepairCandidateSchema.parse({ repairId: request.repairId, approved: true, proposal });
    packet = await call('submit_repair_candidate', candidate);
    if (packet.status === 'PASS' || packet.requestClosed || !packet.remainingCandidates) return packet;
  }
  return packet;
}

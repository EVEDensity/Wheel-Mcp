import { McpAccessError, type McpClientPolicy } from './access-policy.js';
import { runRegistry } from '../run-registry.js';
import { getProcessStatus } from '../godot-runtime.js';
import { readProcessIdentity, sameProcessIdentity } from '../process-identity.js';
import { WheelError } from '../error-schema.js';
import type { TimeoutContext } from '../timeout.js';

/** Resolve the original owned run, never the newest global record with this PID. */
async function ownedRun(policy: McpClientPolicy, pid: number, context: TimeoutContext) {
  context.throwIfCancelled();
  context.throwIfExpired();
  const runId = policy.ownedPidRuns.get(pid);
  if (!runId || !policy.ownedRunIds.has(runId) || !policy.ownedPids.has(pid))
    throw new McpAccessError(`client ${policy.clientId} lacks an owned run binding for PID ${pid}`);
  const run = runRegistry.get(runId);
  if (!run || run.pid !== pid) throw new McpAccessError('Owned process record is missing or changed');
  const status = getProcessStatus(pid);
  if (
    status.running &&
    (!run.processIdentity || !sameProcessIdentity(run.processIdentity, await readProcessIdentity(pid)))
  )
    throw new WheelError('CONFLICT', 'PID now belongs to a different or unverified process generation', { pid, runId });
  context.throwIfCancelled();
  context.throwIfExpired();
  return { run, status };
}

export async function inspectOwnedProcess(policy: McpClientPolicy, pid: number, context: TimeoutContext) {
  if (policy.scopes.has('admin')) return getProcessStatus(pid);
  return (await ownedRun(policy, pid, context)).status;
}

export async function stopOwnedProcess(policy: McpClientPolicy, pid: number, context: TimeoutContext, cancel = false) {
  if (policy.scopes.has('admin'))
    return cancel ? runRegistry.cancelByPid(pid, context) : runRegistry.stopByPid(pid, context);
  const { run, status } = await ownedRun(policy, pid, context);
  // Stop/cancel by immutable run ID re-verifies the captured OS identity. A
  // concurrent foreign registration cannot redirect this operation by PID.
  const terminal = cancel ? await runRegistry.cancel(run.runId, context) : await runRegistry.stop(run.runId, context);
  const stopped = terminal.state === (cancel ? 'CANCELLED' : 'STOPPED') || !status.running;
  return {
    stopped,
    ...(cancel ? { cancelled: stopped } : {}),
    timed_out: false,
    pid,
    run_id: terminal.runId,
    lifecycle: terminal.state,
  };
}

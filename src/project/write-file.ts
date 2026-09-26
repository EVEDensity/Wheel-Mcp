import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { WheelError } from '../error-schema.js';
import { resolveProjectPath } from './paths.js';
import { ProjectTransactions, type ApprovalVerifier } from './transactions.js';

export type ProjectWriteOptions = {
  intent?: string;
  beforeApply?: (signal?: AbortSignal) => Promise<void>;
  ownerId?: string;
  verifyApproval?: ApprovalVerifier;
  operationId?: string;
  /** null means create only. Required with an explicit operationId, for safe retries. */
  expectedSha256?: string | null;
  signal?: AbortSignal;
};

/** Compatibility file writes use the same approval, lock, journal and byte-readback path. */
export async function writeProjectText(
  projectPath: string,
  filePath: string,
  content: string,
  options: ProjectWriteOptions = {},
) {
  options.signal?.throwIfAborted();
  const resolved = await resolveProjectPath(projectPath, filePath, { mode: 'write', allowAbsolute: true });
  const service = new ProjectTransactions({
    projectPath: resolved.root,
    ownerId: options.ownerId,
    verifyApproval: options.verifyApproval,
    intent: options.intent,
    beforeApply: options.beforeApply,
  });
  if (options.operationId && options.expectedSha256 === undefined)
    throw new WheelError('INVALID_ARGUMENT', 'expectedSha256 (or null for create) is required with operationId');
  await service.recoverPending();
  if ((await service.list()).some((t) => t.state === 'CONFLICT'))
    throw new WheelError('CONFLICT', 'Unresolved project transaction requires operator recovery');
  let expected = options.expectedSha256;
  if (expected === undefined) {
    try {
      expected = createHash('sha256')
        .update(await readFile(resolved.absolutePath))
        .digest('hex');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      expected = null;
    }
  }
  const plan = await service.prepare(
    [
      expected === null
        ? { kind: 'create', path: resolved.relativePath, content }
        : { kind: 'replace', path: resolved.relativePath, content, expectedSha256: expected },
    ],
    options.operationId,
  );
  const existing = await service.inspect(plan.operationId);
  if (existing.state === 'PREPARED') await service.approve(plan.operationId, options.signal);
  const state = await service.apply(
    plan.operationId,
    async () => (await readFile(resolved.absolutePath, 'utf8')) === content,
    options.signal,
  );
  if (state !== 'COMMITTED') throw new WheelError('VALIDATION_FAILED', `File write transaction ended in ${state}`);
  return { ...resolved, operationId: plan.operationId, planHash: plan.planHash, transactionState: state };
}

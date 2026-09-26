import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { readProcessIdentity, sameProcessIdentity, type ProcessIdentity } from '../process-identity.js';
import { projectRelativePath, resolveProjectPath } from './paths.js';
import { WheelError, classifyError } from '../error-schema.js';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const MAX_CONTENT_BYTES = 8 * 1024 * 1024;
export type TransactionOperation =
  | { kind: 'create'; path: string; content: string }
  | { kind: 'replace'; path: string; content: string; expectedSha256: string }
  | { kind: 'delete'; path: string; expectedSha256: string }
  | { kind: 'rename'; from: string; to: string; expectedSha256: string };
export type ExactTransactionEdit = { path: string; find: string; replace: string; expectedSha256: string };
export type TransactionState =
  | 'PREPARED'
  | 'APPROVED'
  | 'APPLYING'
  | 'VALIDATING'
  | 'COMMITTED'
  | 'ROLLING_BACK'
  | 'ROLLED_BACK'
  | 'CONFLICT';
export type TransactionApproval = { actor: string; receipt: string; planHash: string };
export type TransactionPlan = {
  intent?: string;
  operationId: string;
  projectPath: string;
  ownerId: string;
  planHash: string;
  changes: Array<{
    path: string;
    beforeSha256: string | null;
    afterSha256: string | null;
    beforeBytes: number;
    afterBytes: number;
  }>;
  impact: string[];
  diffPreview: string;
  diffPreviewTruncated: boolean;
};
type Mutation = {
  path: string;
  beforeSha256: string | null;
  afterSha256: string | null;
  beforeBytes: number;
  afterBytes: number;
};
type Journal = {
  intent?: string;
  schemaVersion: 2;
  operationId: string;
  projectPath: string;
  ownerId: string;
  planHash: string;
  requestHash: string;
  state: TransactionState;
  applied: number;
  mutations: Mutation[];
  approval?: TransactionApproval;
  conflict?: string;
  updatedAt: string;
};
const states = new Set<TransactionState>([
  'PREPARED',
  'APPROVED',
  'APPLYING',
  'VALIDATING',
  'COMMITTED',
  'ROLLING_BACK',
  'ROLLED_BACK',
  'CONFLICT',
]);
export type ApprovalVerifier = (plan: TransactionPlan, signal?: AbortSignal) => Promise<TransactionApproval | null>;
type TransactionOptions = {
  /** Server-owned operation semantics, included in the exact request/approval binding. */
  intent?: string;
  /** Server-owned preflight inside execution lock, before any target is touched. */
  beforeApply?: (signal?: AbortSignal) => Promise<void>;
  projectPath: string;
  /** Transport-authenticated client identity, never a tool argument. */
  ownerId?: string;
  /** A server-owned confirmation callback. Client-supplied approved:true is never sufficient. */
  verifyApproval?: ApprovalVerifier;
  /** Test-only crash injection after a persisted checkpoint. */
  checkpoint?: (name: string, operationId: string) => Promise<void>;
  /** Test-only I/O failure injection, before a mutation is written. */
  beforeMutation?: (index: number, operationId: string) => Promise<void>;
  /** Test-only injection of unavailable OS identity during stale-lock checks. */
  readLockOwnerIdentity?: (pid: number) => Promise<ProcessIdentity | null>;
};

function assertHash(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('expectedSha256 must be a lowercase SHA-256');
}

function cancellationError(signal: AbortSignal, operationId: string, state: TransactionState): WheelError {
  return new WheelError(
    classifyError(signal.reason).code === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED',
    `transaction cancelled; recovery state ${state}`,
    { operationId, recoveryState: state },
  );
}

async function syncFile(file: string): Promise<void> {
  const handle = await open(file, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicWrite(file: string, content: string | Buffer): Promise<void> {
  const stage = `${file}.stage-${randomUUID()}`;
  try {
    await writeFile(stage, content, { flag: 'wx', mode: 0o600 });
    await syncFile(stage);
    await rename(stage, file);
  } finally {
    await unlink(stage).catch(() => {});
  }
}

function planFromJournal(journal: Journal): TransactionPlan {
  return {
    intent: journal.intent,
    operationId: journal.operationId,
    projectPath: journal.projectPath,
    ownerId: journal.ownerId,
    planHash: journal.planHash,
    changes: journal.mutations.map((item) => ({ ...item })),
    impact: journal.mutations.map((item) => item.path),
    diffPreview: '',
    diffPreviewTruncated: false,
  };
}

async function planWithPreview(journal: Journal, dir: string): Promise<TransactionPlan> {
  const plan = planFromJournal(journal);
  const pieces: string[] = [];
  for (let index = 0; index < journal.mutations.length; index++) {
    const item = journal.mutations[index];
    const before = item.beforeSha256 === null ? '' : await readFile(path.join(dir, `${index}.before`), 'utf8');
    const after = item.afterSha256 === null ? '' : await readFile(path.join(dir, `${index}.after`), 'utf8');
    if (
      (item.beforeSha256 !== null && digest(before) !== item.beforeSha256) ||
      (item.afterSha256 !== null && digest(after) !== item.afterSha256)
    )
      throw new Error('transaction preview staging hash mismatch');
    pieces.push(
      `--- ${item.path}\n${before
        .split('\n')
        .map((line) => `- ${line}`)
        .join('\n')}\n+++ ${item.path}\n${after
        .split('\n')
        .map((line) => `+ ${line}`)
        .join('\n')}`,
    );
  }
  const preview = pieces.join('\n');
  plan.diffPreviewTruncated = Buffer.byteLength(preview) > 32 * 1024;
  // Avoid splitting a UTF-8 codepoint. Oversized plans cannot be approved via the MCP form.
  plan.diffPreview = plan.diffPreviewTruncated ? preview.slice(0, 8192) : preview;
  return plan;
}

/** Local project transaction journal. Remote callers remain disabled by the HTTP transport. */
export class ProjectTransactions {
  private readonly intent?: string;
  private readonly beforeApply?: TransactionOptions['beforeApply'];
  private readonly projectPath: string;
  private readonly ownerId: string;
  private readonly verifyApproval?: ApprovalVerifier;
  private readonly checkpoint?: TransactionOptions['checkpoint'];
  private readonly beforeMutation?: TransactionOptions['beforeMutation'];
  private readonly readLockOwnerIdentity: (pid: number) => Promise<ProcessIdentity | null>;

  constructor(options: TransactionOptions) {
    this.intent = options.intent;
    this.beforeApply = options.beforeApply;
    this.projectPath = path.resolve(options.projectPath);
    this.ownerId = options.ownerId ?? 'local-library';
    if (!this.ownerId || this.ownerId.length > 200 || [...this.ownerId].some((char) => char.charCodeAt(0) < 32))
      throw new Error('invalid transaction owner ID');
    this.verifyApproval = options.verifyApproval;
    this.checkpoint = options.checkpoint;
    this.beforeMutation = options.beforeMutation;
    this.readLockOwnerIdentity = options.readLockOwnerIdentity ?? readProcessIdentity;
  }

  private async internalRoot(): Promise<string> {
    const root = await realpath(this.projectPath);
    const internal = path.join(root, '.harness');
    try {
      const info = await lstat(internal);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('transaction internal directory is unsafe');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(internal);
    }
    const transactions = path.join(internal, 'transactions');
    try {
      const info = await lstat(transactions);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('transaction journal directory is unsafe');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(transactions);
    }
    return transactions;
  }

  private async journalDir(operationId: string): Promise<string> {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(operationId)) throw new Error('invalid operation ID');
    return path.join(await this.internalRoot(), operationId);
  }

  private async readJournal(operationId: string, allowOtherOwner = false): Promise<Journal> {
    const dir = await this.journalDir(operationId);
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('transaction journal link is unsafe');
    const file = path.join(dir, 'journal.json');
    if ((await lstat(file)).isSymbolicLink()) throw new Error('transaction journal link is unsafe');
    const journal = JSON.parse(await readFile(file, 'utf8')) as Journal;
    if (journal.operationId !== operationId || journal.projectPath !== (await realpath(this.projectPath)))
      throw new Error('transaction journal identity mismatch');
    if (
      journal.schemaVersion !== 2 ||
      typeof journal.ownerId !== 'string' ||
      !journal.ownerId ||
      journal.ownerId.length > 200 ||
      !states.has(journal.state) ||
      typeof journal.planHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(journal.planHash) ||
      typeof journal.requestHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(journal.requestHash) ||
      !Array.isArray(journal.mutations) ||
      journal.mutations.length < 1 ||
      journal.mutations.length > 32 ||
      !Number.isInteger(journal.applied) ||
      journal.applied < 0 ||
      journal.applied > journal.mutations.length
    )
      throw new Error('invalid transaction journal');
    const seen = new Set<string>();
    for (const mutation of journal.mutations) {
      if (!mutation || typeof mutation.path !== 'string') throw new Error('invalid transaction mutation');
      const relative = projectRelativePath(mutation.path, 'write');
      if (relative !== mutation.path) throw new Error('invalid transaction mutation path');
      const key = process.platform === 'win32' ? relative.toLowerCase() : relative;
      if (seen.has(key)) throw new Error('duplicate transaction mutation path');
      seen.add(key);
      for (const value of [mutation.beforeSha256, mutation.afterSha256]) {
        if (value !== null && (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)))
          throw new Error('invalid transaction mutation hash');
      }
      if (
        !Number.isSafeInteger(mutation.beforeBytes) ||
        mutation.beforeBytes < 0 ||
        mutation.beforeBytes > MAX_CONTENT_BYTES ||
        !Number.isSafeInteger(mutation.afterBytes) ||
        mutation.afterBytes < 0 ||
        mutation.afterBytes > MAX_CONTENT_BYTES
      )
        throw new Error('invalid transaction mutation size');
    }
    if (journal.approval && journal.approval.planHash !== journal.planHash)
      throw new Error('transaction approval does not match plan');
    if (
      digest(
        JSON.stringify({
          ownerId: journal.ownerId,
          requestHash: journal.requestHash,
          mutations: journal.mutations,
          intent: journal.intent,
        }),
      ) !== journal.planHash
    )
      throw new Error('transaction plan hash does not match journal');
    if (!allowOtherOwner && journal.ownerId !== this.ownerId)
      throw new WheelError('FORBIDDEN', 'transaction belongs to another owner');
    return journal;
  }

  private async saveJournal(journal: Journal): Promise<void> {
    journal.updatedAt = new Date().toISOString();
    await atomicWrite(
      path.join(await this.journalDir(journal.operationId), 'journal.json'),
      JSON.stringify(journal, null, 2) + '\n',
    );
  }

  private async snapshot(relative: string): Promise<string | null> {
    const resolved = await resolveProjectPath(this.projectPath, relative, { mode: 'write' });
    try {
      const bytes = await readFile(resolved.absolutePath);
      if (bytes.length > MAX_CONTENT_BYTES) throw new Error('transaction file exceeds 8 MiB');
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return bytes.toString('utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async prepare(operations: TransactionOperation[], operationId: string = randomUUID()): Promise<TransactionPlan> {
    const root = await realpath(this.projectPath);
    return this.prepareWithRequestHash(
      operations,
      operationId,
      digest(JSON.stringify({ root, ownerId: this.ownerId, kind: 'operations', operations, intent: this.intent })),
    );
  }

  private async prepareWithRequestHash(
    operations: TransactionOperation[],
    operationId: string,
    requestHash: string,
  ): Promise<TransactionPlan> {
    if (!Array.isArray(operations) || operations.length === 0 || operations.length > 16)
      throw new Error('transaction requires 1–16 operations');
    const release = await this.lock();
    try {
      const root = await realpath(this.projectPath);
      const dir = await this.journalDir(operationId);
      try {
        const existing = await this.readJournal(operationId);
        if (existing.requestHash !== requestHash)
          throw new WheelError('CONFLICT', 'operation ID conflicts with another request');
        return planWithPreview(existing, dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const staged: Array<{ mutation: Mutation; before: string | null; after: string | null }> = [];
      const seen = new Set<string>();
      const add = async (file: string, before: string | null, after: string | null) => {
        const relative = projectRelativePath(file, 'write');
        const key = process.platform === 'win32' ? relative.toLowerCase() : relative;
        if (seen.has(key)) throw new Error('transaction has duplicate target');
        seen.add(key);
        if (after !== null && Buffer.byteLength(after) > MAX_CONTENT_BYTES)
          throw new Error('transaction content exceeds 8 MiB');
        staged.push({
          mutation: {
            path: relative,
            beforeSha256: before === null ? null : digest(before),
            afterSha256: after === null ? null : digest(after),
            beforeBytes: before === null ? 0 : Buffer.byteLength(before),
            afterBytes: after === null ? 0 : Buffer.byteLength(after),
          },
          before,
          after,
        });
      };
      for (const operation of operations) {
        if (operation.kind === 'rename') {
          assertHash(operation.expectedSha256);
          const from = projectRelativePath(operation.from, 'write');
          const to = projectRelativePath(operation.to, 'write');
          const source = await this.snapshot(from);
          const destination = await this.snapshot(to);
          if (source === null || digest(source) !== operation.expectedSha256 || destination !== null)
            throw new WheelError('CONFLICT', 'rename source hash or target precondition failed');
          await add(to, null, source);
          await add(from, source, null);
        } else {
          const relative = projectRelativePath(operation.path, 'write');
          const before = await this.snapshot(relative);
          if (operation.kind === 'create') {
            if (before !== null) throw new WheelError('CONFLICT', 'create target already exists');
            await add(relative, null, operation.content);
          } else {
            assertHash(operation.expectedSha256);
            if (before === null || digest(before) !== operation.expectedSha256)
              throw new WheelError('CONFLICT', 'transaction input hash precondition failed');
            await add(relative, before, operation.kind === 'replace' ? operation.content : null);
          }
        }
      }
      if (staged.some((item) => item.mutation.beforeSha256 === item.mutation.afterSha256))
        throw new Error('transaction contains a no-op mutation');
      const mutations = staged.map((item) => item.mutation);
      const planHash = digest(JSON.stringify({ ownerId: this.ownerId, requestHash, mutations, intent: this.intent }));
      try {
        const existing = await this.readJournal(operationId);
        if (existing.requestHash !== requestHash || existing.planHash !== planHash)
          throw new WheelError('CONFLICT', 'operation ID conflicts with another plan');
        return planWithPreview(existing, dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const incomplete = await lstat(dir).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (incomplete) {
        if (!incomplete.isDirectory() || incomplete.isSymbolicLink())
          throw new Error('unsafe incomplete transaction staging path');
        await rename(dir, path.join(path.dirname(dir), `.orphan-${operationId}-${randomUUID()}`));
      }
      await mkdir(dir);
      for (let index = 0; index < staged.length; index++) {
        const item = staged[index];
        if (item.before !== null) {
          const backup = path.join(dir, `${index}.before`);
          await writeFile(backup, item.before, { flag: 'wx', mode: 0o600 });
          await syncFile(backup);
        }
        if (item.after !== null) {
          const staged = path.join(dir, `${index}.after`);
          await writeFile(staged, item.after, { flag: 'wx', mode: 0o600 });
          await syncFile(staged);
        }
      }
      await this.checkpoint?.('STAGED', operationId);
      const journal: Journal = {
        intent: this.intent,
        schemaVersion: 2,
        operationId,
        projectPath: root,
        ownerId: this.ownerId,
        planHash,
        requestHash,
        state: 'PREPARED',
        applied: 0,
        mutations,
        updatedAt: new Date().toISOString(),
      };
      await this.saveJournal(journal);
      await this.checkpoint?.('PREPARED', operationId);
      return planWithPreview(journal, dir);
    } finally {
      await release();
    }
  }

  /** Convert exact, hash-preconditioned edits into one all-or-nothing replacement plan. */
  async prepareExactEdits(edits: ExactTransactionEdit[], operationId: string = randomUUID()): Promise<TransactionPlan> {
    if (!Array.isArray(edits) || edits.length === 0 || edits.length > 50)
      throw new Error('transaction requires 1–50 exact edits');
    const root = await realpath(this.projectPath);
    const requestHash = digest(JSON.stringify({ root, ownerId: this.ownerId, kind: 'exact-edits', edits }));
    const dir = await this.journalDir(operationId);
    try {
      const existing = await this.readJournal(operationId);
      if (existing.requestHash !== requestHash)
        throw new WheelError('CONFLICT', 'operation ID conflicts with another request');
      return planWithPreview(existing, dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const staged = new Map<string, { path: string; original: string; current: string }>();
    for (const edit of edits) {
      const relative = projectRelativePath(edit.path, 'write');
      assertHash(edit.expectedSha256);
      if (!edit.find) throw new Error('exact edit find text cannot be empty');
      const key = process.platform === 'win32' ? relative.toLowerCase() : relative;
      const prior = staged.get(key);
      if (prior && prior.path !== relative) throw new Error('exact edit path casing changed');
      const current = prior?.current ?? (await this.snapshot(relative));
      if (current === null) throw new Error('exact edit target does not exist');
      if (digest(current) !== edit.expectedSha256)
        throw new WheelError('CONFLICT', 'exact edit hash precondition failed');
      if (current.split(edit.find).length !== 2) throw new Error(`exact edit must match once: ${relative}`);
      staged.set(key, {
        path: relative,
        original: prior?.original ?? current,
        current: current.replace(edit.find, () => edit.replace),
      });
    }
    const operations: TransactionOperation[] = [...staged.values()].map((item) => ({
      kind: 'replace',
      path: item.path,
      content: item.current,
      expectedSha256: digest(item.original),
    }));
    return this.prepareWithRequestHash(operations, operationId, requestHash);
  }

  async approve(operationId: string, signal?: AbortSignal): Promise<TransactionApproval> {
    signal?.throwIfAborted();
    if (!this.verifyApproval) throw new WheelError('FORBIDDEN', 'transaction approval provider is not configured');
    const journal = await this.readJournal(operationId);
    if (journal.state === 'APPROVED' && journal.approval) return journal.approval;
    if (journal.state !== 'PREPARED') throw new Error(`cannot approve transaction in ${journal.state}`);
    const approval = await this.verifyApproval(
      await planWithPreview(journal, await this.journalDir(operationId)),
      signal,
    );
    signal?.throwIfAborted();
    if (!approval || !approval.actor || !approval.receipt || approval.planHash !== journal.planHash)
      throw new WheelError('FORBIDDEN', 'transaction approval denied or not bound to this plan');
    const release = await this.lock();
    try {
      const current = await this.readJournal(operationId);
      if (current.planHash !== journal.planHash) throw new Error('transaction changed during approval');
      if (current.state === 'APPROVED' && current.approval) return current.approval;
      if (current.state !== 'PREPARED') throw new Error(`cannot approve transaction in ${current.state}`);
      current.approval = approval;
      current.state = 'APPROVED';
      await this.saveJournal(current);
      await this.checkpoint?.('APPROVED', operationId);
      return approval;
    } finally {
      await release();
    }
  }

  private async writeMutation(operationId: string, mutation: Mutation, index: number, after: boolean): Promise<void> {
    const expected = after ? mutation.afterSha256 : mutation.beforeSha256;
    const target = (await resolveProjectPath(this.projectPath, mutation.path, { mode: 'write' })).absolutePath;
    if (expected === null) {
      await unlink(target);
      return;
    }
    const source = path.join(await this.journalDir(operationId), `${index}.${after ? 'after' : 'before'}`);
    const bytes = await readFile(source);
    if (digest(bytes) !== expected) throw new Error('transaction staging hash mismatch');
    await atomicWrite(target, bytes);
  }

  private async lock(): Promise<() => Promise<void>> {
    const root = await this.internalRoot();
    const file = path.join(root, '.project.lock');
    const identity = await readProcessIdentity(process.pid);
    if (!identity) throw new Error('platform process identity unavailable for project lock');
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const handle = await open(file, 'wx', 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, identity }));
        await handle.sync();
        await handle.close();
        return async () => {
          await unlink(file);
        };
      } catch (error) {
        if (!['EEXIST', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        const info = await lstat(file).catch(() => null);
        if (!info) continue;
        if (info.isSymbolicLink() || !info.isFile()) throw new Error('project lock path is unsafe', { cause: error });
        let owner: { pid: number; identity: ProcessIdentity } | null = null;
        try {
          owner = JSON.parse(await readFile(file, 'utf8'));
        } catch {
          /* incomplete lock write */
        }
        const actualOwner = owner ? await this.readLockOwnerIdentity(owner.pid) : null;
        let ownerAlive = true;
        if (owner && !actualOwner) {
          try {
            process.kill(owner.pid, 0);
          } catch (error) {
            ownerAlive = (error as NodeJS.ErrnoException).code !== 'ESRCH';
          }
        }
        // Unavailable OS identity is not proof of death. A live/unknown PID keeps its lock.
        if (owner && (actualOwner ? !sameProcessIdentity(owner.identity, actualOwner) : !ownerAlive)) {
          const reclaim = path.join(root, '.project.reclaim');
          try {
            const guard = await open(reclaim, 'wx', 0o600);
            await guard.close();
            try {
              const reread = JSON.parse(await readFile(file, 'utf8')) as typeof owner;
              if (reread.pid === owner.pid && sameProcessIdentity(reread.identity, owner.identity))
                await rename(file, path.join(root, `.stale-${randomUUID()}.lock`));
            } finally {
              await unlink(reclaim);
            }
          } catch (reclaimError) {
            if ((reclaimError as NodeJS.ErrnoException).code !== 'EEXIST') throw reclaimError;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error('project transaction lock is busy');
  }

  async apply(
    operationId: string,
    validate: (signal?: AbortSignal) => Promise<boolean>,
    signal?: AbortSignal,
  ): Promise<TransactionState> {
    const release = await this.lock();
    try {
      signal?.throwIfAborted();
      const journal = await this.readJournal(operationId);
      if (journal.state === 'COMMITTED' || journal.state === 'ROLLED_BACK') return journal.state;
      if (journal.state !== 'APPROVED' || !journal.approval || journal.approval.planHash !== journal.planHash)
        throw new Error('transaction lacks bound approval');
      // Approval happens outside the lock. Recheck the project-wide recovery barrier
      // under this execution lock; an earlier check can become stale while a user reviews.
      const unresolved = (await this.listAll()).some(
        (item) =>
          item.operationId !== operationId &&
          ['APPLYING', 'VALIDATING', 'ROLLING_BACK', 'CONFLICT'].includes(item.state),
      );
      if (unresolved)
        throw new WheelError('CONFLICT', 'Unresolved project transaction requires recovery before new writes', {
          operationId,
          recoveryState: journal.state,
        });
      for (const mutation of journal.mutations) {
        const current = await this.snapshot(mutation.path);
        if ((current === null ? null : digest(current)) !== mutation.beforeSha256)
          throw new WheelError('CONFLICT', 'transaction input changed after approval');
      }
      await this.beforeApply?.(signal);
      signal?.throwIfAborted();
      journal.state = 'APPLYING';
      await this.saveJournal(journal);
      await this.checkpoint?.('APPLYING', operationId);
      for (let index = 0; index < journal.mutations.length; index++) {
        if (signal?.aborted) {
          const recovery = await this.rollbackUnsafe(journal);
          throw cancellationError(signal, operationId, recovery);
        }
        try {
          await this.beforeMutation?.(index, operationId);
          const current = await this.snapshot(journal.mutations[index].path);
          if ((current === null ? null : digest(current)) !== journal.mutations[index].beforeSha256)
            throw new WheelError('CONFLICT', 'transaction input changed before file mutation');
          await this.writeMutation(operationId, journal.mutations[index], index, true);
        } catch (error) {
          const recovery = await this.rollbackUnsafe(journal);
          throw new WheelError(
            classifyError(error).code,
            `transaction file mutation failed; recovery state ${recovery}`,
            { operationId, recoveryState: recovery },
          );
        }
        await this.checkpoint?.(`WRITE_${index}`, operationId);
        journal.applied = index + 1;
        await this.saveJournal(journal);
        await this.checkpoint?.(`APPLIED_${index}`, operationId);
      }
      if (signal?.aborted) {
        const recovery = await this.rollbackUnsafe(journal);
        throw cancellationError(signal, operationId, recovery);
      }
      journal.state = 'VALIDATING';
      await this.saveJournal(journal);
      await this.checkpoint?.('VALIDATING', operationId);
      let valid: boolean;
      try {
        valid = await validate(signal);
      } catch (error) {
        const recovery = await this.rollbackUnsafe(journal);
        throw new WheelError(classifyError(error).code, `transaction validation failed; recovery state ${recovery}`, {
          operationId,
          recoveryState: recovery,
        });
      }
      if (signal?.aborted) {
        const recovery = await this.rollbackUnsafe(journal);
        throw cancellationError(signal, operationId, recovery);
      }
      if (!valid) return await this.rollbackUnsafe(journal);
      for (const mutation of journal.mutations) {
        const current = await this.snapshot(mutation.path);
        if ((current === null ? null : digest(current)) !== mutation.afterSha256) {
          await this.rollbackUnsafe(journal);
          throw new WheelError('CONFLICT', 'transaction output changed during validation');
        }
      }
      journal.state = 'COMMITTED';
      await this.saveJournal(journal);
      await this.checkpoint?.('COMMITTED', operationId);
      return journal.state;
    } finally {
      await release();
    }
  }

  private async rollbackUnsafe(journal: Journal): Promise<TransactionState> {
    journal.state = 'ROLLING_BACK';
    await this.saveJournal(journal);
    await this.checkpoint?.('ROLLING_BACK', journal.operationId);
    for (let index = journal.mutations.length - 1; index >= 0; index--) {
      const mutation = journal.mutations[index];
      let current: string | null;
      try {
        current = await this.snapshot(mutation.path);
      } catch (error) {
        journal.state = 'CONFLICT';
        journal.conflict = `${mutation.path}: ${(error as Error).message}`;
        await this.saveJournal(journal);
        return journal.state;
      }
      const currentHash = current === null ? null : digest(current);
      if (currentHash === mutation.beforeSha256) continue;
      if (index > journal.applied) {
        journal.state = 'CONFLICT';
        journal.conflict = `${mutation.path}: changed before its journaled operation`;
        await this.saveJournal(journal);
        return journal.state;
      }
      if (currentHash !== mutation.afterSha256) {
        journal.state = 'CONFLICT';
        journal.conflict = mutation.path;
        await this.saveJournal(journal);
        return journal.state;
      }
      await this.writeMutation(journal.operationId, mutation, index, false);
      await this.saveJournal(journal);
      await this.checkpoint?.(`ROLLBACK_${index}`, journal.operationId);
    }
    journal.state = 'ROLLED_BACK';
    await this.saveJournal(journal);
    await this.checkpoint?.('ROLLED_BACK', journal.operationId);
    return journal.state;
  }

  async recover(operationId: string): Promise<TransactionState> {
    const release = await this.lock();
    try {
      const journal = await this.readJournal(operationId);
      if (['COMMITTED', 'ROLLED_BACK', 'CONFLICT', 'PREPARED', 'APPROVED'].includes(journal.state))
        return journal.state;
      return await this.rollbackUnsafe(journal);
    } finally {
      await release();
    }
  }

  async inspect(operationId: string): Promise<{ state: TransactionState; planHash: string; conflict?: string }> {
    const journal = await this.readJournal(operationId);
    return { state: journal.state, planHash: journal.planHash, conflict: journal.conflict };
  }

  async list(): Promise<Array<{ operationId: string; state: TransactionState }>> {
    return (await this.listAll())
      .filter((item) => item.ownerId === this.ownerId)
      .map(({ operationId, state }) => ({ operationId, state }));
  }

  private async listAll(): Promise<Array<{ operationId: string; state: TransactionState; ownerId: string }>> {
    const root = await this.internalRoot();
    const entries = await readdir(root, { withFileTypes: true });
    const result: Array<{ operationId: string; state: TransactionState; ownerId: string }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]{1,80}$/.test(entry.name)) continue;
      const journal = await this.readJournal(entry.name, true);
      result.push({ operationId: entry.name, state: journal.state, ownerId: journal.ownerId });
    }
    return result;
  }

  /** Recovery entrypoint for a service restart; any corrupt journal fails visibly. */
  async recoverPending(): Promise<Array<{ operationId: string; state: TransactionState }>> {
    const all = await this.listAll();
    if (
      all.some(
        (item) =>
          item.ownerId !== this.ownerId && ['APPLYING', 'VALIDATING', 'ROLLING_BACK', 'CONFLICT'].includes(item.state),
      )
    )
      throw new WheelError('CONFLICT', 'another owner has an unresolved project transaction');
    const pending = all.filter(
      ({ state, ownerId }) => ownerId === this.ownerId && ['APPLYING', 'VALIDATING', 'ROLLING_BACK'].includes(state),
    );
    const result: Array<{ operationId: string; state: TransactionState }> = [];
    for (const item of pending)
      result.push({ operationId: item.operationId, state: await this.recover(item.operationId) });
    return result;
  }
}

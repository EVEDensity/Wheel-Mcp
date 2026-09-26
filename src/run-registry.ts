import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  writeSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { getProcessStatus } from './godot-runtime.js';
import { createTimeoutContext, TimeoutContext } from './timeout.js';
import { DEFAULT_ORPHAN_RECLAIM_TIMEOUT_MS, DEFAULT_STOP_TIMEOUT_MS } from './timeouts.js';
import { transitionLifecycle } from './tool-types.js';
import type { LifecycleState } from './tool-types.js';
import { WheelError } from './error-schema.js';
import {
  readProcessIdentity,
  sameProcessIdentity,
  stopIdentifiedProcess,
  type ProcessIdentity,
} from './process-identity.js';

export type RunState = LifecycleState;

export type RunRecord = {
  runId: string;
  kind?: 'launch' | 'bridge';
  pid: number;
  projectPath: string;
  evidenceDir: string;
  createdAt: string;
  updatedAt: string;
  state: RunState;
  ownerPid?: number;
  processIdentity?: ProcessIdentity;
  exitCode?: number | null;
  finishedAt?: string;
};

export type RunRegistryOptions = {
  storagePath?: string;
  maxConcurrent?: number;
};

export class RunRegistry {
  private readonly runs = new Map<string, RunRecord>();
  private readonly storagePath: string;
  private readonly lockPath: string;
  readonly maxConcurrent: number;

  constructor(options: RunRegistryOptions = {}) {
    this.storagePath = path.resolve(options.storagePath ?? path.join(process.cwd(), '.harness', 'run-registry.json'));
    this.lockPath = `${this.storagePath}.lock`;
    this.maxConcurrent = options.maxConcurrent ?? 4;
    this.withLock(() => {
      this.syncFromDisk();
      if (this.refreshStatesUnsafe()) this.persistUnsafe();
    });
  }

  register(record: Omit<RunRecord, 'createdAt' | 'updatedAt' | 'state'>): RunRecord {
    return this.withLock(() => {
      this.syncFromDisk();
      this.refreshStatesUnsafe();
      const active = [...this.runs.values()].filter(
        (run) =>
          ['RUNNING', 'STOPPING', 'CANCELLING', 'ORPHANED'].includes(run.state) && getProcessStatus(run.pid).running,
      );
      if (active.length >= this.maxConcurrent)
        throw new Error(`maximum concurrent runs exceeded: ${this.maxConcurrent}`);
      if (this.runs.has(record.runId)) throw new Error(`run already exists: ${record.runId}`);
      const now = new Date().toISOString();
      const value: RunRecord = { ...record, ownerPid: process.pid, createdAt: now, updatedAt: now, state: 'RUNNING' };
      this.runs.set(value.runId, value);
      this.persistUnsafe();
      return value;
    });
  }

  attachIdentity(runId: string, identity: ProcessIdentity): RunRecord {
    return this.withLock(() => {
      this.syncFromDisk();
      const run = this.require(runId);
      if (run.state !== 'RUNNING') return run;
      run.processIdentity = identity;
      run.updatedAt = new Date().toISOString();
      this.persistUnsafe();
      return run;
    });
  }

  findByPid(pid: number): RunRecord | undefined {
    this.refreshStates();
    return [...this.runs.values()]
      .reverse()
      .find((run) => run.pid === pid && (run.state === 'RUNNING' || run.state === 'ORPHANED'));
  }

  async stopByPid(pid: number, context?: TimeoutContext): Promise<Record<string, unknown>> {
    const run = this.findByPid(pid);
    if (run) {
      const stopped = await this.stop(run.runId, context);
      return {
        stopped: stopped.state === 'STOPPED',
        timed_out: false,
        pid,
        run_id: stopped.runId,
        lifecycle: stopped.state,
      };
    }
    const prior = [...this.runs.values()].reverse().find((item) => item.pid === pid);
    if (!prior)
      throw new WheelError('NOT_FOUND', 'PID is not a registered run; refusing an unowned process stop', { pid });
    if (getProcessStatus(pid).running)
      throw new WheelError('CONFLICT', 'PID now belongs to an unverified process', { pid });
    return { stopped: true, timed_out: false, pid, run_id: prior.runId, lifecycle: prior.state };
  }

  async cancelByPid(pid: number, context?: TimeoutContext): Promise<Record<string, unknown>> {
    const run = this.findByPid(pid);
    if (run) {
      const cancelled = await this.cancel(run.runId, context);
      return {
        stopped: cancelled.state === 'CANCELLED',
        cancelled: cancelled.state === 'CANCELLED',
        timed_out: false,
        pid,
        run_id: cancelled.runId,
        lifecycle: cancelled.state,
      };
    }
    const prior = [...this.runs.values()].reverse().find((item) => item.pid === pid);
    if (!prior)
      throw new WheelError('NOT_FOUND', 'PID is not a registered run; refusing an unowned process cancel', { pid });
    if (getProcessStatus(pid).running)
      throw new WheelError('CONFLICT', 'PID now belongs to an unverified process', { pid });
    return { stopped: true, cancelled: true, timed_out: false, pid, run_id: prior.runId, lifecycle: prior.state };
  }

  get(runId: string): RunRecord | undefined {
    this.refreshStates();
    return this.runs.get(runId);
  }

  active(): RunRecord[] {
    this.refreshStates();
    return [...this.runs.values()].filter((run) => run.state === 'RUNNING');
  }

  list(): RunRecord[] {
    this.refreshStates();
    return [...this.runs.values()];
  }

  markTerminal(
    runId: string,
    state: Exclude<RunState, 'STARTING' | 'RUNNING' | 'STOPPING' | 'CANCELLING'>,
    exitCode: number | null = null,
  ): RunRecord {
    return this.withLock(() => {
      this.syncFromDisk();
      const run = this.require(runId);
      if (['STOPPED', 'CANCELLED', 'EXITED', 'FAILED', 'TIMEOUT'].includes(run.state)) return run;
      run.state = state;
      run.exitCode = exitCode;
      run.finishedAt = new Date().toISOString();
      run.updatedAt = run.finishedAt;
      this.persistUnsafe();
      this.writeEvidenceTerminal(run, state, exitCode);
      return run;
    });
  }

  private setIntent(runId: string, state: 'STOPPING' | 'CANCELLING'): RunState {
    return this.withLock(() => {
      this.syncFromDisk();
      const run = this.require(runId);
      const previous = run.state;
      if (previous === 'RUNNING' || previous === 'ORPHANED') {
        run.state = state;
        run.updatedAt = new Date().toISOString();
        this.persistUnsafe();
      }
      return previous;
    });
  }

  beginBridgeStop(runId: string): RunState {
    const run = this.get(runId);
    if (!run || run.kind !== 'bridge') throw new WheelError('NOT_FOUND', 'bridge run not found', { runId });
    return this.setIntent(runId, 'STOPPING');
  }

  abortBridgeStop(runId: string, previous: RunState): void {
    this.restoreIntent(runId, 'STOPPING', previous);
  }

  private restoreIntent(runId: string, expected: 'STOPPING' | 'CANCELLING', previous: RunState): void {
    this.withLock(() => {
      this.syncFromDisk();
      const run = this.require(runId);
      if (run.state !== expected) return;
      run.state = previous;
      run.updatedAt = new Date().toISOString();
      this.persistUnsafe();
    });
  }

  scanOrphans(): RunRecord[] {
    this.refreshStates();
    return [...this.runs.values()].filter((run) => run.state === 'ORPHANED');
  }

  async reclaimOrphans(
    timeoutOrContext: TimeoutContext | number = DEFAULT_ORPHAN_RECLAIM_TIMEOUT_MS,
  ): Promise<RunRecord[]> {
    const context = typeof timeoutOrContext === 'number' ? createTimeoutContext(timeoutOrContext) : timeoutOrContext;
    const ownsContext = typeof timeoutOrContext === 'number';
    const reclaimed: RunRecord[] = [];
    try {
      for (const run of this.scanOrphans()) {
        context.throwIfCancelled();
        context.throwIfExpired();
        // A dead child is not evidence that its owner crashed. Its live owner
        // may still be draining pipes and recording the actual exit code.
        // Automatic reclamation must not race that close handler or relabel a
        // natural exit as STOPPED, including when reclaimer and owner coincide.
        if (typeof run.ownerPid === 'number' && getProcessStatus(run.ownerPid).running) continue;
        if (getProcessStatus(run.pid).running) {
          if (!run.processIdentity) continue;
          const actual = await readProcessIdentity(run.pid);
          if (!sameProcessIdentity(run.processIdentity, actual)) continue;
          const result = await stopIdentifiedProcess(run.pid, run.processIdentity);
          if (result !== 'STOPPED' && result !== 'NOT_FOUND') continue;
        }
        reclaimed.push(this.markTerminal(run.runId, 'STOPPED'));
      }
      return reclaimed;
    } finally {
      if (ownsContext) context.dispose();
    }
  }

  async stop(runId: string, timeoutOrContext?: TimeoutContext | number): Promise<RunRecord> {
    const run = this.get(runId) ?? this.require(runId);
    if (run.state !== 'RUNNING' && run.state !== 'ORPHANED') return run;
    const context =
      typeof timeoutOrContext === 'number' || timeoutOrContext === undefined
        ? createTimeoutContext(timeoutOrContext ?? DEFAULT_STOP_TIMEOUT_MS)
        : timeoutOrContext;
    const ownsContext = typeof timeoutOrContext !== 'object';
    let previous: RunState | undefined;
    try {
      context.throwIfCancelled();
      context.throwIfExpired();
      previous = this.setIntent(runId, 'STOPPING');
      await this.stopVerified(run);
      return this.markTerminal(runId, 'STOPPED');
    } catch (error) {
      if (previous) this.restoreIntent(runId, 'STOPPING', previous);
      throw error;
    } finally {
      if (ownsContext) context.dispose();
    }
  }

  async cancel(runId: string, timeoutOrContext?: TimeoutContext | number): Promise<RunRecord> {
    const run = this.get(runId) ?? this.require(runId);
    if (run.state !== 'RUNNING' && run.state !== 'ORPHANED') return run;
    const context =
      typeof timeoutOrContext === 'number' || timeoutOrContext === undefined
        ? createTimeoutContext(timeoutOrContext ?? DEFAULT_STOP_TIMEOUT_MS)
        : timeoutOrContext;
    const ownsContext = typeof timeoutOrContext !== 'object';
    let previous: RunState | undefined;
    try {
      context.throwIfCancelled();
      context.throwIfExpired();
      previous = this.setIntent(runId, 'CANCELLING');
      await this.stopVerified(run);
      return this.markTerminal(runId, 'CANCELLED');
    } catch (error) {
      if (previous) this.restoreIntent(runId, 'CANCELLING', previous);
      throw error;
    } finally {
      if (ownsContext) context.dispose();
    }
  }

  private async stopVerified(run: RunRecord): Promise<void> {
    if (!getProcessStatus(run.pid).running) return;
    if (!run.processIdentity)
      throw new WheelError('CONFLICT', 'process identity is unverified; stop is unsafe', { runId: run.runId });
    const actual = await readProcessIdentity(run.pid);
    if (!sameProcessIdentity(run.processIdentity, actual))
      throw new WheelError('CONFLICT', 'process identity changed; stop is unsafe', { runId: run.runId });
    const result = await stopIdentifiedProcess(run.pid, run.processIdentity);
    if (result === 'MISMATCH')
      throw new WheelError('CONFLICT', 'process identity changed during stop', { runId: run.runId });
    if (result === 'TIMEOUT')
      throw new WheelError('TIMEOUT', 'process did not exit after a verified stop request', { runId: run.runId });
    if (result === 'UNSUPPORTED')
      throw new WheelError('UNSUPPORTED', 'safe process termination is unavailable on this host', {
        runId: run.runId,
      });
  }

  private refreshStates(): void {
    this.withLock(() => {
      this.syncFromDisk();
      if (this.refreshStatesUnsafe()) this.persistUnsafe();
    });
  }

  private refreshStatesUnsafe(): boolean {
    let changed = false;
    for (const run of this.runs.values()) {
      if (['RUNNING', 'STOPPING', 'CANCELLING'].includes(run.state)) {
        const running = (() => {
          try {
            return getProcessStatus(run.pid).running;
          } catch {
            return false;
          }
        })();
        const ownerAlive =
          run.ownerPid === process.pid || (typeof run.ownerPid === 'number' && getProcessStatus(run.ownerPid).running);
        if (!ownerAlive || (run.state === 'RUNNING' && !running)) {
          run.state = transitionLifecycle(run.state, 'ORPHANED');
          run.updatedAt = new Date().toISOString();
          this.writeEvidenceTerminal(run, 'ORPHANED', null);
          changed = true;
        }
      }
    }
    return changed;
  }

  private syncFromDisk(): void {
    this.runs.clear();
    try {
      if (!existsSync(this.storagePath)) return;
      const parsed = JSON.parse(readFileSync(this.storagePath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const record = item as RunRecord;
        if (typeof record.runId === 'string' && Number.isInteger(record.pid) && typeof record.state === 'string') {
          this.runs.set(record.runId, record);
        }
      }
    } catch {
      throw new WheelError('FAILED', 'run registry is unreadable; refusing to overwrite it', {
        storagePath: this.storagePath,
      });
    }
  }

  private persistUnsafe(): void {
    mkdirSync(path.dirname(this.storagePath), { recursive: true });
    const temporary = `${this.storagePath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify([...this.runs.values()], null, 2), 'utf8');
    renameSync(temporary, this.storagePath);
  }

  private withLock<T>(action: () => T): T {
    mkdirSync(path.dirname(this.lockPath), { recursive: true });
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    const deadline = Date.now() + 5000;
    let descriptor: number;
    for (;;) {
      try {
        descriptor = openSync(this.lockPath, 'wx');
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') throw error;
        if (existsSync(this.lockPath)) this.recoverDeadLockOwner();
        if (Date.now() >= deadline)
          throw new WheelError('TIMEOUT', 'run registry lock is busy', { lockPath: this.lockPath });
        Atomics.wait(sleeper, 0, 0, 10);
      }
    }
    try {
      writeSync(descriptor, String(process.pid));
      return action();
    } finally {
      closeSync(descriptor);
      this.unlinkTransientlyLockedFile(this.lockPath);
    }
  }

  private recoverDeadLockOwner(): void {
    const recoveryPath = `${this.lockPath}.recover`;
    let guard: number;
    try {
      guard = openSync(recoveryPath, 'wx');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST' || code === 'EPERM' || code === 'EACCES') return;
      throw error;
    }
    try {
      let ownerText: string;
      let lockAgeMs: number;
      try {
        ownerText = readFileSync(this.lockPath, 'utf8').trim();
        lockAgeMs = Date.now() - statSync(this.lockPath).mtimeMs;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // A concurrent Windows lock release may temporarily deny read/stat. Do not infer a dead owner.
        if (code === 'ENOENT' || code === 'EPERM' || code === 'EACCES') return;
        throw error;
      }
      const ownerPid = Number(ownerText);
      const ownerDead = Number.isSafeInteger(ownerPid) && ownerPid > 0 && !getProcessStatus(ownerPid).running;
      const abandonedEmptyLock = ownerText === '' && lockAgeMs > 30_000;
      if (ownerDead || abandonedEmptyLock) this.unlinkTransientlyLockedFile(this.lockPath);
    } finally {
      closeSync(guard);
      this.unlinkTransientlyLockedFile(recoveryPath);
    }
  }

  private unlinkTransientlyLockedFile(filePath: string): void {
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        unlinkSync(filePath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return;
        if (code !== 'EPERM' && code !== 'EACCES') throw error;
        Atomics.wait(sleeper, 0, 0, 10);
      }
    }
    throw new WheelError('TIMEOUT', 'registry lock file could not be released', { filePath });
  }

  private writeEvidenceTerminal(
    run: RunRecord,
    state: Exclude<RunState, 'STARTING' | 'RUNNING' | 'STOPPING' | 'CANCELLING'>,
    exitCode: number | null,
  ): void {
    const metadataPath = path.join(run.evidenceDir, 'process.json');
    try {
      if (!existsSync(metadataPath)) return;
      const parsed = JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
      const lifecycle: LifecycleState = state;
      const metadata = {
        ...parsed,
        schema_version: '0.1',
        source: 'REAL',
        started: parsed.started !== false,
        lifecycle: transitionLifecycle((parsed.lifecycle as LifecycleState | undefined) ?? 'RUNNING', lifecycle),
        exit_code: exitCode,
        timed_out: parsed.timed_out === true,
        cancelled: lifecycle === 'CANCELLED',
        finished_at: run.finishedAt ?? new Date().toISOString(),
      };
      const temporary = `${metadataPath}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(metadata, null, 2), 'utf8');
      renameSync(temporary, metadataPath);
      const manifestPath = path.join(run.evidenceDir, 'manifest.json');
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
        writeFileSync(
          `${manifestPath}.${process.pid}.tmp`,
          JSON.stringify({ ...manifest, finished_at: metadata.finished_at, lifecycle }, null, 2),
          'utf8',
        );
        renameSync(`${manifestPath}.${process.pid}.tmp`, manifestPath);
      }
    } catch {
      // Evidence updates must not prevent registry state from being persisted.
    }
  }

  private require(runId: string): RunRecord {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`run not found: ${runId}`);
    return run;
  }
}

export const runRegistry = new RunRegistry({
  storagePath: process.env.GODOT_HARNESS_RUN_REGISTRY_PATH,
  maxConcurrent: Number.parseInt(process.env.GODOT_HARNESS_MAX_CONCURRENT_RUNS ?? '32', 10),
});

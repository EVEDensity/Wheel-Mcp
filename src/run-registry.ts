import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { cancelProcess, getProcessStatus, stopProcess } from './godot-runtime.js';
import { createTimeoutContext, TimeoutContext } from './timeout.js';
import { DEFAULT_ORPHAN_RECLAIM_TIMEOUT_MS, DEFAULT_STOP_TIMEOUT_MS } from './timeouts.js';
import { transitionLifecycle } from './tool-types.js';
import type { LifecycleState } from './tool-types.js';

export type RunState = LifecycleState;

export type RunRecord = {
  runId: string;
  pid: number;
  projectPath: string;
  evidenceDir: string;
  createdAt: string;
  updatedAt: string;
  state: RunState;
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
  readonly maxConcurrent: number;

  constructor(options: RunRegistryOptions = {}) {
    this.storagePath = path.resolve(options.storagePath ?? path.join(process.cwd(), '.harness', 'run-registry.json'));
    this.maxConcurrent = options.maxConcurrent ?? 4;
    this.load();
  }

  register(record: Omit<RunRecord, 'createdAt' | 'updatedAt' | 'state'>): RunRecord {
    this.refreshStates();
    const active = [...this.runs.values()].filter((run) => run.state === 'RUNNING');
    if (active.length >= this.maxConcurrent) throw new Error(`maximum concurrent runs exceeded: ${this.maxConcurrent}`);
    if (this.runs.has(record.runId)) throw new Error(`run already exists: ${record.runId}`);
    const now = new Date().toISOString();
    const value: RunRecord = { ...record, createdAt: now, updatedAt: now, state: 'RUNNING' };
    this.runs.set(value.runId, value);
    this.persist();
    return value;
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
    const run = this.require(runId);
    run.state = state;
    run.exitCode = exitCode;
    run.finishedAt = new Date().toISOString();
    run.updatedAt = run.finishedAt;
    this.persist();
    this.writeEvidenceTerminal(run, state, exitCode);
    return run;
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
        const stopped = (await stopProcess(run.pid, context.remaining(), context)).stopped;
        if (!stopped) continue;
        run.state = transitionLifecycle(run.state, 'STOPPED');
        run.finishedAt = new Date().toISOString();
        run.updatedAt = run.finishedAt;
        this.writeEvidenceTerminal(run, 'STOPPED', null);
        reclaimed.push(run);
      }
      if (reclaimed.length) this.persist();
      return reclaimed;
    } finally {
      if (ownsContext) context.dispose();
    }
  }

  async stop(runId: string, timeoutOrContext?: TimeoutContext | number): Promise<RunRecord> {
    const run = this.require(runId);
    const context =
      typeof timeoutOrContext === 'number' || timeoutOrContext === undefined
        ? createTimeoutContext(timeoutOrContext ?? DEFAULT_STOP_TIMEOUT_MS)
        : timeoutOrContext;
    const ownsContext = typeof timeoutOrContext !== 'object';
    try {
      await stopProcess(run.pid, context.remaining(), context);
      return this.markTerminal(runId, 'STOPPED');
    } finally {
      if (ownsContext) context.dispose();
    }
  }

  async cancel(runId: string, timeoutOrContext?: TimeoutContext | number): Promise<RunRecord> {
    const run = this.require(runId);
    const context =
      typeof timeoutOrContext === 'number' || timeoutOrContext === undefined
        ? createTimeoutContext(timeoutOrContext ?? DEFAULT_STOP_TIMEOUT_MS)
        : timeoutOrContext;
    const ownsContext = typeof timeoutOrContext !== 'object';
    try {
      await cancelProcess(run.pid, context.remaining(), context);
      return this.markTerminal(runId, 'CANCELLED');
    } finally {
      if (ownsContext) context.dispose();
    }
  }

  private refreshStates(): void {
    let changed = false;
    for (const run of this.runs.values()) {
      if (run.state === 'RUNNING') {
        const running = (() => {
          try {
            return getProcessStatus(run.pid).running;
          } catch {
            return false;
          }
        })();
        if (!running) {
          run.state = transitionLifecycle(run.state, 'ORPHANED');
          run.updatedAt = new Date().toISOString();
          this.writeEvidenceTerminal(run, 'ORPHANED', null);
          changed = true;
        }
      }
    }
    if (changed) this.persist();
  }

  private load(): void {
    try {
      if (!existsSync(this.storagePath)) return;
      const parsed = JSON.parse(readFileSync(this.storagePath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const record = item as RunRecord;
        if (typeof record.runId === 'string' && Number.isInteger(record.pid) && typeof record.state === 'string')
          this.runs.set(record.runId, record);
      }
    } catch {
      // Corrupt registry is treated as empty; next mutation rewrites it.
    }
  }

  private persist(): void {
    mkdirSync(path.dirname(this.storagePath), { recursive: true });
    const temporary = `${this.storagePath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify([...this.runs.values()], null, 2), 'utf8');
    renameSync(temporary, this.storagePath);
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
  maxConcurrent: Number.parseInt(process.env.GODOT_HARNESS_MAX_CONCURRENT_RUNS ?? '4', 10),
});

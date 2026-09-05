import { cancelProcess, getProcessStatus, stopProcess } from './godot-runtime.js';

export type RunRecord = {
  runId: string;
  pid: number;
  projectPath: string;
  evidenceDir: string;
  createdAt: string;
  state: 'RUNNING' | 'STOPPED' | 'CANCELLED' | 'ORPHANED';
};

export class RunRegistry {
  private readonly runs = new Map<string, RunRecord>();
  register(record: Omit<RunRecord, 'createdAt' | 'state'>): RunRecord {
    const value: RunRecord = { ...record, createdAt: new Date().toISOString(), state: 'RUNNING' };
    this.runs.set(value.runId, value);
    return value;
  }
  get(runId: string): RunRecord | undefined {
    return this.runs.get(runId);
  }
  list(): RunRecord[] {
    for (const run of this.runs.values())
      if (run.state === 'RUNNING' && !getProcessStatus(run.pid).running) run.state = 'ORPHANED';
    return [...this.runs.values()];
  }
  async stop(runId: string, timeoutMs?: number): Promise<RunRecord> {
    const run = this.require(runId);
    await stopProcess(run.pid, timeoutMs);
    run.state = 'STOPPED';
    return run;
  }
  async cancel(runId: string, timeoutMs?: number): Promise<RunRecord> {
    const run = this.require(runId);
    await cancelProcess(run.pid, timeoutMs);
    run.state = 'CANCELLED';
    return run;
  }
  private require(runId: string): RunRecord {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`run not found: ${runId}`);
    return run;
  }
}

export const runRegistry = new RunRegistry();

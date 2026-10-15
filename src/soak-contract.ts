/** T31 reported-limit contract. Passing this checker is NOT proof of an actual soak or chaos qualification. */
export const SOAK_LIMITS = Object.freeze({
  durationMs: 8 * 60 * 60 * 1000,
  cycles: 1000,
  warmupMs: 10 * 60 * 1000,
  windowMs: 60 * 60 * 1000,
  minWindowSamples: 10,
  maxSampleGapMs: 30000,
  maxRssGrowthRatio: 0.2,
  maxRssGrowthBytes: 128 * 1024 * 1024,
  maxLatencyRatio: 1.5,
});
/** Active scope, ADR-2026-10-10: no minimum wall duration, no long-session claim. */
export const BOUNDED_SOAK_LIMITS = Object.freeze({
  cycles: 1000,
  warmupCycles: 20,
  windowCycles: 100,
  minWindowSamples: SOAK_LIMITS.minWindowSamples,
  maxSampleGapMs: SOAK_LIMITS.maxSampleGapMs,
  maxRssGrowthRatio: SOAK_LIMITS.maxRssGrowthRatio,
  maxRssGrowthBytes: SOAK_LIMITS.maxRssGrowthBytes,
  maxLatencyRatio: SOAK_LIMITS.maxLatencyRatio,
  maxDurationMs: 3 * 60 * 60 * 1000,
});
export const SOAK_RESPONSE_CONFIGURATION = Object.freeze({
  runtimeRpc: 'compact',
  reload: 'compact',
  eventHistory: 'Native event evidence retained; use separate cursor API, not inline replay',
  defaultResponseByteBudgetUnchanged: true,
});
export const SOAK_ROLES = ['server', 'editor', 'runtime'] as const;
export const SOAK_OPERATIONS = ['read', 'edit', 'validate', 'reload', 'screenshot', 'stop'] as const;
export type SoakRole = (typeof SOAK_ROLES)[number];
export type SoakOperation = (typeof SOAK_OPERATIONS)[number];
export interface SoakActor {
  projectId: string;
  role: SoakRole;
  pid: number;
  identity: string;
}
export interface SoakSample {
  elapsedMs: number;
  completedCycles: number;
  rss: Array<SoakActor & { bytes: number }>;
}
export interface SoakCycle {
  index: number;
  projectId: string;
  startedMs: number;
  finishedMs: number;
  operations: Array<{ operation: SoakOperation; startedMs: number; finishedMs: number; durationMs: number }>;
  validation: 'PASS';
  crossProject: 'FORBIDDEN';
}
export interface SoakReport {
  schemaVersion: 2 | 3;
  mode: 'qualify' | 'bounded' | 'smoke';
  status: 'COMPLETED' | 'FAILED' | 'RUNNING';
  measurementSource: 'REAL' | 'MOCK';
  sourceHash: string;
  sourceUnchanged: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  completedCycles: number;
  projectIds: string[];
  persistentActors: SoakActor[];
  samples: SoakSample[];
  cycles: SoakCycle[];
  failedCycles: number;
  skippedCycles: number;
  unknownTransactions: number;
  leakedOwnedProcesses: number;
  cleanup: boolean;
}
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const key = (actor: SoakActor) => `${actor.projectId}:${actor.role}`;
export function soakP95(values: number[]): number {
  if (!values.length || values.some((n) => !Number.isFinite(n) || n < 0)) throw new Error('Invalid p95 sample');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}
export function frozenSoakPlan() {
  return {
    schemaVersion: 3,
    status: 'PLAN_ONLY_NOT_EXECUTED',
    mode: 'bounded',
    limits: BOUNDED_SOAK_LIMITS,
    minimumWallDuration: 'WAIVED_BY_USER',
    longSessionClaims: 'NOT_VERIFIED',
    responseConfiguration: SOAK_RESPONSE_CONFIGURATION,
    minimumProjects: 2,
    persistentRolesPerProject: SOAK_ROLES,
    operations: SOAK_OPERATIONS,
    memoryMethod:
      'Per frozen PID+OS identity: completed cycles [20,120) vs [900,1000]; p95 ratio AND absolute-byte limit',
    latencyMethod:
      'Independent completed operation timestamps in cycle indexes [20,120) vs [900,1000); per project+operation p95; frame timing separate',
    retention: 'Bounded cycle metadata, native failures, sampled screenshots and manifest; no repeated engine copies',
    qualification: 'NOT_QUALIFIED: actual runtime, native manifest and chaos/security required',
  };
}
export function assessSoakReport(input: unknown, expectedSourceHash: string) {
  const errors: string[] = [];
  const metrics: Array<Record<string, string | number>> = [];
  const finish = () => ({
    status: errors.length ? 'FAIL' : 'PASS_REPORTED_LIMITS_ONLY',
    qualification: 'NOT_QUALIFIED',
    errors,
    metrics,
  });
  if (!input || typeof input !== 'object') {
    errors.push('Missing soak report');
    return finish();
  }
  const r = input as SoakReport;
  const bounded = r.schemaVersion === 3 && r.mode === 'bounded';
  if ((!bounded && (r.schemaVersion !== 2 || r.mode !== 'qualify')) || r.status !== 'COMPLETED')
    errors.push('Not a completed qualification-mode report');
  if (r.measurementSource !== 'REAL') errors.push('Measurements must be real, not mock');
  if (!/^[a-f0-9]{64}$/.test(expectedSourceHash) || r.sourceHash !== expectedSourceHash || r.sourceUnchanged !== true)
    errors.push('Source identity mismatch or changed during run');
  if (
    !integer(r.durationMs) ||
    (bounded
      ? r.durationMs <= 0 || r.durationMs > BOUNDED_SOAK_LIMITS.maxDurationMs
      : r.durationMs < SOAK_LIMITS.durationMs)
  )
    errors.push(bounded ? 'Invalid bounded workload duration' : 'Legacy report requires its original duration');
  if (!integer(r.completedCycles) || r.completedCycles < SOAK_LIMITS.cycles)
    errors.push('At least 1000 cycles required');
  if (bounded && r.completedCycles !== BOUNDED_SOAK_LIMITS.cycles)
    errors.push('Bounded workload must contain exactly 1000 cycles');
  const wallMs = Date.parse(r.finishedAt) - Date.parse(r.startedAt);
  if (
    ![r.startedAt, r.finishedAt].every((t) => typeof t === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(t)) ||
    !Number.isFinite(wallMs) ||
    wallMs < (bounded ? 1 : SOAK_LIMITS.durationMs) ||
    Math.abs(wallMs - r.durationMs) > 30000
  )
    errors.push('Wall and monotonic duration must agree');
  for (const field of ['failedCycles', 'skippedCycles', 'unknownTransactions', 'leakedOwnedProcesses'] as const) {
    if (r[field] !== 0) errors.push(`${field} must be explicit zero`);
  }
  if (r.cleanup !== true) errors.push('Owned-process and scratch cleanup must pass');
  if (
    !Array.isArray(r.projectIds) ||
    r.projectIds.length < 2 ||
    new Set(r.projectIds).size !== r.projectIds.length ||
    r.projectIds.some((p) => typeof p !== 'string' || !p)
  )
    errors.push('Two distinct project identities required');
  if (!Array.isArray(r.persistentActors) || !Array.isArray(r.samples) || !Array.isArray(r.projectIds)) {
    errors.push('Missing actor/sample arrays');
    return finish();
  }
  const actors = new Map<string, SoakActor>();
  for (const a of r.persistentActors) {
    if (
      !a ||
      !r.projectIds.includes(a.projectId) ||
      !SOAK_ROLES.includes(a.role) ||
      !integer(a.pid) ||
      !a.pid ||
      typeof a.identity !== 'string' ||
      !a.identity ||
      actors.has(key(a))
    ) {
      errors.push('Invalid or duplicated persistent actor');
      continue;
    }
    actors.set(key(a), a);
  }
  for (const project of r.projectIds)
    for (const role of SOAK_ROLES)
      if (!actors.has(`${project}:${role}`)) errors.push(`Missing actor ${project}:${role}`);
  if (new Set([...actors.values()].map((a) => a.pid)).size !== actors.size)
    errors.push('Persistent roles must use distinct OS processes');
  if (errors.length) return finish();
  let previousMs = -1,
    previousCycles = -1;
  for (const s of r.samples) {
    if (
      !s ||
      !integer(s.elapsedMs) ||
      s.elapsedMs > r.durationMs ||
      s.elapsedMs < previousMs ||
      (previousMs >= 0 && s.elapsedMs - previousMs > SOAK_LIMITS.maxSampleGapMs) ||
      !integer(s.completedCycles) ||
      s.completedCycles < previousCycles ||
      s.completedCycles > r.completedCycles ||
      !Array.isArray(s.rss)
    ) {
      errors.push('Invalid, out-of-order or out-of-run sample');
      break;
    }
    previousMs = s.elapsedMs;
    previousCycles = s.completedCycles;
    if (
      s.rss.some((a) => !a || typeof a !== 'object') ||
      s.rss.length !== actors.size ||
      new Set(s.rss.map(key)).size !== actors.size
    ) {
      errors.push('Incomplete or duplicate RSS sample');
      break;
    }
    for (const a of s.rss) {
      const expected = actors.get(key(a));
      if (!expected || a.pid !== expected.pid || a.identity !== expected.identity || !integer(a.bytes) || !a.bytes)
        errors.push('RSS sample lost or replaced a frozen OS process identity');
    }
  }
  if (previousCycles !== r.completedCycles) errors.push('Last sample must bind the completed cycle count');
  if (
    !r.samples.length ||
    r.samples[0].elapsedMs > SOAK_LIMITS.maxSampleGapMs ||
    r.durationMs - previousMs > SOAK_LIMITS.maxSampleGapMs
  )
    errors.push('Samples must cover the beginning and end of the workload');
  if (errors.length) return finish();
  if (!Array.isArray(r.cycles) || r.cycles.length !== r.completedCycles) {
    errors.push('One independently timed native record per completed cycle required');
    return finish();
  }
  const indexes = new Set<number>();
  const lastProjectEnd = new Map<string, number>();
  for (const c of [...r.cycles].sort((a, b) => (a?.startedMs ?? 0) - (b?.startedMs ?? 0))) {
    if (
      !c ||
      !integer(c.index) ||
      c.index >= r.completedCycles ||
      indexes.has(c.index) ||
      !r.projectIds.includes(c.projectId) ||
      !integer(c.startedMs) ||
      !integer(c.finishedMs) ||
      c.startedMs >= c.finishedMs ||
      c.finishedMs > r.durationMs ||
      c.startedMs < (lastProjectEnd.get(c.projectId) ?? 0) ||
      c.validation !== 'PASS' ||
      c.crossProject !== 'FORBIDDEN' ||
      !Array.isArray(c.operations)
    ) {
      errors.push('Invalid, duplicated or overlapping project cycle');
      return finish();
    }
    indexes.add(c.index);
    lastProjectEnd.set(c.projectId, c.finishedMs);
    const seen = new Set<SoakOperation>();
    let priorEnd = c.startedMs;
    for (const o of c.operations) {
      if (
        !o ||
        !SOAK_OPERATIONS.includes(o.operation) ||
        seen.has(o.operation) ||
        !integer(o.startedMs) ||
        !integer(o.finishedMs) ||
        !positive(o.durationMs) ||
        o.startedMs < priorEnd ||
        o.finishedMs <= o.startedMs ||
        o.finishedMs > c.finishedMs ||
        Math.abs(o.finishedMs - o.startedMs - o.durationMs) > 2
      ) {
        errors.push('Invalid or reused operation latency observation');
        return finish();
      }
      priorEnd = o.finishedMs;
      seen.add(o.operation);
    }
    if (seen.size !== SOAK_OPERATIONS.length) errors.push('Missing operation in native cycle');
  }
  if (errors.length) return finish();
  const first = r.samples.filter((s) =>
    bounded
      ? s.completedCycles >= BOUNDED_SOAK_LIMITS.warmupCycles &&
        s.completedCycles < BOUNDED_SOAK_LIMITS.warmupCycles + BOUNDED_SOAK_LIMITS.windowCycles
      : s.elapsedMs >= SOAK_LIMITS.warmupMs && s.elapsedMs < SOAK_LIMITS.warmupMs + SOAK_LIMITS.windowMs,
  );
  const last = r.samples.filter((s) =>
    bounded
      ? s.completedCycles >= BOUNDED_SOAK_LIMITS.cycles - BOUNDED_SOAK_LIMITS.windowCycles
      : s.elapsedMs >= r.durationMs - SOAK_LIMITS.windowMs,
  );
  if (first.length < SOAK_LIMITS.minWindowSamples || last.length < SOAK_LIMITS.minWindowSamples) {
    errors.push('Insufficient independent comparison-window samples');
    return finish();
  }
  for (const [slot] of actors) {
    const p95 = (rows: SoakSample[]) => soakP95(rows.map((s) => s.rss.find((a) => key(a) === slot)!.bytes));
    const before = p95(first),
      after = p95(last),
      growthBytes = after - before,
      ratio = after / before - 1;
    metrics.push({ actor: slot, firstP95Bytes: before, lastP95Bytes: after, growthBytes, growthRatio: ratio });
    if (growthBytes > SOAK_LIMITS.maxRssGrowthBytes || after > before * (1 + SOAK_LIMITS.maxRssGrowthRatio))
      errors.push(`RSS growth exceeds frozen limits: ${slot}`);
  }
  for (const projectId of r.projectIds)
    for (const operation of SOAK_OPERATIONS) {
      const observations = r.cycles
        .filter((c) => c.projectId === projectId)
        .flatMap((c) => c.operations.map((o) => ({ ...o, cycleIndex: c.index })))
        .filter((o) => o.operation === operation);
      const beforeRows = observations.filter((o) =>
        bounded
          ? o.cycleIndex >= BOUNDED_SOAK_LIMITS.warmupCycles &&
            o.cycleIndex < BOUNDED_SOAK_LIMITS.warmupCycles + BOUNDED_SOAK_LIMITS.windowCycles
          : o.startedMs >= SOAK_LIMITS.warmupMs && o.finishedMs < SOAK_LIMITS.warmupMs + SOAK_LIMITS.windowMs,
      );
      const afterRows = observations.filter((o) =>
        bounded
          ? o.cycleIndex >= BOUNDED_SOAK_LIMITS.cycles - BOUNDED_SOAK_LIMITS.windowCycles
          : o.startedMs >= r.durationMs - SOAK_LIMITS.windowMs,
      );
      if (beforeRows.length < SOAK_LIMITS.minWindowSamples || afterRows.length < SOAK_LIMITS.minWindowSamples) {
        errors.push(`Insufficient independent latency observations: ${projectId}:${operation}`);
        continue;
      }
      const before = soakP95(beforeRows.map((o) => o.durationMs));
      const after = soakP95(afterRows.map((o) => o.durationMs));
      metrics.push({ projectId, operation, firstP95Ms: before, lastP95Ms: after, ratio: after / before });
      if (after > before * SOAK_LIMITS.maxLatencyRatio)
        errors.push(`Latency growth exceeds frozen limit: ${projectId}:${operation}`);
    }
  return finish();
}

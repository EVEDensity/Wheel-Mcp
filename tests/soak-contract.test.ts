import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessSoakReport,
  frozenSoakPlan,
  SOAK_LIMITS,
  SOAK_OPERATIONS,
  SOAK_ROLES,
  soakP95,
  type SoakReport,
} from '../src/soak-contract.js';
const source = 'a'.repeat(64);
const MiB = 1024 * 1024;
/** Synthetic unit-test input only; never written as evidence of a real soak. */
function fixture(): SoakReport {
  const actors = ['A', 'B'].flatMap((projectId, p) =>
    SOAK_ROLES.map((role, i) => ({ projectId, role, pid: 100 + p * 3 + i, identity: `synthetic-${p}-${i}` })),
  );
  const times = Array.from(
    { length: SOAK_LIMITS.durationMs / SOAK_LIMITS.maxSampleGapMs + 1 },
    (_, i) => i * SOAK_LIMITS.maxSampleGapMs,
  );
  return {
    schemaVersion: 2,
    mode: 'qualify',
    status: 'COMPLETED',
    measurementSource: 'REAL',
    sourceHash: source,
    sourceUnchanged: true,
    startedAt: '2026-10-09T00:00:00Z',
    finishedAt: '2026-10-09T08:00:00Z',
    durationMs: SOAK_LIMITS.durationMs,
    completedCycles: 1000,
    projectIds: ['A', 'B'],
    persistentActors: actors,
    samples: times.map((elapsedMs, i) => ({
      elapsedMs,
      completedCycles: Math.floor((i * 1000) / (times.length - 1)),
      rss: actors.map((a) => ({ ...a, bytes: 100 * MiB })),
    })),
    cycles: Array.from({ length: 1000 }, (_, index) => {
      const startedMs = index * (SOAK_LIMITS.durationMs / 1000);
      return {
        index,
        projectId: index % 2 ? 'B' : 'A',
        startedMs,
        finishedMs: startedMs + 200,
        validation: 'PASS',
        crossProject: 'FORBIDDEN',
        operations: SOAK_OPERATIONS.map((operation, j) => ({
          operation,
          startedMs: startedMs + j * 20,
          finishedMs: startedMs + j * 20 + 10,
          durationMs: 10,
        })),
      };
    }),
    failedCycles: 0,
    skippedCycles: 0,
    unknownTransactions: 0,
    leakedOwnedProcesses: 0,
    cleanup: true,
  };
}
test('T31 active plan waives wall duration, freezes 1000 cycles and excludes long-session claims', () => {
  const p = frozenSoakPlan();
  assert.equal(p.status, 'PLAN_ONLY_NOT_EXECUTED');
  assert.equal(p.minimumWallDuration, 'WAIVED_BY_USER');
  assert.equal(p.longSessionClaims, 'NOT_VERIFIED');
  assert.equal(p.mode, 'bounded');
  assert.equal(p.responseConfiguration.runtimeRpc, 'compact');
  assert.equal(p.responseConfiguration.defaultResponseByteBudgetUnchanged, true);
  assert.equal(p.limits.cycles, 1000);
  assert.equal(p.operations.length, 6);
});
test('T31 synthetic valid limits pass only the limit checker, never actual qualification', () => {
  const r = assessSoakReport(fixture(), source);
  assert.equal(r.status, 'PASS_REPORTED_LIMITS_ONLY');
  assert.equal(r.qualification, 'NOT_QUALIFIED');
  assert.equal(r.metrics.length, 18);
});
for (const [name, mutate] of [
  [
    'short duration',
    (r: SoakReport) => {
      r.durationMs--;
    },
  ],
  [
    'short count',
    (r: SoakReport) => {
      r.completedCycles = 999;
    },
  ],
  [
    'smoke mode',
    (r: SoakReport) => {
      r.mode = 'smoke';
    },
  ],
  [
    'mock measurements',
    (r: SoakReport) => {
      r.measurementSource = 'MOCK';
    },
  ],
  [
    'changed source',
    (r: SoakReport) => {
      r.sourceUnchanged = false;
    },
  ],
  [
    'wall clock mismatch',
    (r: SoakReport) => {
      r.finishedAt = '2026-10-09T01:00:00Z';
    },
  ],
  [
    'one project',
    (r: SoakReport) => {
      r.projectIds = ['A'];
    },
  ],
  [
    'missing role',
    (r: SoakReport) => {
      r.persistentActors.pop();
    },
  ],
  [
    'PID reuse',
    (r: SoakReport) => {
      r.samples.at(-1)!.rss[0].identity = 'reused-pid';
    },
  ],
  [
    'absent RSS',
    (r: SoakReport) => {
      r.samples.at(-1)!.rss.pop();
    },
  ],
  [
    'missing operation',
    (r: SoakReport) => {
      r.cycles.at(-1)!.operations.pop();
    },
  ],
  [
    'failed cycle',
    (r: SoakReport) => {
      r.failedCycles = 1;
    },
  ],
  [
    'skipped cycle',
    (r: SoakReport) => {
      r.skippedCycles = 1;
    },
  ],
  [
    'unknown transaction',
    (r: SoakReport) => {
      r.unknownTransactions = 1;
    },
  ],
  [
    'leaked process',
    (r: SoakReport) => {
      r.leakedOwnedProcesses = 1;
    },
  ],
  [
    'failed cleanup',
    (r: SoakReport) => {
      r.cleanup = false;
    },
  ],
  [
    'out of order samples',
    (r: SoakReport) => {
      r.samples.reverse();
    },
  ],
  [
    'insufficient samples',
    (r: SoakReport) => {
      r.samples = r.samples.slice(-10);
    },
  ],
  [
    'aliased OS process roles',
    (r: SoakReport) => {
      r.persistentActors[1].pid = r.persistentActors[0].pid;
    },
  ],
  [
    'sampling gap',
    (r: SoakReport) => {
      r.samples.splice(100, 1);
    },
  ],
  [
    'missing tail',
    (r: SoakReport) => {
      r.samples.splice(-2);
      r.samples.at(-1)!.completedCycles = 1000;
    },
  ],
  [
    'malformed RSS row',
    (r: SoakReport) => {
      r.samples.at(-1)!.rss[0] = null as unknown as SoakReport['persistentActors'][number] & { bytes: number };
    },
  ],
] as const) {
  test(`T31 rejects ${name} without weakening thresholds`, () => {
    const r = fixture();
    mutate(r);
    assert.equal(assessSoakReport(r, source).status, 'FAIL');
  });
}
test('T31 enforces both relative and absolute memory growth and inclusive latency boundary', () => {
  for (const [before, after, pass] of [
    [100 * MiB, 120 * MiB, true],
    [100 * MiB, 121 * MiB, false],
    [1024 * MiB, 1152 * MiB, true],
    [1024 * MiB, 1152 * MiB + 1, false],
  ] as const) {
    const r = fixture();
    r.samples.forEach((s) => {
      const last = s.elapsedMs >= r.durationMs - SOAK_LIMITS.windowMs;
      s.rss.forEach((a) => {
        a.bytes = last ? after : before;
      });
    });
    r.cycles.forEach((c) => {
      const o = c.operations[0];
      o.durationMs = c.startedMs >= r.durationMs - SOAK_LIMITS.windowMs ? 15 : 10;
      o.finishedMs = o.startedMs + o.durationMs;
    });
    assert.equal(assessSoakReport(r, source).status, pass ? 'PASS_REPORTED_LIMITS_ONLY' : 'FAIL');
  }
  const r = fixture();
  r.cycles.slice(-8).forEach((c) => {
    c.operations[0].durationMs = 15.01;
    c.operations[0].finishedMs = c.operations[0].startedMs + 15;
  });
  assert.equal(assessSoakReport(r, source).status, 'FAIL');
});

test('T31 RSS samples never substitute for actual per-project latency observations', () => {
  for (const mutate of [
    (r: SoakReport) => {
      r.cycles.pop();
    },
    (r: SoakReport) => {
      r.cycles[1].index = 0;
    },
    (r: SoakReport) => {
      r.cycles[1].projectId = 'foreign';
    },
    (r: SoakReport) => {
      r.cycles[1].operations[0].durationMs = 200;
    },
    (r: SoakReport) => {
      r.cycles[1].operations[0].startedMs = 0;
    },
    (r: SoakReport) => {
      r.cycles[1].operations[1] = r.cycles[1].operations[0];
    },
    (r: SoakReport) => {
      r.cycles.forEach((c) => {
        c.projectId = 'A';
      });
    },
    (r: SoakReport) => {
      r.cycles[2].startedMs = 0;
    },
  ]) {
    const r = fixture();
    mutate(r);
    assert.equal(assessSoakReport(r, source).status, 'FAIL');
  }
});
test('T31 p95 and malformed inputs fail closed', () => {
  assert.equal(soakP95([1, 2, 3, 4]), 4);
  assert.throws(() => soakP95([]));
  assert.throws(() => soakP95([NaN]));
  assert.equal(assessSoakReport(null, source).status, 'FAIL');
  assert.equal(assessSoakReport({}, source).status, 'FAIL');
  assert.equal(assessSoakReport(fixture(), 'b'.repeat(64)).status, 'FAIL');
});

function boundedFixture(): SoakReport {
  const r = fixture();
  r.schemaVersion = 3;
  r.mode = 'bounded';
  r.durationMs = 3600000;
  r.finishedAt = '2026-10-09T01:00:00Z';
  r.samples = Array.from({ length: 241 }, (_, i) => ({
    elapsedMs: i * 15000,
    completedCycles: Math.floor((i * 1000) / 240),
    rss: r.persistentActors.map((a) => ({ ...a, bytes: 100 * MiB })),
  }));
  r.cycles.forEach((c) => {
    c.startedMs = c.index * 3600;
    c.finishedMs = c.startedMs + 200;
    c.operations = SOAK_OPERATIONS.map((operation, j) => ({
      operation,
      startedMs: c.startedMs + j * 20,
      finishedMs: c.startedMs + j * 20 + 10,
      durationMs: 10,
    }));
  });
  return r;
}
test('T31 bounded schema passes only 1000-cycle limits, never grants long-session or production qualification', () => {
  const r = assessSoakReport(boundedFixture(), source);
  assert.equal(r.status, 'PASS_REPORTED_LIMITS_ONLY');
  assert.equal(r.qualification, 'NOT_QUALIFIED');
  assert.equal(r.metrics.length, 18);
  const legacy = boundedFixture();
  legacy.schemaVersion = 2;
  legacy.mode = 'qualify';
  assert.equal(assessSoakReport(legacy, source).status, 'FAIL', 'Old records must not inherit the waiver');
});
test('T31 bounded workload still fails incomplete cycles, native errors, identity gaps and unsafe cleanup', () => {
  for (const mutate of [
    (r: SoakReport) => {
      r.completedCycles = 999;
    },
    (r: SoakReport) => {
      r.failedCycles = 1;
    },
    (r: SoakReport) => {
      r.unknownTransactions = 1;
    },
    (r: SoakReport) => {
      r.leakedOwnedProcesses = 1;
    },
    (r: SoakReport) => {
      r.skippedCycles = 1;
    },
    (r: SoakReport) => {
      r.cleanup = false;
    },
    (r: SoakReport) => {
      r.sourceUnchanged = false;
    },
    (r: SoakReport) => {
      r.samples.splice(2, 3);
    },
    (r: SoakReport) => {
      r.samples.at(-1)!.rss[0].identity = 'replacement';
    },
    (r: SoakReport) => {
      r.cycles[900].operations.pop();
    },
    (r: SoakReport) => {
      r.status = 'FAILED';
    },
  ]) {
    const r = boundedFixture();
    mutate(r);
    assert.equal(assessSoakReport(r, source).status, 'FAIL');
  }
});
test('T31 bounded comparison retains both RSS limits, latency limits and minimum independent observations', () => {
  for (const mutate of [
    (r: SoakReport) => {
      r.samples.filter((s) => s.completedCycles >= 900).forEach((s) => (s.rss[0].bytes = 121 * MiB));
    },
    (r: SoakReport) => {
      r.samples.forEach((s) => (s.rss[0].bytes = (s.completedCycles >= 900 ? 1153 : 1024) * MiB));
    },
    (r: SoakReport) => {
      r.cycles.slice(900).forEach((c) => {
        c.operations[0].durationMs = 16;
        c.operations[0].finishedMs = c.operations[0].startedMs + 16;
      });
    },
    (r: SoakReport) => {
      r.samples.forEach((s) => {
        if (s.completedCycles >= 20 && s.completedCycles < 120) s.completedCycles = 120;
      });
    },
  ]) {
    const r = boundedFixture();
    mutate(r);
    assert.equal(assessSoakReport(r, source).status, 'FAIL');
  }
});

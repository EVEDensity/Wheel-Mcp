import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { scheduleSoak, type SoakSchedule } from '../src/soak-scheduler.js';

const short: SoakSchedule = {
  durationMs: 150,
  cycles: 4,
  concurrency: 2,
  sampleIntervalMs: 20,
  maxSampleGapMs: 1000,
  maxDurationMs: 3000,
};
test('T31 scheduler samples independently during in-flight work and waits for both count and duration', async () => {
  let active = 0,
    max = 0,
    sampledActive = false;
  const cycles: number[] = [],
    snapshots: number[] = [];
  const result = await scheduleSoak(short, {
    cycle: async (i, signal) => {
      active++;
      max = Math.max(max, active);
      try {
        await delay(60, undefined, { signal });
        cycles.push(i);
      } finally {
        active--;
      }
    },
    sample: async () => {
      sampledActive ||= active > 0;
    },
    checkpoint: async (count) => {
      snapshots.push(count);
    },
  });
  assert.equal(result.completedCycles, 4);
  assert.ok(result.durationMs >= short.durationMs);
  assert.equal(max, 2);
  assert.equal(active, 0);
  assert.equal(sampledActive, true);
  assert.deepEqual(cycles.sort(), [0, 1, 2, 3]);
  assert.equal(snapshots.at(-1), 4);
});
test('T31 sampler failure cancels in-flight writers and settles them before returning', async () => {
  let active = 0,
    calls = 0;
  await assert.rejects(
    scheduleSoak(short, {
      cycle: async (_i, signal) => {
        active++;
        try {
          await delay(500, undefined, { signal });
        } finally {
          active--;
        }
      },
      sample: async () => {
        if (++calls > 1) throw new Error('OS sample lost');
      },
      checkpoint: async () => {},
    }),
    /OS sample lost/,
  );
  assert.equal(active, 0);
});
test('T31 native operation failure aborts the sibling, without retries or skipped-pass records', async () => {
  let active = 0,
    starts = 0;
  await assert.rejects(
    scheduleSoak(short, {
      cycle: async (i, signal) => {
        starts++;
        active++;
        try {
          if (i === 0) {
            await delay(10);
            throw new Error('unknown transaction');
          }
          await delay(500, undefined, { signal });
        } finally {
          active--;
        }
      },
      sample: async () => {},
      checkpoint: async () => {},
    }),
    /unknown transaction/,
  );
  assert.equal(starts, 2);
  assert.equal(active, 0);
});
test('T31 rejects telemetry gaps, external cancellation and hard deadline', async () => {
  await assert.rejects(
    scheduleSoak(
      { ...short, sampleIntervalMs: 1, maxSampleGapMs: 5 },
      {
        cycle: async () => {},
        sample: async () => {
          await delay(15);
        },
        checkpoint: async () => {},
      },
    ),
    /sampling gap/,
  );
  const stop = new AbortController();
  stop.abort(new Error('human cancelled'));
  await assert.rejects(
    scheduleSoak(short, { cycle: async () => {}, sample: async () => {}, checkpoint: async () => {} }, stop.signal),
    /human cancelled/,
  );
  await assert.rejects(
    scheduleSoak(
      { ...short, durationMs: 30, maxDurationMs: 40 },
      {
        cycle: async (_i, signal) => {
          await delay(500, undefined, { signal });
        },
        sample: async () => {},
        checkpoint: async () => {},
      },
    ),
    /maximum duration/,
  );
});
test('T31 invalid plans do not invoke any native work', async () => {
  let calls = 0;
  for (const invalid of [{ cycles: 0 }, { concurrency: 3 }, { sampleIntervalMs: 1000 }, { maxDurationMs: 1 }]) {
    await assert.rejects(
      scheduleSoak({ ...short, ...invalid } as SoakSchedule, {
        cycle: async () => {
          calls++;
        },
        sample: async () => {
          calls++;
        },
        checkpoint: async () => {},
      }),
      /Invalid/,
    );
  }
  assert.equal(calls, 0);
});

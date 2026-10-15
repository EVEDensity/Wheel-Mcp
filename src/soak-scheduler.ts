import { setTimeout as delay } from 'node:timers/promises';

export interface SoakSchedule {
  durationMs: number;
  cycles: number;
  concurrency: 1 | 2;
  sampleIntervalMs: number;
  maxSampleGapMs: number;
  maxDurationMs: number;
}
/** Orchestration only: no authority to mark T31 or production qualified. */
export async function scheduleSoak(
  plan: SoakSchedule,
  callbacks: {
    cycle: (index: number, signal: AbortSignal) => Promise<void>;
    sample: (elapsed: () => number, signal: AbortSignal) => Promise<void>;
    checkpoint: (completedCycles: number, elapsedMs: number) => Promise<void>;
  },
  externalSignal?: AbortSignal,
) {
  for (const value of Object.values(plan))
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid bounded soak schedule');
  if (
    ![1, 2].includes(plan.concurrency) ||
    plan.sampleIntervalMs >= plan.maxSampleGapMs ||
    plan.maxDurationMs < plan.durationMs
  )
    throw new Error('Invalid soak concurrency/sample/deadline limits');
  const controller = new AbortController();
  const signal = controller.signal;
  const abort = () => controller.abort(externalSignal?.reason ?? new Error('Soak cancelled'));
  externalSignal?.addEventListener('abort', abort, { once: true });
  if (externalSignal?.aborted) abort();
  const start = performance.now();
  const elapsed = () => Math.floor(performance.now() - start);
  let completedCycles = 0,
    finishedWorkload = false,
    lastSample = -1,
    failure: unknown;
  const fail = (error: unknown) => {
    failure ??= error;
    controller.abort(error);
  };
  const sleepUntil = async (due: number) => {
    while (elapsed() < due) {
      signal.throwIfAborted();
      await delay(Math.min(1000, due - elapsed()), undefined, { signal });
    }
    signal.throwIfAborted();
  };
  const takeSample = async () => {
    signal.throwIfAborted();
    await callbacks.sample(elapsed, signal);
    const now = elapsed();
    if ((lastSample < 0 ? now : now - lastSample) > plan.maxSampleGapMs)
      throw new Error('Continuous OS telemetry exceeded the frozen sampling gap');
    lastSample = now;
    await callbacks.checkpoint(completedCycles, now);
  };
  // Deadline cancellation must propagate into SDK requests. Never abandon a pending writer and start cleanup.
  const deadline = setTimeout(() => fail(new Error('Soak maximum duration exceeded')), plan.maxDurationMs);
  try {
    await takeSample();
    const monitor = (async () => {
      try {
        while (!finishedWorkload) {
          await sleepUntil(lastSample + plan.sampleIntervalMs);
          if (!finishedWorkload) await takeSample();
        }
      } catch (error) {
        fail(error);
      }
    })();
    const workload = (async () => {
      try {
        for (let index = 0; index < plan.cycles; index += plan.concurrency) {
          await sleepUntil(Math.floor((index * plan.durationMs) / plan.cycles));
          const batch = Array.from({ length: Math.min(plan.concurrency, plan.cycles - index) }, (_, j) => index + j);
          // All pending cycles settle before stop/cleanup, including when one project fails.
          const results = await Promise.allSettled(
            batch.map(async (i) => {
              signal.throwIfAborted();
              try {
                await callbacks.cycle(i, signal);
                completedCycles++;
              } catch (error) {
                fail(error);
                throw error;
              }
            }),
          );
          const rejected = results.find((r) => r.status === 'rejected');
          if (rejected?.status === 'rejected') throw rejected.reason;
          signal.throwIfAborted();
          await callbacks.checkpoint(completedCycles, elapsed());
        }
        await sleepUntil(plan.durationMs);
      } catch (error) {
        fail(error);
      } finally {
        finishedWorkload = true;
      }
    })();
    await Promise.all([monitor, workload]);
    if (failure) throw failure;
    signal.throwIfAborted();
    await takeSample();
    return { completedCycles, durationMs: elapsed() };
  } finally {
    finishedWorkload = true;
    clearTimeout(deadline);
    externalSignal?.removeEventListener('abort', abort);
  }
}

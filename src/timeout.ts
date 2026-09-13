export class TimeoutError extends Error {
  readonly code = 'TIMEOUT' as const;
  readonly timed_out = true;
  constructor(message = 'operation timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}
export class CancelledError extends Error {
  readonly code = 'CANCELLED' as const;
  readonly cancelled = true;
  constructor(message = 'operation cancelled') {
    super(message);
    this.name = 'CancelledError';
  }
}
export type TimeoutContext = {
  signal: AbortSignal;
  deadline: number;
  remaining(): number;
  throwIfExpired(): void;
  throwIfCancelled(): void;
  cancel(reason?: string): void;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  dispose(): void;
};
export function createTimeoutContext(timeoutMs: number, parent?: AbortSignal): TimeoutContext {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error('timeoutMs must be a non-negative number');
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  let timedOut = false;
  let cancelled = false;
  let disposed = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new TimeoutError());
  }, timeoutMs);
  const onParentAbort = () => {
    if (!disposed && !controller.signal.aborted) {
      cancelled = true;
      controller.abort(parent?.reason instanceof Error ? parent.reason : new CancelledError());
    }
  };
  parent?.addEventListener('abort', onParentAbort, { once: true });
  if (parent?.aborted) onParentAbort();
  return {
    signal: controller.signal,
    deadline,
    remaining: () => Math.max(0, deadline - Date.now()),
    throwIfExpired() {
      if (timedOut || Date.now() >= deadline) {
        timedOut = true;
        throw new TimeoutError();
      }
      if (controller.signal.aborted && !cancelled) throw new TimeoutError();
    },
    throwIfCancelled() {
      if (cancelled || (controller.signal.aborted && !timedOut)) throw new CancelledError();
      if (timedOut) throw new TimeoutError();
    },
    cancel(reason = 'operation cancelled') {
      if (!disposed && !controller.signal.aborted) {
        cancelled = true;
        controller.abort(new CancelledError(reason));
      }
    },
    get timedOut() {
      return timedOut;
    },
    get cancelled() {
      return cancelled;
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        clearTimeout(timer);
        parent?.removeEventListener('abort', onParentAbort);
      }
    },
  };
}

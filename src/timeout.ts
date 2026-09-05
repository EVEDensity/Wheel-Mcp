export class TimeoutError extends Error { code = 'TIMEOUT'; timed_out = true; constructor(message = 'operation timed out') { super(message); } }

export type TimeoutContext = { signal: AbortSignal; deadline: number; remaining(): number; throwIfExpired(): void };

export function createTimeoutContext(timeoutMs: number, parent?: AbortSignal): TimeoutContext {
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const timer = setTimeout(() => controller.abort(new TimeoutError()), timeoutMs);
  parent?.addEventListener('abort', () => controller.abort(parent.reason), { once: true });
  return { signal: controller.signal, deadline, remaining: () => Math.max(0, deadline - Date.now()), throwIfExpired() { if (Date.now() >= deadline || controller.signal.aborted) throw new TimeoutError(); } };
}

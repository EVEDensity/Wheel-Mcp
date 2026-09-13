export type LimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; reason: 'rate' | 'concurrency' };

type Window = { startedAt: number; count: number };

export class HttpRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly windowMs: number,
    private readonly maxRequests: number,
  ) {}

  check(key: string, now = Date.now()): LimitResult {
    let window = this.windows.get(key);
    if (!window || now - window.startedAt >= this.windowMs) {
      window = { startedAt: now, count: 0 };
      this.windows.set(key, window);
    }
    if (window.count >= this.maxRequests) {
      return {
        allowed: false,
        reason: 'rate',
        retryAfterSeconds: Math.max(1, Math.ceil((window.startedAt + this.windowMs - now) / 1000)),
      };
    }
    window.count += 1;
    return { allowed: true };
  }

  clear(): void {
    this.windows.clear();
  }
}

export class HttpConcurrencyLimiter {
  private active = 0;
  private readonly clients = new Map<string, number>();

  constructor(
    private readonly max: number,
    private readonly maxPerClient: number,
  ) {}

  acquire(clientId: string): LimitResult & { release?: () => void } {
    const clientActive = this.clients.get(clientId) ?? 0;
    if (this.active >= this.max || clientActive >= this.maxPerClient) {
      return { allowed: false, reason: 'concurrency', retryAfterSeconds: 1 };
    }
    this.active += 1;
    this.clients.set(clientId, clientActive + 1);
    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) return;
        released = true;
        this.active -= 1;
        const next = (this.clients.get(clientId) ?? 1) - 1;
        if (next <= 0) this.clients.delete(clientId);
        else this.clients.set(clientId, next);
      },
    };
  }

  get activeCount(): number {
    return this.active;
  }
}

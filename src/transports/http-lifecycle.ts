import { AsyncLocalStorage } from 'node:async_hooks';

const requestLifecycleStorage = new AsyncLocalStorage<HttpRequestLifecycle>();

export function runWithHttpRequestContext<T>(lifecycle: HttpRequestLifecycle, operation: () => T): T {
  return requestLifecycleStorage.run(lifecycle, operation);
}

export function runWithHttpRequestSignal<T>(signal: AbortSignal, operation: () => T): T {
  return requestLifecycleStorage.run(createDetachedLifecycle(signal), operation);
}

function createDetachedLifecycle(signal: AbortSignal): HttpRequestLifecycle {
  return {
    requestId: '',
    signal,
    retain: () => undefined,
    release: () => undefined,
    finish: () => undefined,
    abort: () => undefined,
  };
}

export function getHttpRequestLifecycle(): HttpRequestLifecycle | undefined {
  return requestLifecycleStorage.getStore();
}

export function getHttpRequestSignal(): AbortSignal | undefined {
  return requestLifecycleStorage.getStore()?.signal;
}

export function mergeAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  return createMergedAbortSignal(...signals)?.signal;
}

export function createMergedAbortSignal(
  ...signals: Array<AbortSignal | undefined>
): { signal: AbortSignal; dispose: () => void } | undefined {
  const active = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (active.length === 0) return undefined;
  if (active.length === 1) return { signal: active[0], dispose: () => undefined };
  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  const listeners = active.map((signal) => {
    if (signal.aborted) abort(signal);
    const listener = () => abort(signal);
    signal.addEventListener('abort', listener, { once: true });
    return { signal, listener };
  });
  const dispose = () => listeners.forEach(({ signal, listener }) => signal.removeEventListener('abort', listener));
  if (controller.signal.aborted) dispose();
  else controller.signal.addEventListener('abort', dispose, { once: true });
  return { signal: controller.signal, dispose };
}

export type HttpRequestLifecycle = {
  requestId: string;
  signal: AbortSignal;
  retain(): void;
  release(): void;
  finish(): void;
  abort(reason: Error): void;
};

type RequestLike = { once(event: 'aborted', listener: () => void): unknown };
type ResponseLike = {
  once(event: 'close' | 'finish', listener: () => void): unknown;
  writableEnded: boolean;
};

export class HttpRequestRegistry {
  private readonly inFlight = new Map<string, HttpRequestLifecycle>();

  begin(requestId: string, req: RequestLike, res: ResponseLike): HttpRequestLifecycle {
    const controller = new AbortController();
    let httpFinished = false;
    let retainers = 0;
    const removeIfDone = () => {
      if (httpFinished && retainers === 0) this.inFlight.delete(requestId);
    };
    const lifecycle: HttpRequestLifecycle = {
      requestId,
      signal: controller.signal,
      retain: () => {
        retainers += 1;
      },
      release: () => {
        if (retainers === 0) return;
        retainers -= 1;
        removeIfDone();
      },
      finish: () => {
        if (httpFinished) return;
        httpFinished = true;
        removeIfDone();
      },
      abort: (reason) => {
        if (!controller.signal.aborted) controller.abort(reason);
      },
    };
    req.once('aborted', () => lifecycle.abort(new Error('HTTP request aborted')));
    res.once('close', () => {
      if (!res.writableEnded) lifecycle.abort(new Error('HTTP response connection closed'));
    });
    res.once('finish', lifecycle.finish);
    this.inFlight.set(requestId, lifecycle);
    return lifecycle;
  }

  abortAll(reason: Error): void {
    for (const request of this.inFlight.values()) request.abort(reason);
  }

  get size(): number {
    return this.inFlight.size;
  }

  async waitForEmpty(timeoutMs: number): Promise<boolean> {
    if (this.inFlight.size === 0) return true;
    const deadline = Date.now() + timeoutMs;
    while (this.inFlight.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
    }
    return this.inFlight.size === 0;
  }
}

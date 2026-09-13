import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { createTimeoutContext, TimeoutContext, TimeoutError, CancelledError } from './timeout.js';
import { terminateProcessTree } from './process-tree.js';
import { ensureEvidenceManifest } from './evidence.js';
import { DEFAULT_GODOT_PROCESS_TIMEOUT_MS, DEFAULT_STOP_TIMEOUT_MS } from './timeouts.js';

export type PersistentBridgeOptions = {
  godotPath?: string;
  projectPath: string;
  bridgePath: string;
  evidenceDir?: string;
  runId?: string;
  headless?: boolean;
  scenePath?: string;
  timeout?: TimeoutContext;
};

type JsonRpcRequest = { jsonrpc: '2.0'; id: number; method: string; params: Record<string, unknown> };
type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number | string; message: string; data?: unknown };
};
type JsonRpcNotification = { jsonrpc: '2.0'; method: string; params?: Record<string, unknown> };
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  abortCleanup?: () => void;
};

function resolveGodotPath(value = process.env.GODOT_PATH): string {
  if (!value) throw new Error('GODOT_PATH is required');
  return path.resolve(value);
}

export class PersistentRuntimeBridge {
  readonly sessionId: string;
  readonly pid: number;
  readonly evidenceDir: string;
  readonly projectPath: string;
  private readonly child: ChildProcess;
  private readonly socket: net.Socket;
  private readonly pending = new Map<number, Pending>();
  private readonly events: JsonRpcNotification[] = [];
  private buffer = '';
  private nextId = 1;
  private closed = false;
  private logs = { stdout: '', stderr: '' };

  async flushLogs(): Promise<void> {
    await Promise.all([
      writeFile(path.join(this.evidenceDir, 'stdout.log'), this.logs.stdout),
      writeFile(path.join(this.evidenceDir, 'stderr.log'), this.logs.stderr),
    ]);
  }
  private closePromise: Promise<void> | null = null;

  private constructor(
    sessionId: string,
    child: ChildProcess,
    socket: net.Socket,
    evidenceDir: string,
    projectPath: string,
  ) {
    if (!child.pid) throw new Error('persistent bridge process has no pid');
    this.sessionId = sessionId;
    this.pid = child.pid;
    this.child = child;
    this.socket = socket;
    this.evidenceDir = evidenceDir;
    this.projectPath = projectPath;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => this.onData(String(chunk)));
    socket.on('error', (error) => this.failPending(error));
    socket.on('close', () => this.failPending(new Error('persistent bridge connection closed')));
    child.once('close', () => this.failPending(new Error('persistent bridge process exited')));
  }

  static async start(options: PersistentBridgeOptions): Promise<PersistentRuntimeBridge> {
    const root = path.resolve(options.projectPath);
    const evidenceDir = path.resolve(options.evidenceDir || path.join(root, '.harness', 'persistent-bridge'));
    await mkdir(evidenceDir, { recursive: true });
    await ensureEvidenceManifest(evidenceDir, 'BRIDGE_EVIDENCE');
    const sessionId = options.runId || `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const server = net.createServer();
    const connection = new Promise<net.Socket>((resolve, reject) => {
      server.once('connection', (socket) => resolve(socket));
      server.once('error', reject);
    });
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('unable to allocate bridge port');
    const child = spawn(
      resolveGodotPath(options.godotPath),
      [
        ...(options.headless === true ? ['--headless'] : []),
        '--path',
        root,
        '--script',
        path.resolve(options.bridgePath),
        '--',
        '--harness-port',
        String(address.port),
      ],
      {
        cwd: root,
        windowsHide: true,
        detached: process.platform !== 'win32',
        env: {
          ...process.env,
          GODOT_HARNESS_RUN_ID: sessionId,
          GODOT_HARNESS_MAIN_SCENE: options.scenePath || '',
          GODOT_HARNESS_PORT: String(address.port),
        },
      },
    );
    const logs = { stdout: '', stderr: '' };
    child.stdout?.on('data', (chunk) => {
      logs.stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      logs.stderr += String(chunk);
    });
    child.once('close', () => {
      void Promise.all([
        writeFile(path.join(evidenceDir, 'stdout.log'), logs.stdout),
        writeFile(path.join(evidenceDir, 'stderr.log'), logs.stderr),
      ]).catch(() => undefined);
    });
    const context = options.timeout || createTimeoutContext(DEFAULT_GODOT_PROCESS_TIMEOUT_MS);
    const ownsContext = !options.timeout;
    try {
      const socket = await waitForConnection(connection, child, context);
      server.close();
      const bridge = new PersistentRuntimeBridge(sessionId, child, socket, evidenceDir, root);
      bridge.logs = logs;
      await bridge.waitForReady(context);
      await bridge.writeManifest({ persistent: true, pid: child.pid, session_id: sessionId });
      return bridge;
    } catch (error) {
      server.close();
      if (child.pid) await terminateProcessTree(child.pid).catch(() => undefined);
      throw error;
    } finally {
      if (ownsContext) context.dispose();
    }
  }

  async request(method: string, params: Record<string, unknown> = {}, timeout?: TimeoutContext): Promise<unknown> {
    timeout?.throwIfCancelled();
    timeout?.throwIfExpired();
    if (this.closed) throw new Error('persistent bridge is closed');
    const request: JsonRpcRequest = { jsonrpc: '2.0', id: this.nextId++, method, params };
    await appendFile(path.join(this.evidenceDir, 'requests.jsonl'), JSON.stringify(request) + '\n');
    const response = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          if (this.pending.has(request.id)) {
            this.removePending(request.id);
            reject(new TimeoutError(`bridge request timed out: ${method}`));
          }
        },
        Math.max(1, timeout?.remaining() ?? DEFAULT_STOP_TIMEOUT_MS),
      );
      const pending: Pending = { resolve, reject, timer };
      this.pending.set(request.id, pending);
      this.socket.write(JSON.stringify(request) + '\n', (error) => {
        if (error) {
          this.removePending(request.id);
          reject(error);
        }
      });
      if (timeout) {
        const onAbort = () => {
          if (this.pending.has(request.id)) {
            this.removePending(request.id);
            reject(timeout.cancelled ? new CancelledError() : new TimeoutError());
          }
        };
        pending.abortCleanup = () => timeout.signal.removeEventListener('abort', onAbort);
        timeout.signal.addEventListener('abort', onAbort, { once: true });
      }
    });
    await appendFile(
      path.join(this.evidenceDir, 'responses.jsonl'),
      JSON.stringify({ id: request.id, result: response }) + '\n',
    );
    return response;
  }

  getEvents(): JsonRpcNotification[] {
    return [...this.events];
  }

  async waitForEvent(eventName: string, timeout?: TimeoutContext): Promise<JsonRpcNotification> {
    const found = this.events.find((item) => item.method === 'runtime/event' && item.params?.event === eventName);
    if (found) return found;
    return await new Promise<JsonRpcNotification>((resolve, reject) => {
      const listener = (event: JsonRpcNotification) => {
        if (event.method === 'runtime/event' && event.params?.event === eventName) {
          cleanup();
          resolve(event);
        }
      };
      const timer = setTimeout(
        () => {
          cleanup();
          reject(new TimeoutError(`event timed out: ${eventName}`));
        },
        Math.max(1, timeout?.remaining() ?? DEFAULT_STOP_TIMEOUT_MS),
      );
      const cleanup = () => {
        this.readyListeners.delete(listener);
        clearTimeout(timer);
        timeout?.signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(timeout?.cancelled ? new CancelledError() : new TimeoutError());
      };
      this.readyListeners.add(listener);
      timeout?.signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  async stop(timeout?: TimeoutContext): Promise<{ stopped: boolean; pid: number; session_id: string }> {
    if (this.closed) return { stopped: true, pid: this.pid, session_id: this.sessionId };
    if (!this.closePromise) {
      this.closePromise = (async () => {
        try {
          await this.request('stop', {}, timeout);
        } catch {
          if (this.child.pid) await terminateProcessTree(this.child.pid).catch(() => undefined);
        }
        await waitForClose(this.child, timeout);
        this.closed = true;
        this.socket.destroy();
      })();
    }
    await this.closePromise;
    return { stopped: true, pid: this.pid, session_id: this.sessionId };
  }

  private async waitForReady(timeout: TimeoutContext): Promise<void> {
    if (this.events.some((event) => event.method === 'runtime/ready')) return;
    await new Promise<void>((resolve, reject) => {
      const onReady = (event: JsonRpcNotification) => {
        if (event.method === 'runtime/ready') {
          cleanup();
          resolve();
        }
      };
      const cleanup = () => {
        this.readyListeners.delete(onReady);
        clearTimeout(timer);
      };
      this.readyListeners.add(onReady);
      const timer = setTimeout(
        () => {
          cleanup();
          reject(new TimeoutError('persistent bridge did not become ready'));
        },
        Math.max(1, timeout.remaining()),
      );
      timeout.signal.addEventListener(
        'abort',
        () => {
          cleanup();
          reject(timeout.cancelled ? new CancelledError() : new TimeoutError());
        },
        { once: true },
      );
    });
  }

  private readonly readyListeners = new Set<(event: JsonRpcNotification) => void>();

  private onData(data: string): void {
    this.buffer += data;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');
      if (!line) continue;
      let message: JsonRpcResponse | JsonRpcNotification;
      try {
        message = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
      } catch {
        continue;
      }
      if ('id' in message && typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        this.removePending(message.id);
        if ('error' in message && message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else if ('method' in message) {
        this.events.push(message);
        void appendFile(path.join(this.evidenceDir, 'events.jsonl'), JSON.stringify(message) + '\n');
        for (const listener of this.readyListeners) listener(message);
      }
    }
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.removePending(id);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private removePending(id: number): Pending | undefined {
    const pending = this.pending.get(id);
    if (!pending) return undefined;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.abortCleanup?.();
    return pending;
  }

  private async writeManifest(extra: Record<string, unknown>): Promise<void> {
    await writeFile(
      path.join(this.evidenceDir, 'persistent.json'),
      JSON.stringify(
        {
          schema_version: '0.1',
          source: 'REAL',
          ...extra,
          project_path: this.projectPath,
          started_at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }
}

const sessions = new Map<string, PersistentRuntimeBridge>();

export async function openRuntimeBridge(options: PersistentBridgeOptions) {
  const bridge = await PersistentRuntimeBridge.start(options);
  sessions.set(bridge.sessionId, bridge);
  return {
    schema_version: '0.1',
    source: 'REAL',
    capability: 'PERSISTENT_RUNTIME_BRIDGE',
    session_id: bridge.sessionId,
    pid: bridge.pid,
    project_path: bridge.projectPath,
    evidenceDir: bridge.evidenceDir,
  };
}

export function getRuntimeBridge(sessionId: string) {
  const bridge = sessions.get(sessionId);
  if (!bridge) throw new Error(`persistent bridge session not found: ${sessionId}`);
  return bridge;
}

export async function callRuntimeBridge(
  sessionId: string,
  method: string,
  params: Record<string, unknown> = {},
  timeout?: TimeoutContext,
) {
  const bridge = sessions.get(sessionId);
  if (!bridge) throw new Error(`persistent bridge session not found: ${sessionId}`);
  const response = await bridge.request(method, params, timeout);
  return {
    schema_version: '0.1',
    source: 'REAL',
    capability: 'PERSISTENT_RUNTIME_BRIDGE',
    session_id: sessionId,
    method,
    response,
    events: bridge.getEvents(),
  };
}

export async function stopRuntimeBridge(sessionId: string, timeout?: TimeoutContext) {
  const bridge = sessions.get(sessionId);
  if (!bridge)
    return {
      schema_version: '0.1',
      source: 'REAL',
      capability: 'PERSISTENT_RUNTIME_BRIDGE',
      session_id: sessionId,
      stopped: true,
    };
  const result = await bridge.stop(timeout);
  sessions.delete(sessionId);
  return { schema_version: '0.1', source: 'REAL', capability: 'PERSISTENT_RUNTIME_BRIDGE', ...result };
}

async function waitForConnection(
  connection: Promise<net.Socket>,
  child: ChildProcess,
  timeout: TimeoutContext,
): Promise<net.Socket> {
  return await Promise.race([
    connection,
    new Promise<net.Socket>((_, reject) => {
      const timer = setTimeout(
        () => reject(new TimeoutError('persistent bridge connection timed out')),
        Math.max(1, timeout.remaining()),
      );
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        reject(new Error(`persistent bridge exited before connection: ${code}`));
      });
    }),
  ]);
}

async function waitForClose(child: ChildProcess, timeout?: TimeoutContext): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new TimeoutError('persistent bridge did not stop')),
      Math.max(1, timeout?.remaining() ?? DEFAULT_STOP_TIMEOUT_MS),
    );
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    timeout?.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(timeout.cancelled ? new CancelledError() : new TimeoutError());
      },
      { once: true },
    );
  });
}

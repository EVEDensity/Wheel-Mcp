import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { backgroundRenderArguments } from './render-window.js';
import { createTimeoutContext, TimeoutContext, TimeoutError, CancelledError } from './timeout.js';
import { runRegistry } from './run-registry.js';
import { readProcessIdentity, stopIdentifiedProcess, type ProcessIdentity } from './process-identity.js';
import { ensureEvidenceManifest, writeEvidenceJson } from './evidence.js';
import { classifyError } from './error-schema.js';
import { EvidenceLog } from './evidence-log.js';
import { DEFAULT_GODOT_PROCESS_TIMEOUT_MS, DEFAULT_STOP_TIMEOUT_MS } from './timeouts.js';
import { resolveGodotPathSync } from './godot-path.js';
import { validateVariantInput } from './protocol/variant.js';
import { validateCollisionQuery } from './runtime/physics-query.js';
import { validateMouseWheel } from './runtime/mouse-wheel.js';
import { validateCharacterStep } from './runtime/character-step.js';
import { normalizeBridgeRuntimeEvent, type EventCursor, type RuntimeEvent } from './runtime-events.js';
import {
  BridgeProtocolError,
  BridgeRpcError,
  classifyBridgeRpcError,
  validateBridgeHandshake,
  validateBridgeResult,
  type BridgeHandshake,
} from './bridge-protocol.js';

export type PersistentBridgeOptions = {
  godotPath?: string;
  projectPath: string;
  bridgePath: string;
  evidenceDir?: string;
  runId?: string;
  headless?: boolean;
  background?: boolean;
  verbose?: boolean;
  scenePath?: string;
  replaySeed?: number;
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
  method: string;
  params: Record<string, unknown>;
  abortCleanup?: () => void;
};
type OperationRecord = {
  method: string;
  fingerprint: string;
  status: 'PENDING' | 'UNKNOWN' | 'COMPLETED' | 'FAILED';
  promise?: Promise<unknown>;
  result?: Record<string, unknown>;
  error?: Error;
};
export const RUNTIME_WRITE_METHODS = new Set([
  'step_character_2d',
  'set_property',
  'create_node',
  'delete_node',
  'call_method',
  'reload_scene',
  'inject_input',
  'capture_screenshot',
]);
const MAX_EVENT_SEGMENT_BYTES = 8 * 1024 * 1024;
const MAX_EVIDENCE_SEGMENTS = 64;

export class PersistentRuntimeBridge {
  readonly sessionId: string;
  readonly pid: number;
  readonly evidenceDir: string;
  readonly projectPath: string;
  handshake?: BridgeHandshake;
  private readonly child: ChildProcess;
  private readonly socket: net.Socket;
  private readonly processClosed: Promise<void>;
  private readonly pending = new Map<number, Pending>();
  private readonly operations = new Map<string, OperationRecord>();
  private readonly requestOperations = new Map<number, string>();
  private readonly events: JsonRpcNotification[] = [];
  private buffer = '';
  private nextId = 1;
  private closed = false;
  private eventWriteQueue: Promise<void> = Promise.resolve();
  private eventWriteFailure: Error | null = null;
  private eventSegmentBytes: number | null = null;
  private eventSegmentIndex = 0;
  private logDrain: () => Promise<void> = async () => {};

  private async appendRuntimeEvent(event: RuntimeEvent): Promise<void> {
    const line = JSON.stringify(event) + '\n';
    const bytes = Buffer.byteLength(line);
    if (bytes > MAX_EVENT_SEGMENT_BYTES) throw new BridgeProtocolError('runtime event exceeds the segment limit');
    const file = path.join(this.evidenceDir, 'events.jsonl');
    if (this.eventSegmentBytes === null) this.eventSegmentBytes = (await stat(file).catch(() => null))?.size ?? 0;
    if (this.eventSegmentBytes + bytes > MAX_EVENT_SEGMENT_BYTES) {
      if (this.eventSegmentIndex >= MAX_EVIDENCE_SEGMENTS)
        throw new BridgeRpcError('ENGINE_UNAVAILABLE', 'runtime event log quota is exhausted', {
          sessionId: this.sessionId,
        });
      const archived = path.join(
        this.evidenceDir,
        `events.${Date.now()}-${String(this.eventSegmentIndex++).padStart(4, '0')}.jsonl`,
      );
      await rename(file, archived);
      this.eventSegmentBytes = 0;
    }
    await appendFile(file, line);
    this.eventSegmentBytes += bytes;
  }

  async flushLogs(): Promise<void> {
    await Promise.all([this.eventWriteQueue, this.logDrain()]);
    if (this.eventWriteFailure) throw this.eventWriteFailure;
  }
  private closePromise: Promise<void> | null = null;

  private constructor(
    sessionId: string,
    child: ChildProcess,
    socket: net.Socket,
    evidenceDir: string,
    projectPath: string,
    processClosed: Promise<void>,
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
    socket.on('error', (error) => {
      this.closed = true;
      this.failPending(new BridgeRpcError('ENGINE_UNAVAILABLE', error.message, { sessionId }));
    });
    socket.on('close', () => {
      this.closed = true;
      this.failPending(new BridgeRpcError('ENGINE_UNAVAILABLE', 'persistent bridge connection closed', { sessionId }));
    });
    this.processClosed = processClosed;
    void processClosed.then(() => {
      this.closed = true;
      this.failPending(new BridgeRpcError('ENGINE_UNAVAILABLE', 'persistent bridge process exited', { sessionId }));
    });
  }

  static async start(options: PersistentBridgeOptions): Promise<PersistentRuntimeBridge> {
    if (
      options.replaySeed !== undefined &&
      (!Number.isInteger(options.replaySeed) || options.replaySeed < 0 || options.replaySeed > 0xffffffff)
    )
      throw new BridgeProtocolError('replay seed must be a uint32');
    options.timeout?.throwIfCancelled();
    options.timeout?.throwIfExpired();
    const executable = resolveGodotPathSync(options.godotPath);
    const root = path.resolve(options.projectPath);
    const evidenceDir = path.resolve(options.evidenceDir || path.join(root, '.harness', 'persistent-bridge'));
    await mkdir(evidenceDir, { recursive: true });
    const manifest = await ensureEvidenceManifest(evidenceDir, 'BRIDGE_EVIDENCE', {
      request_file: path.join(evidenceDir, 'requests.jsonl'),
      response_file: path.join(evidenceDir, 'responses.jsonl'),
      persistent: true,
    });
    const logs = await EvidenceLog.create(evidenceDir);
    const sessionId = options.runId || `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const processFile = path.join(evidenceDir, 'process.json');
    await writeEvidenceJson(processFile, {
      schema_version: '0.1',
      source: 'REAL',
      run_id: sessionId,
      started: false,
      started_at: manifest.created_at,
      lifecycle: 'STARTING',
      exit_code: null,
      signal: null,
    });
    const server = net.createServer();
    let acceptedSocket: net.Socket | undefined;
    const connection = new Promise<net.Socket>((resolve, reject) => {
      server.on('connection', (socket) => {
        if (acceptedSocket) {
          socket.destroy();
          return;
        }
        acceptedSocket = socket;
        resolve(socket);
      });
      server.once('error', reject);
    });
    // A listen error also rejects connection; mark handled before awaiting listen.
    void connection.catch(() => undefined);
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('unable to allocate bridge port');
    const godotLogFile = path.join(evidenceDir, 'godot.log');
    await mkdir(path.dirname(godotLogFile), { recursive: true });
    const child = spawn(
      executable,
      [
        ...(options.headless === true ? ['--headless'] : backgroundRenderArguments(options.background === true)),
        ...(options.verbose ? ['--verbose'] : []),
        '--path',
        root,
        '--log-file',
        godotLogFile,
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
          GODOT_HARNESS_BACKGROUND_RENDER: options.headless !== true && options.background === true ? '1' : '0',
          GODOT_HARNESS_MAIN_SCENE: options.scenePath || '',
          GODOT_HARNESS_PORT: String(address.port),
          GODOT_HARNESS_REPLAY_SEED: options.replaySeed === undefined ? '' : String(options.replaySeed),
        },
      },
    );
    let spawnError: Error | undefined;
    let startupError: unknown;
    let evidenceFailure: Error | undefined;
    child.on('error', (error) => {
      spawnError = error;
      logs.append('stderr', error.message + '\n');
    });
    const logFailure = (error: Error) => {
      evidenceFailure ??= error;
      child.kill();
    };
    if (child.stdout) logs.attach(child.stdout, 'stdout', logFailure);
    if (child.stderr) logs.attach(child.stderr, 'stderr', logFailure);
    let registered = false;
    let spawnedIdentity: ProcessIdentity | null = null;
    let activeBridge: PersistentRuntimeBridge | undefined;
    const context = options.timeout || createTimeoutContext(DEFAULT_GODOT_PROCESS_TIMEOUT_MS);
    const ownsContext = !options.timeout;
    const processClosed = new Promise<void>((resolve) =>
      child.once('close', (code, signal) => {
        void (async () => {
          try {
            await logs.drain();
            if (activeBridge) await activeBridge.eventWriteQueue;
            if (activeBridge?.eventWriteFailure) throw activeBridge.eventWriteFailure;
          } catch (error) {
            evidenceFailure ??= error instanceof Error ? error : new Error(String(error));
          }
          try {
            const current = registered ? runRegistry.get(sessionId) : null;
            const lifecycle =
              context.timedOut || startupError instanceof TimeoutError
                ? 'TIMEOUT'
                : context.cancelled ||
                    startupError instanceof CancelledError ||
                    current?.state === 'CANCELLING' ||
                    current?.state === 'CANCELLED'
                  ? 'CANCELLED'
                  : current?.state === 'STOPPING' || current?.state === 'STOPPED'
                    ? 'STOPPED'
                    : startupError || spawnError || code !== 0
                      ? 'FAILED'
                      : 'EXITED';
            if (current) runRegistry.markTerminal(sessionId, lifecycle, code);
            const finished = new Date().toISOString();
            const metadata = {
              schema_version: '0.1',
              source: 'REAL',
              run_id: sessionId,
              pid: child.pid ?? null,
              project_path: root,
              executable,
              arguments: child.spawnargs.slice(1),
              ...(spawnedIdentity ? { process_identity: spawnedIdentity } : {}),
              started: !spawnError,
              started_at: manifest.created_at,
              finished_at: finished,
              exit_code: code,
              signal,
              lifecycle,
              timed_out: lifecycle === 'TIMEOUT',
              cancelled: lifecycle === 'CANCELLED',
              stdout: manifest.stdout_file,
              stderr: manifest.stderr_file,
              evidence_status: evidenceFailure ? 'INCOMPLETE' : 'COMPLETE',
              ...(evidenceFailure ? { evidence_error: evidenceFailure.message } : {}),
            };
            await writeEvidenceJson(processFile, metadata);
            const artifacts: Record<string, unknown> = {};
            for (const name of [
              'process.json',
              'stdout.log',
              'stderr.log',
              'requests.jsonl',
              'responses.jsonl',
              'events.jsonl',
            ])
              artifacts[name] = {
                path: path.join(evidenceDir, name),
                status: (await stat(path.join(evidenceDir, name)).catch(() => null)) ? 'GENERATED' : 'NOT_GENERATED',
              };
            await writeEvidenceJson(path.join(evidenceDir, 'manifest.json'), {
              ...manifest,
              finished_at: finished,
              lifecycle,
              evidence_status: metadata.evidence_status,
              artifacts,
            });
          } catch (error) {
            evidenceFailure ??= error instanceof Error ? error : new Error(String(error));
          }
        })().finally(resolve);
      }),
    );
    let socket: net.Socket | undefined;
    try {
      if (!child.pid) {
        await new Promise<never>((_, reject) => child.once('error', reject));
        throw new BridgeRpcError('ENGINE_UNAVAILABLE', 'persistent bridge process has no pid', { sessionId });
      }
      runRegistry.register({ kind: 'bridge', runId: sessionId, pid: child.pid, projectPath: root, evidenceDir });
      registered = true;
      spawnedIdentity = await readProcessIdentity(child.pid);
      if (!spawnedIdentity)
        throw new BridgeRpcError('ENGINE_UNAVAILABLE', 'persistent bridge process identity is unavailable', {
          sessionId,
        });
      runRegistry.attachIdentity(sessionId, spawnedIdentity);
      socket = await waitForConnection(connection, child, context);
      server.close();
      const bridge = new PersistentRuntimeBridge(sessionId, child, socket, evidenceDir, root, processClosed);
      activeBridge = bridge;
      bridge.logDrain = async () => {
        await logs.drain();
        if (evidenceFailure) throw evidenceFailure;
      };
      await bridge.waitForReady(context);
      if (options.headless !== true && options.background === true) {
        const window = bridge.handshake?.runtimeConditions?.window;
        if (!window?.background || window.mode !== 1 || window.unfocusable !== true)
          throw new BridgeProtocolError('bridge did not confirm minimized, unfocusable background rendering');
      }
      await writeEvidenceJson(path.join(evidenceDir, 'startup.json'), {
        schema_version: '0.1',
        source: 'REAL',
        status: 'PASS',
        sessionId,
        handshake: bridge.handshake,
        finishedAt: new Date().toISOString(),
      });
      await bridge.writeManifest({ persistent: true, pid: child.pid, session_id: sessionId });
      return bridge;
    } catch (error) {
      startupError = error;
      await writeEvidenceJson(path.join(evidenceDir, 'startup.json'), {
        ...classifyError(error),
        sessionId,
        finishedAt: new Date().toISOString(),
      }).catch((failure) => {
        evidenceFailure ??= failure instanceof Error ? failure : new Error(String(failure));
      });
      server.close();
      acceptedSocket?.destroy();
      if (child.pid) {
        const identity = spawnedIdentity ?? (await readProcessIdentity(child.pid));
        if (identity) await stopIdentifiedProcess(child.pid, identity).catch(() => undefined);
        else child.kill();
      }
      try {
        await waitForDrain(processClosed);
      } finally {
        await logs.drain().catch((error) => {
          evidenceFailure ??= error instanceof Error ? error : new Error(String(error));
        });
      }
      if (evidenceFailure)
        throw new BridgeRpcError('ENGINE_UNAVAILABLE', 'Bridge startup failed and evidence is incomplete', {
          sessionId,
          evidenceDir,
          cause: error instanceof Error ? error.message : String(error),
          evidenceError: evidenceFailure.message,
        });
      throw error;
    } finally {
      if (ownsContext) context.dispose();
    }
  }

  async request(
    method: string,
    params: Record<string, unknown> = {},
    timeout?: TimeoutContext,
    operationId?: string,
  ): Promise<unknown> {
    timeout?.throwIfCancelled();
    timeout?.throwIfExpired();
    if (this.closed)
      throw new BridgeRpcError('ENGINE_UNAVAILABLE', 'persistent bridge is closed', { sessionId: this.sessionId });
    if (!this.handshake?.capabilities.includes(method))
      throw new BridgeRpcError('UNSUPPORTED', `bridge did not announce ${method}`, {
        sessionId: this.sessionId,
        method,
      });
    if (method === 'set_property' && Object.hasOwn(params, 'value')) validateVariantInput(params.value);
    if (method === 'step_character_2d') {
      params = validateCharacterStep(params);
      if (!this.handshake?.capabilities.includes('character.step2d/v1'))
        throw new BridgeRpcError('UNSUPPORTED', 'Runtime does not advertise character.step2d/v1', {
          sessionId: this.sessionId,
        });
    }
    if (method === 'inject_input' && params.type === 'mouse_wheel') {
      params = validateMouseWheel(params);
      if (!this.handshake?.capabilities.includes('input.mouse_wheel/v1'))
        throw new BridgeRpcError('UNSUPPORTED', 'Runtime does not advertise input.mouse_wheel/v1', {
          sessionId: this.sessionId,
        });
    }
    if (method === 'create_node' && Object.hasOwn(params, 'properties'))
      validateVariantInput(params.properties, 'properties');
    if (method === 'call_method' && Object.hasOwn(params, 'args')) validateVariantInput(params.args, 'args');
    if (!RUNTIME_WRITE_METHODS.has(method)) return this.dispatch(method, params, timeout);
    const id = operationId ?? randomUUID();
    if (id.length < 1 || id.length > 128)
      throw new BridgeRpcError('INVALID_ARGUMENT', 'operationId must contain 1–128 characters', {
        sessionId: this.sessionId,
      });
    const fingerprint = JSON.stringify({ method, params });
    const previous = this.operations.get(id);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new BridgeRpcError('CONFLICT', 'operationId was already used for different request content', {
          sessionId: this.sessionId,
          operationId: id,
        });
      if (previous.status === 'COMPLETED') return previous.result;
      if (previous.status === 'FAILED') throw previous.error;
      if (previous.status === 'UNKNOWN')
        throw new BridgeRpcError('UNKNOWN', 'write outcome is not yet known; query operation status', {
          sessionId: this.sessionId,
          operationId: id,
        });
      return previous.promise;
    }
    if (this.operations.size >= 4096)
      throw new BridgeRpcError('CONFLICT', 'operation status quota is exhausted for this session', {
        sessionId: this.sessionId,
      });
    const operation: OperationRecord = { method, fingerprint, status: 'PENDING' };
    this.operations.set(id, operation);
    const promise = this.dispatch(method, params, timeout, id)
      .then((result) => {
        operation.status = 'COMPLETED';
        operation.result = result as Record<string, unknown>;
        return result;
      })
      .catch((error: unknown) => {
        const cause = error instanceof Error ? error : new Error(String(error));
        if (cause instanceof TimeoutError || cause instanceof CancelledError) {
          if (operation.status === 'PENDING') operation.status = 'UNKNOWN';
          operation.error = cause;
          throw new BridgeRpcError('UNKNOWN', 'write outcome is not yet known; query operation status', {
            sessionId: this.sessionId,
            operationId: id,
            reason: cause.name,
          });
        }
        operation.status = 'FAILED';
        operation.error = cause;
        throw cause;
      });
    operation.promise = promise;
    return promise;
  }

  getOperationStatus(operationId: string): Record<string, unknown> {
    const operation = this.operations.get(operationId);
    if (!operation)
      throw new BridgeRpcError('NOT_FOUND', `operation not found: ${operationId}`, {
        sessionId: this.sessionId,
        operationId,
      });
    return {
      schema_version: '0.1',
      source: 'REAL',
      capability: 'RUNTIME_OPERATION_STATUS',
      session_id: this.sessionId,
      operation_id: operationId,
      method: operation.method,
      status: operation.status,
      ...(operation.status === 'COMPLETED' ? { result: operation.result } : {}),
      ...(operation.status === 'FAILED'
        ? {
            error: {
              code: (operation.error as { code?: string })?.code ?? 'FAILED',
              message: operation.error?.message,
            },
          }
        : {}),
    };
  }

  private async dispatch(
    method: string,
    params: Record<string, unknown>,
    timeout?: TimeoutContext,
    operationId?: string,
  ): Promise<unknown> {
    const request: JsonRpcRequest = { jsonrpc: '2.0', id: this.nextId++, method, params };
    if (operationId) this.requestOperations.set(request.id, operationId);
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
      const pending: Pending = { resolve, reject, timer, method, params };
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
        if (timeout.signal.aborted) onAbort();
      }
    });
    await appendFile(
      path.join(this.evidenceDir, 'responses.jsonl'),
      JSON.stringify({ id: request.id, result: response }) + '\n',
    );
    return validateBridgeResult(method, response);
  }

  getEvents(): JsonRpcNotification[] {
    return [...this.events];
  }

  async waitForEvent(
    eventName: string,
    timeout?: TimeoutContext,
    options: { cursor?: number | EventCursor; includeHistory?: boolean } = {},
  ): Promise<JsonRpcNotification> {
    timeout?.throwIfCancelled();
    timeout?.throwIfExpired();
    if (typeof options.cursor === 'object' && options.cursor.run_id !== this.sessionId)
      throw new BridgeRpcError('CONFLICT', 'event cursor belongs to another run', { sessionId: this.sessionId });
    const sequence =
      typeof options.cursor === 'number'
        ? options.cursor
        : (options.cursor?.sequence ??
          (options.includeHistory
            ? 0
            : Number(this.events.filter((item) => item.method === 'runtime/event').at(-1)?.params?.sequence ?? 0)));
    if (!Number.isSafeInteger(sequence) || sequence < 0)
      throw new BridgeRpcError('INVALID_ARGUMENT', 'event cursor must be a non-negative safe integer', {});
    const matches = (item: JsonRpcNotification) =>
      item.method === 'runtime/event' && item.params?.event === eventName && Number(item.params.sequence) > sequence;
    const found = this.events.find(matches);
    if (found) return found;
    return await new Promise<JsonRpcNotification>((resolve, reject) => {
      const listener = (event: JsonRpcNotification) => {
        if (matches(event)) {
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
      if (timeout?.signal.aborted) onAbort();
    });
  }

  private forcedStop = false;
  async stop(timeout?: TimeoutContext): Promise<{
    stopped: boolean;
    pid: number;
    session_id: string;
    forced: boolean;
    exitCode: number | null;
    signal: string | null;
  }> {
    if (!this.closePromise) {
      this.closePromise = (async () => {
        try {
          if (this.child.exitCode === null && this.child.signalCode === null) {
            runRegistry.beginBridgeStop(this.sessionId);
            await this.request('stop', {}, timeout);
            await waitForClose(this.child, timeout);
          }
        } catch {
          this.forcedStop = true;
          const identity = runRegistry.get(this.sessionId)?.processIdentity;
          if (!identity)
            throw new BridgeRpcError('CONFLICT', 'bridge process identity is unavailable; forced stop is unsafe', {
              sessionId: this.sessionId,
            });
          const result = await stopIdentifiedProcess(this.pid, identity);
          if (result !== 'STOPPED' && result !== 'NOT_FOUND')
            throw new BridgeRpcError('CONFLICT', `verified bridge stop failed: ${result}`, {
              sessionId: this.sessionId,
            });
          const cleanup = createTimeoutContext(DEFAULT_STOP_TIMEOUT_MS);
          try {
            await waitForClose(this.child, cleanup);
          } finally {
            cleanup.dispose();
          }
        } finally {
          try {
            // close, not merely exit: retain final stderr but never hang forever.
            await drainAfterExit(this.child, this.processClosed);
          } finally {
            this.closed = true;
            this.socket.destroy();
            await this.flushLogs();
          }
        }
      })();
    }
    await this.closePromise;
    return {
      stopped: true,
      pid: this.pid,
      session_id: this.sessionId,
      forced: this.forcedStop,
      exitCode: this.child.exitCode,
      signal: this.child.signalCode,
    };
  }

  private async waitForReady(timeout: TimeoutContext): Promise<void> {
    timeout.throwIfCancelled();
    timeout.throwIfExpired();
    const existing = this.events.find((event) => event.method === 'runtime/ready');
    if (existing) {
      this.handshake = validateBridgeHandshake(existing.params, {
        projectPath: this.projectPath,
        runId: this.sessionId,
      });
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onReady = (event: JsonRpcNotification) => {
        if (event.method === 'runtime/ready') {
          cleanup();
          try {
            this.handshake = validateBridgeHandshake(event.params, {
              projectPath: this.projectPath,
              runId: this.sessionId,
            });
            resolve();
          } catch (error) {
            reject(error);
          }
        }
      };
      const cleanup = () => {
        this.readyListeners.delete(onReady);
        clearTimeout(timer);
        timeout.signal.removeEventListener('abort', onAbort);
      };
      this.readyListeners.add(onReady);
      const timer = setTimeout(
        () => {
          cleanup();
          reject(new TimeoutError('persistent bridge did not become ready'));
        },
        Math.max(1, timeout.remaining()),
      );
      const onAbort = () => {
        cleanup();
        reject(timeout.cancelled ? new CancelledError() : new TimeoutError());
      };
      timeout.signal.addEventListener('abort', onAbort, { once: true });
      if (timeout.signal.aborted) onAbort();
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
        this.failPending(new BridgeProtocolError('bridge emitted invalid JSON'));
        continue;
      }
      if (!message || typeof message !== 'object') {
        this.failPending(new BridgeProtocolError('bridge emitted a non-object message'));
        continue;
      }
      if ('id' in message && typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        const operationId = this.requestOperations.get(message.id);
        if (operationId) this.requestOperations.delete(message.id);
        if (!pending) {
          const operation = operationId ? this.operations.get(operationId) : undefined;
          if (operation && (operation.status === 'UNKNOWN' || operation.status === 'PENDING')) {
            this.eventWriteQueue = this.eventWriteQueue
              .then(() =>
                appendFile(
                  path.join(this.evidenceDir, 'responses.jsonl'),
                  JSON.stringify({ id: message.id, operation_id: operationId, late: true, response: message }) + '\n',
                ),
              )
              .catch((error: unknown) => {
                this.eventWriteFailure = error instanceof Error ? error : new Error(String(error));
              });
            if (message.jsonrpc !== '2.0' || 'result' in message === 'error' in message) {
              operation.status = 'FAILED';
              operation.error = new BridgeProtocolError('late bridge response envelope is invalid');
            } else if ('error' in message) {
              operation.status = 'FAILED';
              operation.error = new BridgeRpcError('INTERNAL_ERROR', message.error?.message ?? 'late bridge error', {
                sessionId: this.sessionId,
                operationId,
              });
            } else {
              try {
                operation.result = validateBridgeResult(operation.method, message.result);
                operation.status = 'COMPLETED';
              } catch (error) {
                operation.status = 'FAILED';
                operation.error = error instanceof Error ? error : new Error(String(error));
              }
            }
          }
          continue;
        }
        this.removePending(message.id);
        if (message.jsonrpc !== '2.0' || 'result' in message === 'error' in message) {
          pending.reject(new BridgeProtocolError('bridge response envelope is invalid', { method: pending.method }));
        } else if ('error' in message) {
          const rpcError = message.error;
          if (!rpcError || typeof rpcError.code !== 'number' || typeof rpcError.message !== 'string')
            pending.reject(new BridgeProtocolError('bridge RPC error is malformed', { method: pending.method }));
          else
            pending.reject(
              classifyBridgeRpcError(
                { code: rpcError.code as number, message: rpcError.message, data: rpcError.data },
                {
                  sessionId: this.sessionId,
                  method: pending.method,
                  params: pending.params,
                },
              ),
            );
        } else pending.resolve(message.result);
      } else if ('method' in message) {
        if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
          this.failPending(new BridgeProtocolError('bridge notification envelope is invalid'));
          continue;
        }
        if (message.method === 'runtime/event') {
          const event = normalizeBridgeRuntimeEvent(message, this.sessionId);
          if (!event) {
            this.failPending(new BridgeProtocolError('bridge runtime event envelope is invalid'));
            continue;
          }
          this.eventWriteQueue = this.eventWriteQueue
            .then(() => this.appendRuntimeEvent(event))
            .catch((error: unknown) => {
              this.eventWriteFailure = error instanceof Error ? error : new Error(String(error));
              this.closed = true;
              this.failPending(this.eventWriteFailure);
              this.socket.destroy();
            });
        }
        this.events.push(message);
        if (this.events.length > 1024) this.events.splice(0, this.events.length - 1024);
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
    await writeEvidenceJson(path.join(this.evidenceDir, 'persistent.json'), {
      schema_version: '0.1',
      source: 'REAL',
      ...extra,
      project_path: this.projectPath,
      started_at: new Date().toISOString(),
    });
  }
}

const sessions = new Map<string, PersistentRuntimeBridge>();
const openingSessions = new Set<string>();
const stoppedSessions = new Map<string, Awaited<ReturnType<PersistentRuntimeBridge['stop']>>>();

export async function openRuntimeBridge(options: PersistentBridgeOptions) {
  const sessionId = options.runId || `bridge-${randomUUID()}`;
  if (sessions.has(sessionId) || openingSessions.has(sessionId) || stoppedSessions.has(sessionId))
    throw new BridgeRpcError('CONFLICT', `persistent bridge session already exists: ${sessionId}`, { sessionId });
  openingSessions.add(sessionId);
  try {
    const bridge = await PersistentRuntimeBridge.start({ ...options, runId: sessionId });
    sessions.set(bridge.sessionId, bridge);
    return {
      schema_version: '0.1',
      source: 'REAL',
      capability: 'PERSISTENT_RUNTIME_BRIDGE',
      session_id: bridge.sessionId,
      pid: bridge.pid,
      project_path: bridge.projectPath,
      evidenceDir: bridge.evidenceDir,
      handshake: bridge.handshake,
    };
  } finally {
    openingSessions.delete(sessionId);
  }
}

export function getRuntimeBridge(sessionId: string) {
  const bridge = sessions.get(sessionId);
  if (!bridge)
    throw new BridgeRpcError('NOT_FOUND', `persistent bridge session not found: ${sessionId}`, { sessionId });
  return bridge;
}

export async function callRuntimeBridge(
  sessionId: string,
  method: string,
  params: Record<string, unknown> = {},
  timeout?: TimeoutContext,
  operationId?: string,
) {
  const bridge = sessions.get(sessionId);
  if (!bridge)
    throw new BridgeRpcError('NOT_FOUND', `persistent bridge session not found: ${sessionId}`, { sessionId });
  const id = RUNTIME_WRITE_METHODS.has(method) ? (operationId ?? randomUUID()) : undefined;
  if (operationId && !id)
    throw new BridgeRpcError('INVALID_ARGUMENT', 'operationId is only valid for a write method', {
      sessionId,
      method,
    });
  if (method === 'query_collisions') {
    params = validateCollisionQuery(params);
    if (
      Object.keys(params).some((key) => !['nodePath', 'historyLimit', 'refresh'].includes(key)) &&
      !bridge.handshake?.capabilities.includes('physics3d/v1')
    ) {
      throw new BridgeRpcError('UNSUPPORTED', 'Runtime does not advertise physics3d/v1', { sessionId });
    }
  }
  if (
    method === 'wait_physics_frames' &&
    (Object.keys(params).some((key) => key !== 'frames') ||
      (params.frames !== undefined &&
        (!Number.isInteger(params.frames) || Number(params.frames) < 1 || Number(params.frames) > 120)))
  ) {
    throw new BridgeRpcError('INVALID_ARGUMENT', 'frames must be an integer in 1..120', { sessionId });
  }
  const response = await bridge.request(method, params, timeout, id);
  await bridge.flushLogs();
  return {
    schema_version: '0.1',
    source: 'REAL',
    capability: 'PERSISTENT_RUNTIME_BRIDGE',
    session_id: sessionId,
    method,
    ...(id ? { operation_id: id } : {}),
    response,
    events: bridge.getEvents(),
  };
}

export async function getRuntimeOperationStatus(sessionId: string, operationId: string) {
  const bridge = getRuntimeBridge(sessionId);
  await bridge.flushLogs();
  return bridge.getOperationStatus(operationId);
}

export async function stopRuntimeBridge(sessionId: string, timeout?: TimeoutContext) {
  const bridge = sessions.get(sessionId);
  if (!bridge) {
    const previous = stoppedSessions.get(sessionId);
    if (!previous)
      throw new BridgeRpcError('NOT_FOUND', `persistent bridge session not found: ${sessionId}`, { sessionId });
    return { schema_version: '0.1', source: 'REAL', capability: 'PERSISTENT_RUNTIME_BRIDGE', ...previous };
  }
  const previousState = runRegistry.beginBridgeStop(sessionId);
  let result: Awaited<ReturnType<PersistentRuntimeBridge['stop']>>;
  try {
    result = await bridge.stop(timeout);
  } catch (error) {
    runRegistry.abortBridgeStop(sessionId, previousState);
    throw error;
  }
  runRegistry.markTerminal(sessionId, 'STOPPED', result.exitCode);
  sessions.delete(sessionId);
  stoppedSessions.set(sessionId, result);
  if (stoppedSessions.size > 1024) stoppedSessions.delete(stoppedSessions.keys().next().value!);
  return { schema_version: '0.1', source: 'REAL', capability: 'PERSISTENT_RUNTIME_BRIDGE', ...result };
}

async function waitForConnection(
  connection: Promise<net.Socket>,
  child: ChildProcess,
  timeout: TimeoutContext,
): Promise<net.Socket> {
  timeout.throwIfCancelled();
  timeout.throwIfExpired();
  return new Promise<net.Socket>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('error', onError);
      child.removeListener('close', onClose);
      timeout.signal.removeEventListener('abort', onAbort);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(
        error instanceof TimeoutError || error instanceof CancelledError || error instanceof BridgeRpcError
          ? error
          : new BridgeRpcError('ENGINE_UNAVAILABLE', error.message, {
              cause: (error as NodeJS.ErrnoException).code ?? null,
            }),
      );
    };
    const onClose = (code: number | null) =>
      onError(
        new BridgeRpcError('ENGINE_UNAVAILABLE', 'persistent bridge exited before connection', { exitCode: code }),
      );
    const onAbort = () => onError(timeout.cancelled ? new CancelledError() : new TimeoutError());
    const timer = setTimeout(
      () => onError(new TimeoutError('persistent bridge connection timed out')),
      Math.max(1, timeout.remaining()),
    );
    child.once('error', onError);
    child.once('close', onClose);
    timeout.signal.addEventListener('abort', onAbort, { once: true });
    connection.then((socket) => {
      cleanup();
      resolve(socket);
    }, onError);
    if (timeout.signal.aborted) onAbort();
  });
}

async function waitForClose(child: ChildProcess, timeout?: TimeoutContext): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  timeout?.throwIfCancelled();
  timeout?.throwIfExpired();
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('close', onClose);
      timeout?.signal.removeEventListener('abort', onAbort);
    };
    const onClose = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(timeout?.cancelled ? new CancelledError() : new TimeoutError());
    };
    const timer = setTimeout(
      () => {
        cleanup();
        reject(new TimeoutError('persistent bridge did not stop'));
      },
      Math.max(1, timeout?.remaining() ?? DEFAULT_STOP_TIMEOUT_MS),
    );
    child.once('close', onClose);
    timeout?.signal.addEventListener('abort', onAbort, { once: true });
    if (timeout?.signal.aborted) onAbort();
  });
}

/** Bound final pipe drainage independently of an already cancelled request. */
async function waitForDrain(closed: Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      closed,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new TimeoutError('persistent bridge output did not close')),
          DEFAULT_STOP_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function drainAfterExit(child: ChildProcess, closed: Promise<void>): Promise<void> {
  try {
    await waitForDrain(closed);
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) throw error;
    // A descendant may inherit Godot's output pipes after Godot exits.
    // The bounded drain has elapsed; close our read handles to finish shutdown.
    child.stdout?.destroy();
    child.stderr?.destroy();
    await waitForDrain(closed);
  }
}

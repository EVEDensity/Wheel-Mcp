import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { z } from 'zod';
import { WheelError, isStableErrorCode } from '../error-schema.js';

export const EDITOR_PROTOCOL = 'wheel-editor/1';
const MAX_FRAME = 64 * 1024;
const identitySchema = z.object({
  protocolVersion: z.literal(EDITOR_PROTOCOL),
  plane: z.literal('editor'),
  projectId: z.string().min(1).max(80),
  projectPath: z.string().min(1),
  sessionId: z.string().regex(/^[a-f0-9]{32}$/),
  godotVersion: z.string().min(1),
  editorPid: z.number().int().positive(),
  port: z.number().int().min(1).max(65535),
  // Bounded native UI/texture extensions; frames and private files
  // retain their existing byte limits. Older clients need a coordinated upgrade.
  capabilities: z.array(z.string()).max(28),
  authorized: z.literal(true),
});
type EditorIdentity = z.infer<typeof identitySchema>;
const nodeSchema = z.object({
  name: z.string(),
  type: z.string(),
  path: z.string(),
  parent: z.string().nullable(),
  owner: z.string().nullable(),
});
export const editorStateSchema = z.object({
  schema_version: z.literal('0.1'),
  source: z.literal('REAL'),
  status: z.literal('PASS'),
  capability: z.literal('EDITOR_STATE'),
  plane: z.literal('editor'),
  runtime: z.literal(false),
  sessionId: z.string(),
  projectId: z.string(),
  projectPath: z.string(),
  currentScene: z.object({ name: z.string(), type: z.string(), path: z.string() }).nullable(),
  dirty: z.object({
    status: z.literal('KNOWN'),
    scenes: z.array(z.string()).max(100),
    scriptsStatus: z.enum(['KNOWN', 'UNKNOWN']).optional(),
    scripts: z.array(z.string()).max(100).optional(),
    nativeSaveConflicts: z.array(z.string()).max(32).optional(),
  }),
  selection: z.array(z.object({ path: z.string(), type: z.string() })).max(100),
  sceneTree: z.object({ nodes: z.array(nodeSchema).max(100), truncated: z.boolean() }),
  filesystem: z.object({ scanning: z.boolean(), importing: z.boolean(), progress: z.number().min(0).max(1) }),
  mainThread: z.literal(true),
  persisted: z.literal(false),
  validation: z.literal('NOT_RUN'),
});
export type EditorState = z.infer<typeof editorStateSchema>;
const configSchema = z.object({
  schemaVersion: z.literal(1),
  enabled: z.boolean(),
  authorized: z.boolean(),
  protocolVersion: z.literal(EDITOR_PROTOCOL),
  projectId: z.string().min(1).max(80),
  projectPath: z.string().min(1),
  port: z.number().int().min(0).max(65535),
  clients: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
  writeClients: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).optional(),
});
function samePath(a: string, b: string): boolean {
  const normalize = (p: string) => {
    const v = path.resolve(p);
    return process.platform === 'win32' ? v.toLowerCase() : v;
  };
  return normalize(a) === normalize(b);
}
function unavailable() {
  return new WheelError('ENGINE_UNAVAILABLE', 'No authorized enabled Wheel-mcp editor endpoint');
}
function abortCode(signal?: AbortSignal): 'TIMEOUT' | 'CANCELLED' {
  return signal?.reason?.code === 'TIMEOUT' || signal?.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED';
}
/** Private connector metadata is never reachable through generic project file tools. */
async function privateJson(root: string, name: string): Promise<unknown> {
  const directory = path.join(root, '.harness');
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new WheelError('FORBIDDEN', 'Unsafe editor metadata directory');
  const file = path.join(directory, name);
  const entry = await lstat(file);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || entry.size > 8192)
    throw new WheelError('FORBIDDEN', 'Unsafe editor metadata file');
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw new WheelError('PROTOCOL_MISMATCH', 'Malformed editor metadata');
  }
}
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; dispose: () => void };

/** Connects only to an already-enabled editor. It never installs, enables or launches Godot. */
export class EditorBridge {
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<string, Pending>();
  private closed = false;
  private constructor(
    private readonly socket: net.Socket,
    readonly identity: EditorIdentity,
    private readonly writeAuthority?: string,
  ) {
    socket.on('data', (bytes: Buffer) => this.receive(bytes));
    socket.on('error', () => this.fail(unavailable()));
    socket.on('close', () => this.fail(unavailable()));
  }
  static async connect(options: {
    projectPath: string;
    ownerId: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<EditorBridge> {
    if (options.signal?.aborted) throw new WheelError(abortCode(options.signal), 'Editor connection aborted');
    const limit = options.timeoutMs ?? 5000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 120000)
      throw new WheelError('INVALID_ARGUMENT', 'Editor timeout must be 1..120000 ms');
    const root = await realpath(options.projectPath);
    let config: z.infer<typeof configSchema>;
    let endpoint: EditorIdentity;
    try {
      config = configSchema.parse(await privateJson(root, 'editor-bridge.json'));
      if (!config.enabled) throw unavailable();
      if (!config.authorized) throw new WheelError('FORBIDDEN', 'Editor connector authorization is disabled');
      endpoint = identitySchema.parse(await privateJson(root, 'editor-endpoint.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw unavailable();
      if (error instanceof z.ZodError) throw new WheelError('PROTOCOL_MISMATCH', 'Invalid editor metadata contract');
      throw error;
    }
    if (
      !samePath(config.projectPath, root) ||
      !samePath(endpoint.projectPath, root) ||
      config.projectId !== endpoint.projectId
    )
      throw new WheelError('FORBIDDEN', 'Editor project identity mismatch');
    const token = Object.hasOwn(config.clients, options.ownerId) ? config.clients[options.ownerId] : undefined;
    if (!token) throw new WheelError('FORBIDDEN', 'Client has no editor connector authorization');
    if (config.port !== 0 && config.port !== endpoint.port)
      throw new WheelError('PROTOCOL_MISMATCH', 'Editor port mismatch');
    if (!/^4\.7\.2(?:-stable(?: \(official\))?$|\.stable(?:\.|$))/.test(endpoint.godotVersion))
      throw new WheelError('UNSUPPORTED', 'Editor plane is verified only for Godot 4.7.2');
    const socket = new net.Socket();
    const authority =
      config.writeClients && Object.hasOwn(config.writeClients, options.ownerId)
        ? config.writeClients[options.ownerId]
        : undefined;
    if (authority === token) throw new WheelError('FORBIDDEN', 'Editor read/write authorities must be independent');
    const bridge = new EditorBridge(socket, endpoint, authority);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(new WheelError('TIMEOUT', 'Editor connection timed out')), limit);
        const onAbort = () => finish(new WheelError(abortCode(options.signal), 'Editor connection aborted'));
        const onError = () => finish(unavailable());
        const onConnect = () => finish();
        const finish = (error?: Error) => {
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', onAbort);
          socket.removeListener('error', onError);
          socket.removeListener('connect', onConnect);
          if (error) reject(error);
          else resolve();
        };
        options.signal?.addEventListener('abort', onAbort, { once: true });
        socket.once('error', onError);
        socket.once('connect', onConnect);
        socket.connect(endpoint.port, '127.0.0.1');
        if (options.signal?.aborted) onAbort();
      });
      const reply = identitySchema.safeParse(
        await bridge.request(
          'editor.hello',
          {
            protocolVersion: EDITOR_PROTOCOL,
            plane: 'editor',
            projectPath: root.replaceAll('\\', '/'),
            projectId: config.projectId,
            sessionId: endpoint.sessionId,
            clientId: options.ownerId,
            token,
          },
          limit,
          options.signal,
        ),
      );
      if (
        !reply.success ||
        !samePath(reply.data.projectPath, root) ||
        ['sessionId', 'projectId', 'godotVersion', 'editorPid', 'port'].some(
          (key) => reply.data[key as keyof EditorIdentity] !== endpoint[key as keyof EditorIdentity],
        ) ||
        !reply.data.capabilities.includes('get_editor_state')
      )
        throw new WheelError('PROTOCOL_MISMATCH', 'Editor handshake response identity/capabilities mismatch');
      return bridge;
    } catch (error) {
      bridge.close();
      throw error;
    }
  }
  async snapshot(options: { limit?: number; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<EditorState> {
    const parsed = editorStateSchema.safeParse(
      await this.request(
        'get_editor_state',
        { limit: options.limit ?? 100 },
        options.timeoutMs ?? 5000,
        options.signal,
      ),
    );
    if (
      !parsed.success ||
      parsed.data.sessionId !== this.identity.sessionId ||
      parsed.data.projectId !== this.identity.projectId ||
      !samePath(parsed.data.projectPath, this.identity.projectPath)
    )
      throw new WheelError('PROTOCOL_MISMATCH', 'Editor state contract or identity mismatch');
    return parsed.data;
  }
  /** Fixed authoring methods only; never exposes connector credentials to MCP responses. */
  sceneRequest(
    method:
      | 'scene.prepare'
      | 'scene.commit'
      | 'scene.discard'
      | 'scene.status'
      | 'resource.manage'
      | 'scene.export'
      | 'scene.verify'
      | 'scene.notify'
      | 'scene.observe'
      | 'asset.scan'
      | 'asset.status',
    params: Record<string, unknown>,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<unknown> {
    if (!this.writeAuthority)
      return Promise.reject(
        new WheelError('FORBIDDEN', 'Editor authoring requires independent per-client write opt-in'),
      );
    if (!this.identity.capabilities.includes(method))
      return Promise.reject(new WheelError('UNSUPPORTED', 'Editor did not announce this authoring capability'));
    return this.request(
      method,
      { ...params, sessionId: this.identity.sessionId, authority: this.writeAuthority },
      options.timeoutMs ?? 5000,
      options.signal,
    );
  }
  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(unavailable());
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
      return Promise.reject(new WheelError('INVALID_ARGUMENT', 'Editor timeout must be 1..120000 ms'));
    if (this.pending.size >= 32)
      return Promise.reject(new WheelError('CONFLICT', 'Editor client request queue is busy', { busy: true }));
    const id = randomUUID();
    let sent = false;
    const uncertain = (error: Error) =>
      method === 'scene.commit' && sent
        ? new WheelError('UNKNOWN', 'Editor commit outcome is unknown; query status before retrying', {
            operationId: params.operationId,
            sessionId: this.identity.sessionId,
            requestId: id,
            cause: (error as { code?: string }).code ?? error.name,
          })
        : error;
    return new Promise((resolve, reject) => {
      const cancel = (code: 'TIMEOUT' | 'CANCELLED') => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        dispose();
        if (!this.closed && method !== 'editor.hello')
          this.send({ jsonrpc: '2.0', method: 'editor.cancel', params: { requestId: id } });
        reject(
          uncertain(
            new WheelError(code, `Editor read request ${code.toLowerCase()}`, {
              requestId: id,
              cancellation: 'REQUESTED_NOT_CONFIRMED',
            }),
          ),
        );
      };
      const timer = setTimeout(() => cancel('TIMEOUT'), timeoutMs);
      const onAbort = () => cancel(abortCode(signal));
      const dispose = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      this.pending.set(id, { resolve, reject: (error) => reject(uncertain(error)), dispose });
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params, timeoutMs }) + '\n';
      if (Buffer.byteLength(frame) > MAX_FRAME) {
        this.pending.delete(id);
        dispose();
        reject(new WheelError('INVALID_ARGUMENT', 'Editor request exceeds 64 KiB'));
        return;
      }
      this.socket.write(frame);
      sent = true;
    });
  }
  private send(message: unknown) {
    this.socket.write(JSON.stringify(message) + '\n');
  }
  private receive(bytes: Buffer) {
    this.buffer = Buffer.concat([this.buffer, bytes]);
    if (this.buffer.length > 1024 * 1024) {
      this.fail(new WheelError('PROTOCOL_MISMATCH', 'Editor receive budget exceeded'));
      return;
    }
    let newline: number;
    while ((newline = this.buffer.indexOf(10)) >= 0) {
      const frame = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      let response: Record<string, unknown>;
      try {
        if (frame.length > MAX_FRAME) throw new Error();
        response = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame));
        if (
          !response ||
          response.jsonrpc !== '2.0' ||
          typeof response.id !== 'string' ||
          Object.hasOwn(response, 'result') === Object.hasOwn(response, 'error')
        )
          throw new Error();
      } catch {
        this.fail(new WheelError('PROTOCOL_MISMATCH', 'Invalid editor response frame'));
        return;
      }
      const entry = this.pending.get(response.id as string);
      if (!entry) continue; // Read-only late responses never resurrect expired requests.
      this.pending.delete(response.id as string);
      entry.dispose();
      if (response.error) {
        const error = response.error as Record<string, unknown>;
        const data = error.data as Record<string, unknown> | undefined;
        entry.reject(
          new WheelError(
            isStableErrorCode(data?.code) ? data.code : 'PROTOCOL_MISMATCH',
            typeof error.message === 'string' ? error.message : 'Invalid editor error',
            { requestId: response.id },
          ),
        );
      } else entry.resolve(response.result);
    }
    if (this.buffer.length > MAX_FRAME) this.fail(new WheelError('PROTOCOL_MISMATCH', 'Editor frame exceeds 64 KiB'));
  }
  private fail(error: Error) {
    this.closed = true;
    for (const entry of this.pending.values()) {
      entry.dispose();
      entry.reject(error);
    }
    this.pending.clear();
    this.socket.destroy();
  }
  close(): void {
    this.fail(unavailable());
  }
}

export async function readEditorState(
  projectPath: string,
  ownerId: string,
  options: { limit?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<EditorState> {
  const bridge = await EditorBridge.connect({ projectPath, ownerId, ...options });
  try {
    return await bridge.snapshot(options);
  } finally {
    bridge.close();
  }
}

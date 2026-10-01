import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WheelError } from '../error-schema.js';
import { snapshotProject } from '../project-snapshot.js';
import { createTimeoutContext } from '../timeout.js';
import { resolveProjectPath } from './paths.js';
import { readEditorState } from '../editor/editor-bridge.js';
import { assertEditorStateDocumentsClean } from './validated-write.js';
import {
  preflightGodotRename,
  reviewGodotRenameEdit,
  reviewRenameImpact as scanRenameImpact,
  verifyEditorLspBinding,
  type GodotWorkspaceEdit,
} from './script-service.js';

const MAX_FRAME = 1024 * 1024;
const MAX_SCRIPT = 1024 * 1024;
type Pending = {
  id: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};
type OpenScript = { uri: string; path: string; sha256: string };
type DiagnosticWaiter = {
  resolve: (value: unknown[]) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const requestTimeout = (value?: number) => Math.max(1, Math.min(30000, value ?? 10000));

/** Authenticated, local-only, read-only Godot LSP session. Raw locations are not rename authority. */
export class GodotLspClient {
  private buffer = Buffer.alloc(0);
  private pending: Pending | undefined;
  private nextId = 0;
  private closed = false;
  private readonly opened = new Map<string, OpenScript>();
  private readonly diagnostics = new Map<string, unknown[]>();
  private readonly diagnosticWaiters = new Map<string, DiagnosticWaiter>();

  private constructor(
    private readonly socket: net.Socket,
    readonly projectPath: string,
    readonly godotVersion: string,
    private readonly timeoutMs: number,
    private readonly ownerId: string,
  ) {
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('error', () => this.close());
    socket.on('close', () => this.close());
  }

  static async connect(options: {
    projectPath: string;
    ownerId: string;
    lspPort: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<GodotLspClient> {
    const binding = await verifyEditorLspBinding(options);
    const timeoutMs = requestTimeout(options.timeoutMs);
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const connection = net.createConnection({ host: '127.0.0.1', port: binding.lspPort });
      const timeout = setTimeout(() => {
        connection.destroy();
        reject(new WheelError('TIMEOUT', 'Godot LSP connection timed out'));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        connection.off('connect', onConnect);
        connection.off('error', onError);
        options.signal?.removeEventListener('abort', onAbort);
      };
      const onConnect = () => {
        cleanup();
        resolve(connection);
      };
      const onError = () => {
        cleanup();
        reject(new WheelError('ENGINE_UNAVAILABLE', 'Godot LSP connection failed'));
      };
      const onAbort = () => {
        cleanup();
        connection.destroy();
        reject(new WheelError('CANCELLED', 'Godot LSP connection cancelled'));
      };
      connection.once('connect', onConnect);
      connection.once('error', onError);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
    });
    const client = new GodotLspClient(socket, binding.projectPath, binding.godotVersion, timeoutMs, options.ownerId);
    try {
      const rootUri = pathToFileURL(`${binding.projectPath}${path.sep}`).href;
      const initialized = await client.request('initialize', {
        processId: null,
        rootUri,
        capabilities: {},
        workspaceFolders: [{ uri: rootUri, name: path.basename(binding.projectPath) }],
      });
      if (!initialized || typeof initialized !== 'object' || !('capabilities' in initialized))
        throw new WheelError('PROTOCOL_MISMATCH', 'Godot LSP initialize lacks capabilities');
      client.notify('initialized', {});
      return client;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  private send(message: unknown): void {
    if (this.closed) throw new WheelError('ENGINE_UNAVAILABLE', 'Godot LSP session is closed');
    const payload = JSON.stringify({ jsonrpc: '2.0', ...((message ?? {}) as object) });
    if (Buffer.byteLength(payload) > MAX_FRAME)
      throw new WheelError('INVALID_ARGUMENT', 'LSP request exceeds frame budget');
    this.socket.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
  }

  private notify(method: string, params: unknown): void {
    this.send({ method, params });
  }

  private receive(chunk: Buffer): void {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_FRAME * 2)
      return this.fail(new WheelError('PROTOCOL_MISMATCH', 'LSP buffer overflow'));
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      if (headerEnd > 8192) return this.fail(new WheelError('PROTOCOL_MISMATCH', 'LSP header too large'));
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const length = Number(/(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(header)?.[1]);
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_FRAME)
        return this.fail(new WheelError('PROTOCOL_MISMATCH', 'Invalid Godot LSP frame size'));
      if (this.buffer.length < headerEnd + 4 + length) return;
      let body: {
        jsonrpc?: string;
        id?: number;
        method?: string;
        params?: { uri?: string; diagnostics?: unknown[] };
        result?: unknown;
        error?: { message?: string };
      };
      try {
        body = JSON.parse(this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8'));
      } catch {
        return this.fail(new WheelError('PROTOCOL_MISMATCH', 'Malformed Godot LSP response'));
      }
      if (!body || typeof body !== 'object' || body.jsonrpc !== '2.0')
        return this.fail(new WheelError('PROTOCOL_MISMATCH', 'Invalid Godot LSP response envelope'));
      this.buffer = this.buffer.subarray(headerEnd + 4 + length);
      if (body.method === 'textDocument/publishDiagnostics') {
        const uri = body.params?.uri;
        if (
          typeof uri === 'string' &&
          Array.isArray(body.params?.diagnostics) &&
          body.params.diagnostics.length <= 512
        ) {
          try {
            const actual = path.resolve(fileURLToPath(uri));
            const opened = [...this.opened.values()].find((item) => {
              const expected = path.resolve(fileURLToPath(item.uri));
              return process.platform === 'win32'
                ? expected.toLowerCase() === actual.toLowerCase()
                : expected === actual;
            });
            if (opened) {
              this.diagnostics.set(opened.uri, body.params.diagnostics);
              const waiter = this.diagnosticWaiters.get(opened.uri);
              if (waiter) {
                this.diagnosticWaiters.delete(opened.uri);
                clearTimeout(waiter.timeout);
                waiter.resolve(body.params.diagnostics);
              }
            }
          } catch {
            // Malformed or unrelated notification never authorizes a query result.
          }
        }
      }
      const pending = this.pending;
      if (pending && body.id === pending.id) {
        this.pending = undefined;
        clearTimeout(pending.timeout);
        if (body.error)
          pending.reject(
            new WheelError(
              'VALIDATION_FAILED',
              typeof body.error.message === 'string' ? body.error.message : 'Godot LSP error',
            ),
          );
        else pending.resolve(body.result);
      }
      // Unsolicited notifications are not semantic proof and are ignored here.
    }
  }

  private fail(error: Error): void {
    const pending = this.pending;
    if (pending) {
      this.pending = undefined;
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.close();
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    if (this.pending) throw new WheelError('CONFLICT', 'Godot LSP request already in flight');
    const id = ++this.nextId;
    return await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(
        () => this.fail(new WheelError('TIMEOUT', `Godot LSP ${method} timed out`)),
        this.timeoutMs,
      );
      this.pending = { id, resolve, reject, timeout };
      try {
        this.send({ id, method, params });
      } catch (error) {
        this.fail(error as Error);
      }
    });
  }

  private async openScript(scriptPath: string): Promise<OpenScript> {
    const resolved = await resolveProjectPath(this.projectPath, scriptPath, { mode: 'read' });
    if (!resolved.relativePath.endsWith('.gd') || (await stat(resolved.absolutePath)).size > MAX_SCRIPT)
      throw new WheelError('UNSUPPORTED', 'LSP query requires a bounded project-local .gd script');
    const bytes = await readFile(resolved.absolutePath);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new WheelError('UNSUPPORTED', 'Binary script is not supported');
    const uri = pathToFileURL(resolved.absolutePath).href;
    const opened = { uri, path: resolved.relativePath, sha256: sha(bytes) };
    if (this.opened.has(uri)) {
      if (this.opened.get(uri)?.sha256 !== opened.sha256)
        throw new WheelError('CONFLICT', 'Script changed during LSP session; reconnect for a fresh snapshot');
      return opened;
    }
    this.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'gdscript', version: 1, text } });
    this.opened.set(uri, opened);
    return opened;
  }

  private async assertFresh(opened: OpenScript): Promise<void> {
    const resolved = await resolveProjectPath(this.projectPath, opened.path, { mode: 'read' });
    if (sha(await readFile(resolved.absolutePath)) !== opened.sha256)
      throw new WheelError('CONFLICT', 'Script changed during LSP query');
  }

  private async waitDiagnostics(opened: OpenScript): Promise<unknown[]> {
    const existing = this.diagnostics.get(opened.uri);
    if (existing) return existing;
    if (this.diagnosticWaiters.has(opened.uri)) throw new WheelError('CONFLICT', 'Diagnostics already pending');
    return await new Promise<unknown[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.diagnosticWaiters.delete(opened.uri);
        reject(new WheelError('TIMEOUT', 'Godot LSP diagnostics timed out'));
      }, this.timeoutMs);
      this.diagnosticWaiters.set(opened.uri, { resolve, reject, timeout });
    });
  }

  async query(
    scriptPath: string,
    method: 'symbols' | 'references' | 'definition' | 'diagnostics',
    position?: { line: number; character: number },
    signal?: AbortSignal,
  ): Promise<{
    analysisLevel: 'godot-lsp';
    refactorSafe: false;
    godotVersion: string;
    scriptSha256: string;
    result: unknown;
  }> {
    if (signal?.aborted) throw new WheelError('CANCELLED', 'Godot LSP query cancelled');
    const onAbort = () => this.fail(new WheelError('CANCELLED', 'Godot LSP query cancelled'));
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const opened = await this.openScript(scriptPath);
      if (
        method !== 'symbols' &&
        method !== 'diagnostics' &&
        (!position ||
          !Number.isSafeInteger(position.line) ||
          !Number.isSafeInteger(position.character) ||
          position.line < 0 ||
          position.character < 0)
      )
        throw new WheelError('INVALID_ARGUMENT', 'LSP position is required');
      const methodName =
        method === 'symbols'
          ? 'textDocument/documentSymbol'
          : method === 'references'
            ? 'textDocument/references'
            : 'textDocument/definition';
      const params =
        method === 'symbols'
          ? { textDocument: { uri: opened.uri } }
          : {
              textDocument: { uri: opened.uri },
              position,
              ...(method === 'references' ? { context: { includeDeclaration: true } } : {}),
            };
      const result =
        method === 'diagnostics' ? await this.waitDiagnostics(opened) : await this.request(methodName, params);
      await this.assertFresh(opened);
      if (result !== null && !Array.isArray(result) && typeof result !== 'object')
        throw new WheelError('PROTOCOL_MISMATCH', 'Godot LSP returned an invalid semantic result');
      if (Array.isArray(result) && result.length > 512)
        throw new WheelError('UNSUPPORTED', 'Godot LSP result exceeds the response budget');
      // Godot may resolve same-named comments/strings as references AND definitions; neither proves rename safety.
      if (method === 'references' || method === 'definition') {
        const locations = Array.isArray(result) ? result : result ? [result] : [];
        for (const location of locations) {
          if (!location || typeof location !== 'object' || typeof location.uri !== 'string')
            throw new WheelError('PROTOCOL_MISMATCH', 'Godot LSP location is malformed');
          await resolveProjectPath(this.projectPath, fileURLToPath(location.uri), {
            mode: 'read',
            allowAbsolute: true,
          });
        }
      }
      return {
        analysisLevel: 'godot-lsp',
        refactorSafe: false,
        godotVersion: this.godotVersion,
        scriptSha256: opened.sha256,
        result,
      };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private async withRenameEdit<T>(
    scriptPath: string,
    position: { line: number; character: number },
    oldName: string,
    newName: string,
    inspect: (edit: GodotWorkspaceEdit) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<{ opened: OpenScript; result: T }> {
    if (
      !Number.isSafeInteger(position.line) ||
      !Number.isSafeInteger(position.character) ||
      position.line < 0 ||
      position.character < 0
    )
      throw new WheelError('INVALID_ARGUMENT', 'Rename position is invalid');
    if (signal?.aborted) throw new WheelError('CANCELLED', 'Godot LSP rename preview cancelled');
    const onAbort = () => this.fail(new WheelError('CANCELLED', 'Godot LSP rename preview cancelled'));
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const opened = await this.openScript(scriptPath);
      const resolved = await resolveProjectPath(this.projectPath, opened.path, { mode: 'read' });
      const bytes = await readFile(resolved.absolutePath);
      if (sha(bytes) !== opened.sha256) throw new WheelError('CONFLICT', 'Script changed before rename preview');
      const line = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split(/\r?\n/)[position.line];
      if (
        !line ||
        line.slice(position.character, position.character + oldName.length) !== oldName ||
        /\w/.test(line[position.character - 1] ?? '') ||
        /\w/.test(line[position.character + oldName.length] ?? '')
      )
        throw new WheelError('INVALID_ARGUMENT', 'Rename cursor does not select the exact old identifier');
      const raw = await this.request('textDocument/rename', {
        textDocument: { uri: opened.uri },
        position,
        newName,
      });
      await this.assertFresh(opened);
      if (!raw || typeof raw !== 'object')
        throw new WheelError('PROTOCOL_MISMATCH', 'Godot LSP returned no rename edit');
      const result = await inspect(raw as GodotWorkspaceEdit);
      await this.assertFresh(opened);
      if (signal?.aborted) throw new WheelError('CANCELLED', 'Godot LSP rename preview cancelled');
      if (this.closed) throw new WheelError('ENGINE_UNAVAILABLE', 'Godot LSP session closed during rename preview');
      return { opened, result };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Internal preview only. Godot's WorkspaceEdit is not trusted semantic proof or write authority. */
  async previewRename(
    scriptPath: string,
    position: { line: number; character: number },
    oldName: string,
    newName: string,
    signal?: AbortSignal,
  ) {
    const { opened, result } = await this.withRenameEdit(
      scriptPath,
      position,
      oldName,
      newName,
      (edit) => preflightGodotRename(this.projectPath, edit, oldName, newName),
      signal,
    );
    return {
      analysisLevel: 'godot-lsp' as const,
      refactorSafe: false as const,
      godotVersion: this.godotVersion,
      scriptSha256: opened.sha256,
      ...result,
    };
  }

  /** Read-only lexical triage of an authenticated rename result; never authorizes a write. */
  async reviewRename(
    scriptPath: string,
    position: { line: number; character: number },
    oldName: string,
    newName: string,
    signal?: AbortSignal,
  ) {
    const { opened, result } = await this.withRenameEdit(
      scriptPath,
      position,
      oldName,
      newName,
      (edit) => reviewGodotRenameEdit(this.projectPath, edit, oldName, newName),
      signal,
    );
    return {
      ...result,
      godotVersion: this.godotVersion,
      scriptSha256: opened.sha256,
    };
  }

  /** Read-only project-wide impact review; all unmapped occurrences require manual assessment. */
  async reviewRenameImpact(
    scriptPath: string,
    position: { line: number; character: number },
    oldName: string,
    newName: string,
    signal?: AbortSignal,
  ) {
    const review = await this.reviewRename(scriptPath, position, oldName, newName, signal);
    const impact = await scanRenameImpact(this.projectPath, oldName, review, signal);
    if (this.closed) throw new WheelError('ENGINE_UNAVAILABLE', 'Godot LSP session closed during impact review');
    return { ...review, impact };
  }

  /** Code-only candidate with per-location backend definition agreement and a stable project snapshot. */
  async previewDefinitionCheckedRename(
    scriptPath: string,
    position: { line: number; character: number },
    oldName: string,
    newName: string,
    signal?: AbortSignal,
  ) {
    const timeout = createTimeoutContext(60000, signal);
    try {
      assertEditorStateDocumentsClean(
        await readEditorState(this.projectPath, this.ownerId, { signal: timeout.signal }),
        [scriptPath],
      );
      const before = await snapshotProject(this.projectPath, timeout);
      const { opened, result } = await this.withRenameEdit(
        scriptPath,
        position,
        oldName,
        newName,
        async (edit) => ({
          preview: await preflightGodotRename(this.projectPath, edit, oldName, newName),
          review: await reviewGodotRenameEdit(this.projectPath, edit, oldName, newName),
        }),
        timeout.signal,
      );
      const definitionAt = async (file: string, cursor: { line: number; character: number }) => {
        timeout.throwIfCancelled();
        timeout.throwIfExpired();
        const queried = await this.query(file, 'definition', cursor, timeout.signal);
        const locations = Array.isArray(queried.result) ? queried.result : queried.result ? [queried.result] : [];
        if (locations.length !== 1)
          throw new WheelError('UNSUPPORTED', 'Rename requires exactly one backend definition for each code location');
        const location = locations[0] as {
          uri?: string;
          range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } };
        };
        const start = location?.range?.start;
        const end = location?.range?.end;
        if (
          typeof location?.uri !== 'string' ||
          !start ||
          !end ||
          ![start.line, start.character, end.line, end.character].every(
            (value) => Number.isSafeInteger(value) && value! >= 0,
          ) ||
          end.line! < start.line! ||
          (end.line === start.line && end.character! < start.character!)
        )
          throw new WheelError('PROTOCOL_MISMATCH', 'Godot LSP definition range is malformed');
        const resolved = await resolveProjectPath(this.projectPath, fileURLToPath(location.uri), {
          mode: 'read',
          allowAbsolute: true,
        });
        return {
          path: resolved.relativePath,
          range: {
            start: { line: start.line!, character: start.character! },
            end: { line: end.line!, character: end.character! },
          },
        };
      };
      const definition = await definitionAt(opened.path, position);
      const target = JSON.stringify(definition);
      for (const location of result.review.codeLocations) {
        if (JSON.stringify(await definitionAt(location.path, location.range.start)) !== target)
          throw new WheelError('CONFLICT', 'Rename code location resolves to a different declaration', {
            path: location.path,
          });
      }
      const impact = await scanRenameImpact(this.projectPath, oldName, result.review, timeout.signal);
      if (
        impact.projectSha256 !== before.sha256 ||
        (await snapshotProject(this.projectPath, timeout)).sha256 !== before.sha256
      )
        throw new WheelError('CONFLICT', 'Project changed during definition-checked rename preview');
      timeout.throwIfCancelled();
      timeout.throwIfExpired();
      assertEditorStateDocumentsClean(
        await readEditorState(this.projectPath, this.ownerId, { signal: timeout.signal }),
        result.preview.editedFiles,
      );
      if (this.closed) throw new WheelError('ENGINE_UNAVAILABLE', 'Godot LSP session closed during rename preview');
      return {
        analysisLevel: 'godot-lsp' as const,
        refactorSafe: false as const,
        definitionCheck: 'PASS' as const,
        checkedCodeLocations: result.review.codeLocations.length,
        definition,
        projectSha256: before.sha256,
        godotVersion: this.godotVersion,
        scriptSha256: opened.sha256,
        ...result.preview,
        impact,
      };
    } finally {
      timeout.dispose();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      clearTimeout(pending.timeout);
      pending.reject(new WheelError('ENGINE_UNAVAILABLE', 'Godot LSP session closed'));
    }
    for (const waiter of this.diagnosticWaiters.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(new WheelError('ENGINE_UNAVAILABLE', 'Godot LSP session closed'));
    }
    this.diagnosticWaiters.clear();
    this.socket.destroy();
  }
}

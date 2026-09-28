import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { EditorBridge } from '../editor/editor-bridge.js';
import { WheelError } from '../error-schema.js';
import { readProcessIdentity, sameProcessIdentity } from '../process-identity.js';
import { resolveProjectPath } from './paths.js';
import type { TransactionOperation } from './transactions.js';

const execFileAsync = promisify(execFile);

type Position = { line: number; character: number };
type TextEdit = { range: { start: Position; end: Position }; newText: string };
export type GodotWorkspaceEdit = {
  changes?: Record<string, TextEdit[]>;
  documentChanges?: unknown;
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z_0-9]*$/;
const MAX_FILES = 32;
const MAX_EDITS = 256;
const MAX_FILE_BYTES = 1024 * 1024;

/** Fail closed unless the local LSP listener belongs to the exact authenticated editor. */
export async function verifyEditorLspBinding(options: {
  projectPath: string;
  ownerId: string;
  lspPort: number;
  signal?: AbortSignal;
}): Promise<{ projectPath: string; editorPid: number; godotVersion: string; lspPort: number }> {
  if (process.platform !== 'win32') throw new WheelError('UNSUPPORTED', 'LSP owner verification is Windows-only');
  if (!Number.isSafeInteger(options.lspPort) || options.lspPort < 1024 || options.lspPort > 65535)
    throw new WheelError('INVALID_ARGUMENT', 'LSP port is outside the supported local range');
  const root = await realpath(options.projectPath);
  const bridge = await EditorBridge.connect({ projectPath: root, ownerId: options.ownerId, signal: options.signal });
  const identity = bridge.identity;
  bridge.close();
  const editorRoot = await realpath(identity.projectPath);
  const sameRoot =
    process.platform === 'win32'
      ? path.resolve(root).toLowerCase() === path.resolve(editorRoot).toLowerCase()
      : path.resolve(root) === path.resolve(editorRoot);
  if (!sameRoot || !/^4\.7\.2(?:[.-]|$)/.test(identity.godotVersion))
    throw new WheelError('PROTOCOL_MISMATCH', 'Editor project or Godot version does not match LSP requirement', {
      sameRoot,
      godotVersion: identity.godotVersion,
    });
  const expected = await readProcessIdentity(identity.editorPid);
  if (!expected) throw new WheelError('ENGINE_UNAVAILABLE', 'Authenticated editor process is not live');
  const script = `
$ErrorActionPreference = 'Stop'
$listeners = @(Get-NetTCPConnection -LocalPort ([int]$env:WHEEL_LSP_PORT) -State Listen |
  Where-Object { $_.LocalAddress -eq '127.0.0.1' -or $_.LocalAddress -eq '::1' })
@($listeners | Select-Object -ExpandProperty OwningProcess -Unique) | ConvertTo-Json -Compress
`;
  let owners: number[];
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 8192,
      signal: options.signal,
      env: { ...process.env, WHEEL_LSP_PORT: String(options.lspPort) },
    });
    const raw: unknown = JSON.parse(stdout.trim());
    owners = (Array.isArray(raw) ? raw : [raw]).filter((value): value is number => Number.isSafeInteger(value));
  } catch {
    throw new WheelError('ENGINE_UNAVAILABLE', 'Cannot verify local LSP listener ownership');
  }
  if (owners.length !== 1 || owners[0] !== identity.editorPid)
    throw new WheelError('FORBIDDEN', 'LSP listener is not owned by the authorized editor');
  if (!sameProcessIdentity(expected, await readProcessIdentity(identity.editorPid)))
    throw new WheelError('ENGINE_UNAVAILABLE', 'Editor identity changed during LSP verification');
  return {
    projectPath: root,
    editorPid: identity.editorPid,
    godotVersion: identity.godotVersion,
    lspPort: options.lspPort,
  };
}

function offsetAt(content: string, position: Position): number {
  if (!Number.isSafeInteger(position.line) || position.line < 0) throw new Error('invalid LSP line');
  if (!Number.isSafeInteger(position.character) || position.character < 0) throw new Error('invalid LSP column');
  let start = 0;
  for (let line = 0; line < position.line; line++) {
    const next = content.indexOf('\n', start);
    if (next < 0) throw new Error('LSP line out of bounds');
    start = next + 1;
  }
  const end = content.indexOf('\n', start);
  const lineEnd = end < 0 ? content.length : end;
  if (position.character > lineEnd - start) throw new Error('LSP column out of bounds');
  return start + position.character;
}

/** Only a conservative lexical rejection guard; this does not prove semantic identity. */
function nonCodeRanges(content: string): Array<[number, number]> {
  const blocked: Array<[number, number]> = [];
  let index = 0;
  while (index < content.length) {
    const start = index;
    if (content[index] === '#') {
      while (index < content.length && content[index] !== '\n') index++;
      blocked.push([start, index]);
      continue;
    }
    const quote = content[index];
    if (quote === '"' || quote === "'") {
      const triple = content.slice(index, index + 3) === quote.repeat(3);
      const delimiter = triple ? quote.repeat(3) : quote;
      index += delimiter.length;
      let closed = false;
      while (index < content.length) {
        if (content[index] === '\\') {
          index += 2;
          continue;
        }
        if (content.startsWith(delimiter, index)) {
          index += delimiter.length;
          closed = true;
          break;
        }
        if (!triple && content[index] === '\n') break;
        index++;
      }
      if (!closed) throw new Error('unclosed GDScript string; rename requires manual review');
      blocked.push([start, index]);
      continue;
    }
    index++;
  }
  return blocked;
}

export type SemanticRenamePreview = {
  operations: TransactionOperation[];
  editedFiles: string[];
  editCount: number;
};

/**
 * Converts a Godot WorkspaceEdit into exact file-CAS candidates, rejecting any
 * non-code, out-of-project or ambiguous edit. This is only a preflight stage:
 * semantic definition checks, approval and native validation are still required
 * before callers may commit these operations.
 */
export async function preflightGodotRename(
  projectPath: string,
  edit: GodotWorkspaceEdit,
  oldName: string,
  newName: string,
): Promise<SemanticRenamePreview> {
  if (!IDENTIFIER.test(oldName) || !IDENTIFIER.test(newName) || oldName === newName)
    throw new Error('rename requires two distinct GDScript identifiers');
  if (edit.documentChanges !== undefined || !edit.changes) throw new Error('unsupported WorkspaceEdit variant');
  const entries = Object.entries(edit.changes);
  if (!entries.length || entries.length > MAX_FILES) throw new Error('WorkspaceEdit file budget exceeded');
  const operations: TransactionOperation[] = [];
  const editedFiles: string[] = [];
  let editCount = 0;
  const seen = new Set<string>();
  for (const [uri, edits] of entries) {
    if (!uri.startsWith('file:') || !Array.isArray(edits) || !edits.length)
      throw new Error('invalid WorkspaceEdit file');
    const resolved = await resolveProjectPath(projectPath, fileURLToPath(uri), { mode: 'write', allowAbsolute: true });
    if (!resolved.relativePath.endsWith('.gd') || seen.has(resolved.relativePath))
      throw new Error('WorkspaceEdit targets an unsupported or duplicate script');
    seen.add(resolved.relativePath);
    if ((await stat(resolved.absolutePath)).size > MAX_FILE_BYTES) throw new Error('script exceeds rename size budget');
    const before = await readFile(resolved.absolutePath);
    const source = new TextDecoder('utf-8', { fatal: true }).decode(before);
    if (source.includes('\0')) throw new Error('binary script cannot be renamed');
    const blocked = nonCodeRanges(source);
    const located = edits.map((item) => {
      if (item.newText !== newName) throw new Error('WorkspaceEdit contains a non-rename change');
      const start = offsetAt(source, item.range.start);
      const end = offsetAt(source, item.range.end);
      if (start >= end || source.slice(start, end) !== oldName) throw new Error('WorkspaceEdit stale or wrong symbol');
      if (blocked.some(([low, high]) => start < high && end > low))
        throw new Error('WorkspaceEdit touches a string or comment; manual review required');
      if (/\w/.test(source[start - 1] ?? '') || /\w/.test(source[end] ?? ''))
        throw new Error('WorkspaceEdit does not cover an entire identifier');
      return { start, end };
    });
    editCount += located.length;
    if (editCount > MAX_EDITS) throw new Error('WorkspaceEdit edit budget exceeded');
    located.sort((a, b) => b.start - a.start);
    let lastStart = source.length + 1;
    let after = source;
    for (const item of located) {
      if (item.end > lastStart) throw new Error('WorkspaceEdit has overlapping ranges');
      after = `${after.slice(0, item.start)}${newName}${after.slice(item.end)}`;
      lastStart = item.start;
    }
    operations.push({
      kind: 'replace',
      path: resolved.relativePath,
      content: after,
      expectedSha256: createHash('sha256').update(before).digest('hex'),
    });
    editedFiles.push(resolved.relativePath);
  }
  return { operations, editedFiles, editCount };
}

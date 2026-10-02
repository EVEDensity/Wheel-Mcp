import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { EditorBridge } from '../editor/editor-bridge.js';
import { WheelError } from '../error-schema.js';
import { readProcessIdentity, sameProcessIdentity } from '../process-identity.js';
import { snapshotProject } from '../project-snapshot.js';
import { createTimeoutContext } from '../timeout.js';
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

export function parseLspListenerOwners(value: unknown): number[] {
  if (!Array.isArray(value) || value.some((pid) => !Number.isSafeInteger(pid) || pid < 1))
    throw new WheelError('PROTOCOL_MISMATCH', 'Invalid LSP listener ownership result');
  return value as number[];
}

/** Fail closed unless the local LSP listener belongs to the exact authenticated editor. */
export async function verifyEditorLspBinding(options: {
  projectPath: string;
  ownerId: string;
  lspPort: number;
  signal?: AbortSignal;
}): Promise<{ projectPath: string; editorPid: number; godotVersion: string; lspPort: number }> {
  options.signal?.throwIfAborted();
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
$timer = [System.Diagnostics.Stopwatch]::StartNew()
do {
  $listeners = @(Get-NetTCPConnection -State Listen |
    Where-Object { $_.LocalPort -eq ([int]$env:WHEEL_LSP_PORT) -and ($_.LocalAddress -eq '127.0.0.1' -or $_.LocalAddress -eq '::1') })
  $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($owners.Count -gt 0 -or $timer.ElapsedMilliseconds -ge 5000) { break }
  Start-Sleep -Milliseconds 50
} while ($true)
ConvertTo-Json -InputObject @($owners) -Compress
`;
  let owners: number[];
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      // Includes Windows CIM/module cold start; the actual readiness poll is bounded at 5s.
      timeout: 10000,
      maxBuffer: 8192,
      signal: options.signal,
      env: { ...process.env, WHEEL_LSP_PORT: String(options.lspPort) },
    });
    const raw: unknown = JSON.parse(stdout.trim());
    owners = parseLspListenerOwners(raw);
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof WheelError) throw error;
    const cause = error as { code?: string | number; killed?: boolean; signal?: string; stderr?: string };
    const diagnostic =
      cause.stderr?.trim().slice(0, 512) ||
      (cause.killed ? 'system query deadline exceeded' : 'system query or JSON decode failed');
    throw new WheelError('ENGINE_UNAVAILABLE', `Cannot verify local LSP listener ownership: ${diagnostic}`, {
      phase: 'listener-query',
      code: cause.code ?? null,
      killed: cause.killed === true,
      signal: cause.signal ?? null,
      diagnostic,
    });
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
function nonCodeRanges(content: string): Array<{ start: number; end: number; kind: 'string' | 'comment' }> {
  const blocked: Array<{ start: number; end: number; kind: 'string' | 'comment' }> = [];
  let index = 0;
  while (index < content.length) {
    const start = index;
    if (content[index] === '#') {
      while (index < content.length && content[index] !== '\n') index++;
      blocked.push({ start, end: index, kind: 'comment' });
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
      blocked.push({ start, end: index, kind: 'string' });
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
      if (blocked.some(({ start: low, end: high }) => start < high && end > low))
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

export type RenameEditReview = {
  analysisLevel: 'lexical-review';
  refactorSafe: false;
  fileSnapshots: Array<{ path: string; sha256: string }>;
  codeLocations: Array<{ path: string; range: TextEdit['range'] }>;
  manualReview: Array<{ path: string; range: TextEdit['range']; reason: 'string' | 'comment' }>;
  editCount: number;
};

/**
 * Read-only triage of Godot's raw rename result. Code locations are candidates,
 * not semantically verified references; this deliberately emits no file content
 * or TransactionOperation and never authorizes a write.
 */
export async function reviewGodotRenameEdit(
  projectPath: string,
  edit: GodotWorkspaceEdit,
  oldName: string,
  newName: string,
): Promise<RenameEditReview> {
  if (!IDENTIFIER.test(oldName) || !IDENTIFIER.test(newName) || oldName === newName)
    throw new Error('rename requires two distinct GDScript identifiers');
  if (edit.documentChanges !== undefined || !edit.changes) throw new Error('unsupported WorkspaceEdit variant');
  const entries = Object.entries(edit.changes);
  if (!entries.length || entries.length > MAX_FILES) throw new Error('WorkspaceEdit file budget exceeded');
  const review: RenameEditReview = {
    analysisLevel: 'lexical-review',
    refactorSafe: false,
    fileSnapshots: [],
    codeLocations: [],
    manualReview: [],
    editCount: 0,
  };
  const seen = new Set<string>();
  for (const [uri, edits] of entries) {
    if (!uri.startsWith('file:') || !Array.isArray(edits) || !edits.length)
      throw new Error('invalid WorkspaceEdit file');
    const resolved = await resolveProjectPath(projectPath, fileURLToPath(uri), { mode: 'read', allowAbsolute: true });
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
      if (/\w/.test(source[start - 1] ?? '') || /\w/.test(source[end] ?? ''))
        throw new Error('WorkspaceEdit does not cover an entire identifier');
      const intersecting = blocked.filter((range) => start < range.end && end > range.start);
      if (
        intersecting.length &&
        (intersecting.length !== 1 || start < intersecting[0]!.start || end > intersecting[0]!.end)
      )
        throw new Error('WorkspaceEdit crosses a code/non-code boundary');
      return { start, end, range: item.range, nonCode: intersecting[0] };
    });
    review.editCount += located.length;
    if (review.editCount > MAX_EDITS) throw new Error('WorkspaceEdit edit budget exceeded');
    located.sort((a, b) => a.start - b.start);
    let lastEnd = -1;
    for (const item of located) {
      if (item.start < lastEnd) throw new Error('WorkspaceEdit has overlapping ranges');
      lastEnd = item.end;
      const location = { path: resolved.relativePath, range: item.range };
      if (item.nonCode) review.manualReview.push({ ...location, reason: item.nonCode.kind });
      else review.codeLocations.push(location);
    }
    review.fileSnapshots.push({
      path: resolved.relativePath,
      sha256: createHash('sha256').update(before).digest('hex'),
    });
  }
  if (!review.codeLocations.length) throw new Error('WorkspaceEdit has no code candidates');
  return review;
}

export type RenameImpactReview = {
  analysisLevel: 'lexical-impact-review';
  refactorSafe: false;
  projectSha256: string;
  scannedFiles: number;
  matchedCodeLocations: number;
  sceneScriptPaths: Array<{ scenePath: string; scriptPath: string; line: number }>;
  manualReview: Array<{
    path: string;
    line: number;
    character: number;
    reason: 'unmapped_code' | 'string' | 'comment' | 'serialized_scene_or_resource';
  }>;
};

/**
 * Compare one LSP rename review with a bounded, stable project snapshot.
 * Unmapped occurrences are manual risks, not extra edits to apply.
 */
export async function reviewRenameImpact(
  projectPath: string,
  oldName: string,
  review: RenameEditReview,
  signal?: AbortSignal,
): Promise<RenameImpactReview> {
  if (!IDENTIFIER.test(oldName) || review.refactorSafe !== false || review.analysisLevel !== 'lexical-review')
    throw new Error('impact review requires a lexical rename review and an identifier');
  const timeout = createTimeoutContext(60000, signal);
  try {
    const snapshot = await snapshotProject(projectPath, timeout);
    if (snapshot.fileCount > 1000 || snapshot.totalBytes > 64 * 1024 * 1024)
      throw new WheelError('UNSUPPORTED', 'Rename impact review is limited to 1000 files / 64 MiB');
    const files = new Map(snapshot.files.map((item) => [item.path, item]));
    for (const item of review.fileSnapshots) {
      if (files.get(item.path)?.sha256 !== item.sha256)
        throw new WheelError('CONFLICT', 'Rename source changed before impact review', { path: item.path });
    }
    const key = (path: string, line: number, character: number) => `${path}\0${line}\0${character}`;
    const codeLocations = new Set(
      review.codeLocations.map(({ path, range }) => key(path, range.start.line, range.start.character)),
    );
    const seenCode = new Set<string>();
    const manualReview: RenameImpactReview['manualReview'] = [];
    const sceneScriptPaths: RenameImpactReview['sceneScriptPaths'] = [];
    let scannedFiles = 0;
    for (const entry of snapshot.files) {
      timeout.throwIfCancelled();
      timeout.throwIfExpired();
      if (!/\.(?:gd|tscn|tres)$/.test(entry.path)) continue;
      if (entry.bytes > MAX_FILE_BYTES) throw new WheelError('UNSUPPORTED', 'Rename impact file exceeds 1 MiB');
      const safe = await resolveProjectPath(projectPath, entry.path, { mode: 'read' });
      const bytes = await readFile(safe.absolutePath);
      if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
        throw new WheelError('CONFLICT', 'Project changed during rename impact review', { path: entry.path });
      const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (source.includes('\0')) throw new WheelError('UNSUPPORTED', 'Binary rename impact file is unsupported');
      if (!entry.path.endsWith('.gd')) {
        for (const [line, text] of source.split('\n').entries()) {
          if (!/^\s*\[ext_resource\b/.test(text) || !/\btype="Script"/.test(text)) continue;
          const declared = /\bpath="([^"]+)"/.exec(text)?.[1];
          if (!declared?.startsWith('res://') || !declared.endsWith('.gd'))
            throw new WheelError('UNSUPPORTED', 'Scene script declaration has an unsupported path', {
              scenePath: entry.path,
              line: line + 1,
            });
          try {
            await resolveProjectPath(projectPath, declared, { mode: 'read' });
          } catch {
            throw new WheelError('CONFLICT', 'Scene script path cannot be verified', {
              scenePath: entry.path,
              line: line + 1,
              scriptPath: declared,
            });
          }
          sceneScriptPaths.push({ scenePath: entry.path, scriptPath: declared, line: line + 1 });
          if (sceneScriptPaths.length > MAX_EDITS)
            throw new WheelError('UNSUPPORTED', 'Scene script path review exceeds budget');
        }
      }
      const blocked = entry.path.endsWith('.gd') ? nonCodeRanges(source) : [];
      const lineStarts = [0];
      for (let index = 0; index < source.length; index++) if (source[index] === '\n') lineStarts.push(index + 1);
      scannedFiles++;
      let start = 0;
      while ((start = source.indexOf(oldName, start)) >= 0) {
        const end = start + oldName.length;
        if (!/\w/.test(source[start - 1] ?? '') && !/\w/.test(source[end] ?? '')) {
          let low = 0;
          let high = lineStarts.length - 1;
          while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (lineStarts[middle]! <= start) low = middle;
            else high = middle - 1;
          }
          const line = low;
          const character = start - lineStarts[low]!;
          const locationKey = key(entry.path, line, character);
          if (codeLocations.has(locationKey)) seenCode.add(locationKey);
          else {
            const nonCode = blocked.find((range) => start >= range.start && end <= range.end);
            manualReview.push({
              path: entry.path,
              line,
              character,
              reason: entry.path.endsWith('.gd') ? (nonCode?.kind ?? 'unmapped_code') : 'serialized_scene_or_resource',
            });
            if (manualReview.length > MAX_EDITS)
              throw new WheelError('UNSUPPORTED', 'Rename impact exceeds manual review budget');
          }
        }
        start = end;
      }
    }
    if (seenCode.size !== codeLocations.size)
      throw new WheelError('CONFLICT', 'LSP code candidate missing from project snapshot');
    if ((await snapshotProject(projectPath, timeout)).sha256 !== snapshot.sha256)
      throw new WheelError('CONFLICT', 'Project changed during rename impact review');
    return {
      analysisLevel: 'lexical-impact-review',
      refactorSafe: false,
      projectSha256: snapshot.sha256,
      scannedFiles,
      matchedCodeLocations: seenCode.size,
      sceneScriptPaths,
      manualReview,
    };
  } finally {
    timeout.dispose();
  }
}

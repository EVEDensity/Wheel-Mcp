import { lstat, open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { getGodotVersion, getProjectInfo, getSceneTree, resolveGodotPath } from './godot-runtime.js';
import { runGit } from './git-recovery.js';
import type { TimeoutContext } from './timeout.js';
import { getProjectIndex } from './index/project-index.js';
import { resolveProjectPath } from './project/paths.js';
import { budgetResponse, DEFAULT_RESPONSE_BYTES, MAX_RESPONSE_BYTES } from './response-budget.js';
import { WheelError } from './error-schema.js';

export const CONTEXT_FIELDS = ['godot', 'main_scene', 'git', 'active_run', 'snippets'] as const;
export type ContextField = (typeof CONTEXT_FIELDS)[number];
export type ContextAnchor = { file: string; kind: 'symbol' | 'node'; name: string };
export interface ContextPackOptions {
  projectPath: string;
  godotPath?: string;
  evidenceDir?: string;
  scenePath?: string | null;
  maxErrorBytes?: number;
  timeout?: TimeoutContext;
  targets?: string[];
  dependencyDepth?: number;
  maxBytes?: number;
  taskIntent?: string;
  anchors?: ContextAnchor[];
  fields?: ContextField[];
  maxTokens?: number;
  errorStack?: string;
}
export async function buildContextPack({
  projectPath,
  godotPath,
  evidenceDir,
  scenePath = null,
  maxErrorBytes = 12000,
  timeout,
  targets,
  dependencyDepth = 1,
  maxBytes = DEFAULT_RESPONSE_BYTES,
  taskIntent,
  anchors = [],
  fields = [...CONTEXT_FIELDS],
  maxTokens,
  errorStack,
}: ContextPackOptions) {
  if (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 1000000))
    throw new WheelError('INVALID_ARGUMENT', 'Context requested token budget must be 1–1000000');
  if (errorStack !== undefined && (typeof errorStack !== 'string' || errorStack.length > 8192))
    throw new WheelError('INVALID_ARGUMENT', 'Context error stack exceeds 8192 characters');
  if (taskIntent !== undefined && (typeof taskIntent !== 'string' || !taskIntent.trim() || taskIntent.length > 2048))
    throw new WheelError('INVALID_ARGUMENT', 'Context task intent must be nonempty and at most 2048 characters');
  if (
    !Array.isArray(fields) ||
    fields.length > CONTEXT_FIELDS.length ||
    fields.some((field) => !CONTEXT_FIELDS.includes(field))
  )
    throw new WheelError('INVALID_ARGUMENT', 'Unknown context field selection');
  if (
    !Array.isArray(anchors) ||
    anchors.length > 32 ||
    anchors.some(
      (anchor) =>
        !anchor ||
        typeof anchor !== 'object' ||
        !['symbol', 'node'].includes(anchor.kind) ||
        typeof anchor.file !== 'string' ||
        !anchor.file.length ||
        anchor.file.length > 512 ||
        typeof anchor.name !== 'string' ||
        !anchor.name.length ||
        anchor.name.length > 512 ||
        Object.keys(anchor).some((key) => !['file', 'kind', 'name'].includes(key)),
    )
  )
    throw new WheelError('INVALID_ARGUMENT', 'Invalid context anchors');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_RESPONSE_BYTES)
    throw new WheelError('INVALID_ARGUMENT', 'Context byte budget must be 1024–131072');
  if (!Number.isSafeInteger(dependencyDepth) || dependencyDepth < 0 || dependencyDepth > 8)
    throw new WheelError('INVALID_ARGUMENT', 'Context dependency depth must be 0–8');
  if (!Number.isSafeInteger(maxErrorBytes) || maxErrorBytes < 1 || maxErrorBytes > 131072)
    throw new WheelError('INVALID_ARGUMENT', 'Context log byte budget must be 1–131072');
  if (
    targets !== undefined &&
    (!Array.isArray(targets) ||
      targets.length > 32 ||
      targets.some((target) => typeof target !== 'string' || !target.length || target.length > 512))
  )
    throw new WheelError('INVALID_ARGUMENT', 'Context targets exceed budget');
  const root = path.resolve(projectPath);
  timeout?.throwIfCancelled();
  const project = await getProjectInfo(root, timeout);
  const indexed = await (await getProjectIndex(root)).refresh(timeout);
  if (indexed.sourceHash !== project.index.sourceHash)
    throw new WheelError('CONFLICT', 'Project changed during context collection');
  const logs = evidenceDir ? await readRecentErrors(evidenceDir, maxErrorBytes, timeout) : { errors: [], segments: [] };
  const seeds =
    targets ?? (anchors.length ? [] : scenePath || project.mainScene ? [scenePath || project.mainScene!] : []);
  const entries = new Map(indexed.files.map((file) => [file.path, file]));
  const selected = new Map<string, number>();
  const missing: string[] = [];
  const anchorResults: { file: string; kind: 'symbol' | 'node'; name: string; status: string; lines: number[] }[] = [];
  const locations = new Map<string, number[]>();
  const explicitFiles = new Set<string>();
  for (const seed of [...seeds, ...anchors.map((anchor) => anchor.file)]) {
    timeout?.throwIfCancelled();
    timeout?.throwIfExpired();
    let resolved;
    try {
      resolved = await resolveProjectPath(root, seed, { mode: 'read', allowUid: true });
    } catch (error) {
      if (error instanceof Error && ['project path does not exist', 'Godot UID not found'].includes(error.message)) {
        missing.push(seed);
        continue;
      }
      throw error;
    }
    const entry = entries.get(resolved.relativePath);
    if (!entry) missing.push(seed);
    else {
      selected.set(resolved.relativePath, 0);
      if (seeds.includes(seed)) explicitFiles.add(resolved.relativePath);
      for (const anchor of anchors.filter((anchor) => anchor.file === seed)) {
        if (
          anchorResults.some(
            (result) => result.file === seed && result.kind === anchor.kind && result.name === anchor.name,
          )
        )
          continue;
        const matches = (anchor.kind === 'symbol' ? entry.metadata.symbols : entry.metadata.nodes)
          .filter((item) => item.name === anchor.name)
          .map((item) => item.line);
        anchorResults.push({
          ...anchor,
          status: matches.length === 1 ? 'resolved' : matches.length ? 'ambiguous' : 'missing',
          lines: matches,
        });
        if (matches.length === 1) {
          explicitFiles.add(entry.path);
          locations.set(entry.path, [...(locations.get(entry.path) ?? []), matches[0]]);
        }
      }
    }
  }
  for (const anchor of anchors) {
    if (
      !anchorResults.some(
        (result) => result.file === anchor.file && result.kind === anchor.kind && result.name === anchor.name,
      )
    )
      anchorResults.push({ ...anchor, status: 'missing-file', lines: [] });
  }
  const errorLocations: { file: string; line: number; status: string }[] = [];
  const errorFiles = new Set<string>();
  let errorLocationsTruncated = false;
  // Error text is data, never instructions: only literal project resource locations are recognized.
  for (const text of [errorStack ?? '', ...logs.errors]) {
    for (const match of text.matchAll(/res:\/\/([^\s:"'<>]{1,512}):(\d{1,9})(?::|\b)/g)) {
      timeout?.throwIfCancelled();
      timeout?.throwIfExpired();
      if (errorLocations.length >= 32) {
        errorLocationsTruncated = true;
        break;
      }
      const file = match[1],
        line = Number(match[2]);
      const entry = entries.get(file);
      const valid = entry?.text !== null && entry !== undefined && line >= 1 && line <= entry.text.split('\n').length;
      const fits = selected.has(file) || selected.size < 64;
      errorLocations.push({ file, line, status: !valid ? 'unresolved' : !fits ? 'selection-budget' : 'resolved' });
      if (!valid || !fits) continue;
      selected.set(file, selected.get(file) ?? 0);
      errorFiles.add(file);
      if (!locations.has(file)) locations.set(file, [line]);
      else if (!locations.get(file)!.includes(line)) locations.get(file)!.push(line);
    }
  }
  const adjacency = new Map<string, Set<string>>();
  for (const edge of indexed.graph.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
    adjacency.get(edge.from)!.add(edge.to.split('#')[0]);
  }
  let dependenciesTruncated = false;
  for (const [file, depth] of selected) {
    if (depth >= dependencyDepth) continue;
    for (const related of adjacency.get(file) ?? []) {
      if (selected.has(related)) continue;
      if (selected.size >= 64) {
        dependenciesTruncated = true;
        continue;
      }
      selected.set(related, depth + 1);
    }
  }
  const priority = (file: string, depth: number) =>
    explicitFiles.has(file) || (locations.has(file) && !errorFiles.has(file))
      ? 0
      : errorFiles.has(file)
        ? 1
        : 2 + depth;
  const ordered = [...selected].sort(
    ([a, da], [b, db]) =>
      priority(a, da) - priority(b, db) ||
      entries.get(b)!.modifiedAtMs - entries.get(a)!.modifiedAtMs ||
      a.localeCompare(b),
  );
  const snippets = (fields.includes('snippets') ? ordered : []).flatMap(([file, depth]) => {
    const entry = entries.get(file)!;
    // An unresolved anchor must not silently become a file-prefix excerpt.
    if (depth === 0 && !explicitFiles.has(file) && !locations.has(file)) return [];
    return (locations.get(file) ?? [1]).map((line) => {
      timeout?.throwIfCancelled();
      timeout?.throwIfExpired();
      let content: string | null = null;
      let complete = false;
      let startLine = locations.has(file) ? Math.max(1, line - 8) : 1;
      let localWindow = false;
      let byteClipped = false;
      if (entry.text !== null) {
        const lines = entry.text.split('\n');
        // Prefer the actual anchor over arbitrarily long preceding lines.
        while (
          locations.has(file) &&
          startLine < line &&
          Buffer.byteLength(lines.slice(startLine - 1, line).join('\n')) > 16384
        )
          startLine++;
        const excerpt = locations.has(file) ? lines.slice(startLine - 1, line + 8).join('\n') : entry.text;
        localWindow = startLine > 1 || (locations.has(file) && line + 8 < lines.length);
        const bytes = Buffer.from(excerpt, 'utf8');
        let end = Math.min(bytes.length, 16384);
        while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
        byteClipped = end < bytes.length;
        content = bytes.subarray(0, end).toString('utf8');
        complete = !localWindow && end === bytes.length;
      }
      return {
        path: file,
        sha256: entry.sha256,
        depth,
        modifiedAtMs: entry.modifiedAtMs,
        priority: priority(file, depth),
        startLine: content === null ? null : startLine,
        endLine: content === null ? null : startLine + content.split('\n').length - 1,
        anchorLine: locations.has(file) ? line : null,
        content,
        complete,
        trimmingReason: complete
          ? null
          : (entry.textOmitted ?? (byteClipped ? 'snippet-byte-budget' : 'anchor-window')),
        clippedBy: [...(localWindow ? ['anchor-window'] : []), ...(byteClipped ? ['snippet-byte-budget'] : [])],
        analysisLevel: 'lexical',
        safeRefactor: false,
      };
    });
  });
  const godot = fields.includes('godot')
    ? {
        path: resolveGodotPath(godotPath),
        version: await getGodotVersion(resolveGodotPath(godotPath), timeout),
      }
    : undefined;
  const scene_tree =
    fields.includes('main_scene') && (scenePath || project.mainScene)
      ? await getSceneTree(root, scenePath || project.mainScene, timeout, { limit: 64, depth: 8 }).catch(
          (error: unknown) => ({
            source: 'REAL',
            status: 'FAIL',
            error: error instanceof Error ? error.message : String(error),
          }),
        )
      : null;
  const git = fields.includes('git') ? await gitSnapshot(root, timeout) : undefined;
  const finalIndex = await (await getProjectIndex(root)).refresh(timeout);
  if (finalIndex.sourceHash !== indexed.sourceHash)
    throw new WheelError('CONFLICT', 'Project changed during context collection');
  const body = {
    schema_version: '0.1',
    source: 'REAL',
    project: { path: root, name: project.name, files: ordered.map(([file]) => file), sourceHash: indexed.sourceHash },
    ...(fields.includes('godot') ? { godot } : {}),
    ...(fields.includes('main_scene') ? { main_scene: { path: scenePath || project.mainScene, scene_tree } } : {}),
    recent_errors: logs.errors,
    errorSegments: logs.segments,
    ...(fields.includes('git') ? { git } : {}),
    ...(fields.includes('active_run')
      ? { active_run: { status: 'unavailable', reason: 'No caller-scoped registered run lookup supplied' } }
      : {}),
    ...(fields.includes('snippets') ? { snippets } : {}),
    selection: {
      taskIntent: taskIntent ?? null,
      intentInterpretation: 'caller-supplied-not-semantic-inference',
      anchors: anchorResults,
      errorLocations,
      errorLocationsTruncated,
      ordering: 'explicit-goals,error-stack,dependency-depth,filesystem-mtime-desc,path',
      omittedFields: CONTEXT_FIELDS.filter((field) => !fields.includes(field)),
      missing,
      dependenciesTruncated,
      insufficient:
        (seeds.length + anchors.length === 0 && !errorFiles.size) ||
        missing.length > 0 ||
        errorLocations.some((location) => location.status !== 'resolved') ||
        anchorResults.some((anchor) => anchor.status !== 'resolved'),
    },
    budget: {
      maxBytes,
      encoding: 'utf8-json',
      tokenizer: 'unavailable',
      tokenCountIsEstimate: true,
      requestedMaxTokens: maxTokens ?? null,
      tokenLimitEnforced: false,
      tokenEstimateMethod: 'compact-utf8-json-bytes/4; not model tokenization',
      estimatedTokens: 0,
      estimateScope: 'whole-context-before-pagination',
      tokenEstimateExceedsRequest: false,
    },
  };
  // Include metadata itself in the estimate; no tokenizer is installed or selected in this runtime.
  for (let n = 0; n < 8; n++) {
    const estimate = Math.ceil(Buffer.byteLength(JSON.stringify(body)) / 4);
    if (estimate === body.budget.estimatedTokens) break;
    body.budget.estimatedTokens = estimate;
    body.budget.tokenEstimateExceedsRequest = maxTokens !== undefined && estimate > maxTokens;
  }
  timeout?.throwIfCancelled();
  timeout?.throwIfExpired();
  return budgetResponse(body, maxBytes);
}

async function gitSnapshot(root: string, timeout?: TimeoutContext) {
  const head = await runGit(root, ['rev-parse', 'HEAD'], timeout);
  const status = await runGit(root, ['status', '--short'], timeout);
  return { head: head.stdout.trim(), status: status.stdout.trim(), source: 'REAL' };
}

async function readRecentErrors(evidenceDir: string, maxBytes: number, timeout?: TimeoutContext) {
  const files = ['stderr.log', 'debug-output.log'];
  const errors: string[] = [];
  const segments: Record<string, unknown>[] = [];
  let remaining = maxBytes;
  let root: string;
  try {
    root = await realpath(evidenceDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {
      errors,
      segments: files.map((file) => ({ file, status: 'missing', reason: 'evidence-directory-missing' })),
    };
  }
  for (const file of files) {
    timeout?.throwIfCancelled();
    timeout?.throwIfExpired();
    const target = path.join(root, file);
    let info;
    try {
      info = await lstat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      segments.push({ file, status: 'missing' });
      continue;
    }
    if (!info.isFile() || info.isSymbolicLink())
      throw new WheelError('FORBIDDEN', 'Context logs must be regular non-link files');
    if (!remaining) {
      segments.push({ file, status: 'omitted', reason: 'log-byte-budget', totalBytes: info.size });
      continue;
    }
    const offset = Math.max(0, info.size - remaining);
    const handle = await open(target, 'r');
    let bytes: Buffer;
    try {
      const current = await handle.stat();
      if (current.ino !== info.ino || current.size !== info.size)
        throw new WheelError('CONFLICT', 'Context log changed before read');
      const buffer = Buffer.alloc(Math.min(remaining, info.size));
      const read = await handle.read(buffer, 0, buffer.length, offset);
      bytes = buffer.subarray(0, read.bytesRead);
      const after = await handle.stat();
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs)
        throw new WheelError('CONFLICT', 'Context log changed during read');
    } finally {
      await handle.close();
    }
    remaining -= bytes.length;
    let start = 0;
    if (offset) while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
    bytes = bytes.subarray(start);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text) errors.push(text);
    segments.push({
      file,
      status: offset + start ? 'partial' : 'complete',
      offset: offset + start,
      bytes: bytes.length,
      totalBytes: info.size,
      mtimeMs: info.mtimeMs,
      segmentSha256: createHash('sha256').update(bytes).digest('hex'),
      trimmingReason: offset + start ? 'log-byte-budget' : null,
    });
  }
  return { errors, segments };
}

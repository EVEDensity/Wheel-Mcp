import path from 'node:path';
import { WheelError } from '../error-schema.js';
import type { TimeoutContext } from '../timeout.js';

export type FileMetadata = {
  analysisLevel: 'lexical';
  symbols: readonly { name: string; kind: string; line: number }[];
  nodes: readonly { name: string; parent: string | null; type: string | null; line: number }[];
  resources: readonly { kind: 'external' | 'internal'; id: string; path: string | null; line: number }[];
  references: readonly { target: string; kind: 'literal' | 'external' | 'internal'; line: number }[];
  declaredUids: readonly string[];
  omittedFromLine: number | null;
};
const MAX_ITEMS = 10000;

/** Lexical context only: strings/comments cannot create symbols; dynamic expressions remain unresolved. */
export function indexFileMetadata(file: string, text: string | null, timeout?: TimeoutContext): FileMetadata {
  const symbols: { name: string; kind: string; line: number }[] = [];
  const nodes: { name: string; parent: string | null; type: string | null; line: number }[] = [];
  const resources: { kind: 'external' | 'internal'; id: string; path: string | null; line: number }[] = [];
  const references: { target: string; kind: 'literal' | 'external' | 'internal'; line: number }[] = [];
  const declaredUids: string[] = [];
  let omittedFromLine: number | null = null;
  const finish = (): FileMetadata =>
    Object.freeze({
      analysisLevel: 'lexical',
      symbols: Object.freeze(symbols.map(Object.freeze)),
      nodes: Object.freeze(nodes.map(Object.freeze)),
      resources: Object.freeze(resources.map(Object.freeze)),
      references: Object.freeze(references.map(Object.freeze)),
      declaredUids: Object.freeze(declaredUids),
      omittedFromLine,
    }) as FileMetadata;
  if (text === null) return finish();
  const ext = path.extname(file).toLowerCase();
  if (ext === '.uid') {
    if (/^uid:\/\/[a-z0-9]+$/.test(text.trim())) declaredUids.push(text.trim());
    return finish();
  }
  if (!['.gd', '.tscn', '.tres', '.godot'].includes(ext)) return finish();
  let triple: string | null = null;
  const lines = text.split('\n');
  for (let number = 0; number < lines.length; number++) {
    timeout?.throwIfCancelled();
    timeout?.throwIfExpired();
    const line = lines[number];
    if (line.length > 65536) {
      omittedFromLine = number + 1;
      // An oversized line can change lexical state; do not invent subsequent declarations.
      break;
    }
    let code = '';
    const literals: { value: string; start: number; end: number }[] = [];
    for (let i = 0; i < line.length; ) {
      if (triple) {
        const end = line.indexOf(triple, i);
        if (end < 0) {
          code += ' '.repeat(line.length - i);
          break;
        }
        code += ' '.repeat(end + 3 - i);
        i = end + 3;
        triple = null;
        continue;
      }
      const char = line[i];
      if (char === '#' || (ext !== '.gd' && char === ';')) break;
      if (char !== '"' && char !== "'") {
        code += char;
        i++;
        continue;
      }
      if (line.slice(i, i + 3) === char.repeat(3)) {
        triple = char.repeat(3);
        code += '   ';
        i += 3;
        continue;
      }
      const start = i++;
      let value = '',
        escaped = false,
        closed = false;
      while (i < line.length) {
        const next = line[i++];
        if (next === '\\') {
          escaped = true;
          if (i < line.length) i++;
          continue;
        }
        if (next === char) {
          closed = true;
          break;
        }
        value += next;
      }
      code += ' '.repeat(i - start);
      if (closed && !escaped) literals.push({ value, start, end: i });
    }
    const lineNumber = number + 1;
    if (ext === '.gd') {
      const symbol =
        /^\s*(?:@\w+(?:\([^\n]*\))?\s+)*(?:(?:static|@onready)\s+)?(func|var|const|signal|class_name|class|enum)\s+([A-Za-z_]\w*)/.exec(
          code,
        );
      if (symbol) symbols.push({ kind: symbol[1], name: symbol[2], line: lineNumber });
    }
    const header = ext !== '.gd' ? /^\s*\[(node|ext_resource|sub_resource|gd_scene|gd_resource)\b/.exec(code) : null;
    const attr = (name: string) =>
      literals.find((literal) => new RegExp(`\\b${name}=\\s*$`).test(code.slice(0, literal.start)))?.value ?? null;
    if (header?.[1] === 'node' && attr('name'))
      nodes.push({ name: attr('name')!, parent: attr('parent'), type: attr('type'), line: lineNumber });
    if (header?.[1] === 'ext_resource' || header?.[1] === 'sub_resource') {
      const id = attr('id') ?? /\bid=(\d+)\b/.exec(code)?.[1];
      if (id)
        resources.push({
          kind: header[1] === 'ext_resource' ? 'external' : 'internal',
          id,
          path: attr('path'),
          line: lineNumber,
        });
    }
    const declared = header && ['gd_scene', 'gd_resource'].includes(header[1]) ? attr('uid') : null;
    if (declared && /^uid:\/\/[a-z0-9]+$/.test(declared)) declaredUids.push(declared);
    for (const literal of literals) {
      if (literal.value.startsWith('res://') || literal.value.startsWith('uid://')) {
        // Header UID declares identity, not a dependency on itself.
        if (!(declared === literal.value && /\buid=\s*$/.test(code.slice(0, literal.start))))
          references.push({ target: literal.value, kind: 'literal', line: lineNumber });
      } else {
        const before = code.slice(Math.max(0, literal.start - 64), literal.start);
        const resource = /\b(ExtResource|SubResource)\(\s*$/.exec(before);
        if (resource)
          references.push({
            target: literal.value,
            kind: resource[1] === 'ExtResource' ? 'external' : 'internal',
            line: lineNumber,
          });
      }
    }
    if (symbols.length + nodes.length + resources.length + references.length + declaredUids.length > MAX_ITEMS)
      throw new WheelError('UNSUPPORTED', 'File metadata item budget exceeded', { file });
  }
  return finish();
}

export type DependencyGraph = {
  analysisLevel: 'lexical';
  safeRefactor: false;
  edges: readonly { from: string; to: string; kind: string; line: number }[];
  reverse: readonly { target: string; sources: readonly string[] }[];
  unresolved: readonly { from: string; target: string; reason: string; line: number }[];
};

export function buildDependencyGraph(
  files: readonly { path: string; metadata: FileMetadata }[],
  timeout?: TimeoutContext,
): DependencyGraph {
  const paths = new Set(files.map((file) => file.path));
  const uids = new Map<string, Set<string>>();
  for (const file of files)
    for (const uid of file.metadata.declaredUids) {
      const target = file.path.endsWith('.uid') ? file.path.slice(0, -4) : file.path;
      if (!uids.has(uid)) uids.set(uid, new Set());
      uids.get(uid)!.add(target);
    }
  const edges: { from: string; to: string; kind: string; line: number }[] = [];
  const unresolved: { from: string; target: string; reason: string; line: number }[] = [];
  for (const file of files) {
    timeout?.throwIfCancelled();
    timeout?.throwIfExpired();
    const internal = new Map<string, number>();
    const external = new Map<string, { count: number; path: string | null }>();
    for (const resource of file.metadata.resources) {
      if (resource.kind === 'internal') internal.set(resource.id, (internal.get(resource.id) ?? 0) + 1);
      else {
        const previous = external.get(resource.id);
        external.set(resource.id, { count: (previous?.count ?? 0) + 1, path: resource.path });
      }
    }
    for (const ref of file.metadata.references) {
      let target = ref.target;
      let reason: string | undefined;
      if (ref.kind === 'internal') {
        if (internal.get(target) === 1) target = `${file.path}#subresource:${target}`;
        else reason = 'missing-or-ambiguous-internal-resource';
      } else {
        if (ref.kind === 'external') {
          const match = external.get(target);
          if (match?.count === 1 && match.path) target = match.path;
          else reason = 'missing-or-ambiguous-external-resource';
        }
        if (!reason && target.startsWith('uid://')) {
          const matches = uids.get(target);
          if (matches?.size === 1) target = [...matches][0];
          else reason = matches ? 'ambiguous-uid' : 'unresolved-uid';
        } else if (!reason && target.startsWith('res://')) {
          const relative = target.slice(6);
          if (
            relative.includes('\\') ||
            relative.includes('\0') ||
            relative.startsWith('/') ||
            relative.split('/').includes('..')
          )
            reason = 'unsafe-resource-path';
          else target = path.posix.normalize(relative);
        }
        if (!reason && !paths.has(target)) reason = 'missing-project-resource';
      }
      if (reason) unresolved.push({ from: file.path, target: ref.target, reason, line: ref.line });
      else edges.push({ from: file.path, to: target, kind: ref.kind, line: ref.line });
      if (edges.length + unresolved.length > 100000)
        throw new WheelError('UNSUPPORTED', 'Project dependency graph exceeds budget');
    }
  }
  const reverse = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!reverse.has(edge.to)) reverse.set(edge.to, new Set());
    reverse.get(edge.to)!.add(edge.from);
  }
  return Object.freeze({
    analysisLevel: 'lexical',
    safeRefactor: false,
    edges: Object.freeze(edges.map(Object.freeze)),
    unresolved: Object.freeze(unresolved.map(Object.freeze)),
    reverse: Object.freeze(
      [...reverse].map(([target, sources]) => Object.freeze({ target, sources: Object.freeze([...sources].sort()) })),
    ),
  }) as DependencyGraph;
}

import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export type ProjectPathMode = 'read' | 'write';
export type ProjectPathOptions = {
  mode: ProjectPathMode;
  allowAbsolute?: boolean;
  allowUid?: boolean;
};
export type ResolvedProjectPath = { root: string; absolutePath: string; relativePath: string; resourcePath: string };

const protectedNames = new Set(['.git', '.godot', '.harness']);
const unsafeComponent = (part: string): boolean =>
  !part ||
  part === '.' ||
  part === '..' ||
  part.includes(':') ||
  /[. ]$/.test(part) ||
  // eslint-disable-next-line no-control-regex
  /[\x00-\x1f\x7f]/.test(part);

/** Pure syntax check shared by MCP authorization and the file resolver. */
export function projectRelativePath(input: string, mode: ProjectPathMode): string {
  if (
    typeof input !== 'string' ||
    !input ||
    input.includes('\\') ||
    path.isAbsolute(input) ||
    path.win32.isAbsolute(input)
  )
    throw new Error('unsafe path: must be project-relative or res://');
  const relative = input.startsWith('res://') ? input.slice(6) : input;
  if (relative.startsWith('/') || relative.startsWith('uid://') || relative.split('/').some(unsafeComponent))
    throw new Error('unsafe project path');
  if (relative.split('/').some((part) => protectedNames.has(part.toLowerCase())))
    throw new Error(`unsafe protected project path for ${mode}`);
  return relative;
}

function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function fileHeader(file: string): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Resolve only UIDs that occur in actual Godot resource metadata, never as a filesystem string. */
async function mapUid(root: string, uid: string): Promise<string> {
  if (!/^uid:\/\/[A-Za-z0-9_]+$/.test(uid)) throw new Error('invalid Godot UID');
  const stack = [''];
  const matches: string[] = [];
  let scanned = 0;
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
      if (++scanned > 10000) throw new Error('UID lookup exceeded project scan budget');
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const relative = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(relative);
        continue;
      }
      if (!entry.isFile()) continue;
      if (/\.gd\.uid$/i.test(entry.name)) {
        if ((await fileHeader(path.join(root, relative))).trim() === uid) matches.push(relative.slice(0, -4));
      } else if (/\.(?:tscn|tres)$/i.test(entry.name)) {
        const header = await fileHeader(path.join(root, relative));
        if (/^\[gd_(?:scene|resource)\b[^\]\r\n]*\buid="([^"]+)"/.exec(header)?.[1] === uid) matches.push(relative);
      }
    }
  }
  if (matches.length !== 1) throw new Error(matches.length ? 'ambiguous Godot UID' : 'Godot UID not found');
  return matches[0];
}

/**
 * Resolve one existing file or a new file under an existing parent. No implicit mkdir.
 * Links/junctions are rejected component-by-component. This is a policy check, not an OS sandbox:
 * callers must keep projects local/trusted because a hostile process can swap a path after validation.
 */
export async function resolveProjectPath(
  projectRoot: string,
  input: string,
  options: ProjectPathOptions,
): Promise<ResolvedProjectPath> {
  if (!projectRoot || typeof input !== 'string') throw new Error('project path is required');
  const rootInput = path.resolve(projectRoot);
  if (process.platform === 'win32' && rootInput.startsWith('\\\\')) throw new Error('UNC project roots are disabled');
  const root = await realpath(rootInput);
  if (!(await lstat(root)).isDirectory()) throw new Error('project root is not a directory');
  let relative: string;
  if (input.startsWith('uid://')) {
    if (options.mode !== 'read' || !options.allowUid) throw new Error('UID writes are not supported');
    relative = projectRelativePath(await mapUid(root, input), options.mode);
  } else if (path.isAbsolute(input) || path.win32.isAbsolute(input)) {
    if (!options.allowAbsolute || input.startsWith('\\\\') || !path.isAbsolute(input))
      throw new Error('absolute project path is not approved');
    const absolute = path.resolve(input);
    const base = contained(root, absolute) ? root : rootInput;
    const fromOriginalRoot = path.relative(base, absolute);
    if (!contained(base, absolute) || !fromOriginalRoot) throw new Error('path must remain inside projectPath');
    relative = projectRelativePath(fromOriginalRoot.split(path.sep).join('/'), options.mode);
  } else relative = projectRelativePath(input, options.mode);
  let current = root;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index++) {
    const name = parts[index];
    const names = await readdir(current);
    if (
      process.platform === 'win32' &&
      names.some((present) => present.toLowerCase() === name.toLowerCase()) &&
      !names.includes(name)
    )
      throw new Error('project path casing does not match disk');
    const target = path.join(current, name);
    if (!contained(root, target)) throw new Error('path must remain inside projectPath');
    const final = index === parts.length - 1;
    if (!names.includes(name)) {
      if (final && options.mode === 'write') {
        current = target;
        break;
      }
      throw new Error('project path does not exist');
    }
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) throw new Error('project links and junctions are forbidden');
    if (final) {
      if (!metadata.isFile()) throw new Error('project path must reference a regular file');
      if (options.mode === 'write' && metadata.nlink > 1) throw new Error('hard-linked project writes are forbidden');
    } else if (!metadata.isDirectory()) throw new Error('project parent is not a directory');
    const canonical = await realpath(target);
    if (
      !contained(root, canonical) ||
      (process.platform === 'win32' ? canonical.toLowerCase() !== target.toLowerCase() : canonical !== target)
    )
      throw new Error('project path is noncanonical');
    current = target;
  }
  return { root, absolutePath: current, relativePath: relative, resourcePath: `res://${relative}` };
}

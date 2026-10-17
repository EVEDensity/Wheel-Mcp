import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolveProjectPath } from '../project/paths.js';
import { WheelError } from '../error-schema.js';

/** Reads bounded bytes only; native copy parsing never invokes ResourceLoader. */
export async function readAnimationSource(projectPath: string, path: string, expected: string) {
  let resolved;
  try {
    resolved = await resolveProjectPath(projectPath, path, { mode: 'read' });
  } catch (error) {
    throw new WheelError('FORBIDDEN', 'Unsafe animation source path', { cause: (error as Error).message });
  }
  const info = await lstat(resolved.absolutePath);
  if (!info.isFile() || info.nlink !== 1 || !resolved.relativePath.endsWith('.tres'))
    throw new WheelError('FORBIDDEN', 'Animation source must be an unlinked local .tres file');
  if (info.size > 16384) throw new WheelError('UNSUPPORTED', 'Animation source exceeds 16 KiB');
  const bytes = await readFile(resolved.absolutePath);
  if (bytes.length > 16384 || createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new WheelError('CONFLICT', 'Animation source changed');
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new WheelError('UNSUPPORTED', 'Animation source must be UTF-8');
  }
  return { resourcePath: resolved.resourcePath };
}

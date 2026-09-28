import { lstat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolveProjectPath } from '../project/paths.js';
import { WheelError } from '../error-schema.js';

/** Native grammar checks do not replace host path/link checks or dependency CAS. */
export async function verifySceneDependencies(
  projectPath: string,
  hashes: Record<string, string>,
  signal?: AbortSignal,
) {
  if (Object.keys(hashes).length > 32) throw new WheelError('UNSUPPORTED', 'Scene dependency budget exceeded');
  for (const [resourcePath, expected] of Object.entries(hashes)) {
    signal?.throwIfAborted();
    const resolved = await resolveProjectPath(projectPath, resourcePath, { mode: 'read' });
    const info = await lstat(resolved.absolutePath);
    if (
      !resourcePath.startsWith('res://') ||
      !resourcePath.endsWith('.tscn') ||
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size > 65536
    )
      throw new WheelError('FORBIDDEN', 'Linked, non-scene or oversized native dependency');
    if (
      createHash('sha256')
        .update(await readFile(resolved.absolutePath))
        .digest('hex') !== expected
    )
      throw new WheelError('CONFLICT', 'Native scene dependency changed', { resourcePath });
  }
}

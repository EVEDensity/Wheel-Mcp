import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { WheelError } from './error-schema.js';
import type { TimeoutContext } from './timeout.js';

const EXCLUDED_DIRECTORIES = new Set(['.git', '.godot', '.harness', 'node_modules']);
const MAX_FILES = 20_000;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 256 * 1024 * 1024;

export type ProjectSnapshot = {
  sha256: string;
  fileCount: number;
  totalBytes: number;
  files: Array<{ path: string; sha256: string; bytes: number }>;
};

/** Hash real project inputs, including scripts, scenes, autoload configuration and imported source assets. */
export async function snapshotProject(
  projectPath: string,
  timeout?: TimeoutContext,
  excludedPaths: readonly string[] = [],
  ignoreGeneratedSidecars = false,
): Promise<ProjectSnapshot> {
  const root = await realpath(projectPath);
  const key = (candidate: string) => (process.platform === 'win32' ? candidate.toLowerCase() : candidate);
  const excluded = new Set(
    await Promise.all(
      excludedPaths.map(async (candidate) => key(await realpath(candidate).catch(() => path.resolve(candidate)))),
    ),
  );
  if (excluded.has(key(root))) throw new WheelError('INVALID_ARGUMENT', 'snapshot evidence cannot be the project root');
  const files: ProjectSnapshot['files'] = [];
  let totalBytes = 0;
  async function walk(directory: string): Promise<void> {
    timeout?.throwIfCancelled();
    timeout?.throwIfExpired();
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (excluded.has(key(file))) continue;
      if (ignoreGeneratedSidecars && (/\.gd\.uid$/i.test(entry.name) || /\.import$/i.test(entry.name))) continue;
      if (entry.isSymbolicLink())
        throw new WheelError('UNSUPPORTED', `project snapshot cannot verify a symlink: ${entry.name}`);
      if (entry.isDirectory()) {
        await walk(file);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= MAX_FILES) throw new WheelError('UNSUPPORTED', 'project snapshot exceeds file count limit');
      const before = await lstat(file);
      if (before.size > MAX_FILE_BYTES || totalBytes + before.size > MAX_TOTAL_BYTES)
        throw new WheelError('UNSUPPORTED', 'project snapshot exceeds byte limit');
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(file)) {
        timeout?.throwIfCancelled();
        timeout?.throwIfExpired();
        digest.update(chunk as Buffer);
      }
      const after = await lstat(file);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
        throw new WheelError('CONFLICT', `project input changed during snapshot: ${entry.name}`);
      totalBytes += after.size;
      files.push({
        path: path.relative(root, file).split(path.sep).join('/'),
        sha256: digest.digest('hex'),
        bytes: after.size,
      });
    }
  }
  await walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const sha256 = createHash('sha256')
    .update(JSON.stringify(files.map(({ path: file, sha256: hash, bytes }) => [file, hash, bytes])))
    .digest('hex');
  return { sha256, fileCount: files.length, totalBytes, files };
}

import path from 'node:path';
import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { WheelError } from './error-schema.js';

export type VisualBaselineBinding = { path: string; sha256: string; bytes: number };
const MAX_BASELINE_BYTES = 32 * 1024 * 1024;

/** Read a bounded ordinary file through one handle; never treat a path as its content identity. */
export async function readVisualBaseline(file: string) {
  const absolute = path.resolve(file);
  const before = await lstat(absolute);
  if (!before.isFile() || before.isSymbolicLink())
    throw new WheelError('FORBIDDEN', 'Visual baseline must be an ordinary file');
  if (before.size === 0 || before.size > MAX_BASELINE_BYTES)
    throw new WheelError('INVALID_ARGUMENT', 'Visual baseline must be 1..32MiB');
  const handle = await open(absolute, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size)
      throw new WheelError('CONFLICT', 'Visual baseline changed while opening');
    // Bounded even if another process grows the file after stat.
    const buffer = Buffer.alloc(opened.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(absolute);
    if (
      length !== opened.size ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      current.size !== opened.size ||
      current.mtimeMs !== after.mtimeMs ||
      current.ctimeMs !== after.ctimeMs
    )
      throw new WheelError('CONFLICT', 'Visual baseline changed while reading');
    const bytes = buffer.subarray(0, length);
    const binding: VisualBaselineBinding = {
      path: absolute,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: length,
    };
    return { binding, bytes };
  } finally {
    await handle.close();
  }
}

export async function assertVisualBaseline(binding: VisualBaselineBinding) {
  const current = (await readVisualBaseline(binding.path)).binding;
  if (current.sha256 !== binding.sha256 || current.bytes !== binding.bytes)
    throw new WheelError('CONFLICT', 'Visual baseline differs from approved content');
}

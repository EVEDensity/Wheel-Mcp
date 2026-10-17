import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolveProjectPath } from '../project/paths.js';
import { WheelError } from '../error-schema.js';
import { decodePng } from '../godot-development.js';

/** Closed first PNG profile: no importer, color-profile, animation or host-path loading. */
export function validateTexturePng(bytes: Buffer) {
  if (
    bytes.length < 57 ||
    bytes.length > 16384 ||
    bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new WheelError('INVALID_ARGUMENT', 'Texture PNG must have a valid header and be at most 16 KiB');
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (
    width < 1 ||
    height < 1 ||
    width > 32 ||
    height > 32 ||
    bytes[24] !== 8 ||
    ![2, 6].includes(bytes[25]) ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    bytes[28] !== 0
  )
    throw new WheelError('UNSUPPORTED', 'Texture PNG requires 1..32, non-interlaced 8-bit RGB/RGBA');
  let position = 8,
    idat = false,
    ended = false;
  while (position < bytes.length) {
    if (position + 12 > bytes.length) throw new WheelError('INVALID_ARGUMENT', 'Truncated PNG chunk');
    const length = bytes.readUInt32BE(position),
      kind = bytes.toString('ascii', position + 4, position + 8);
    if (length > bytes.length - position - 12) throw new WheelError('INVALID_ARGUMENT', 'Truncated PNG chunk data');
    if (!['IHDR', 'IDAT', 'IEND'].includes(kind))
      throw new WheelError('UNSUPPORTED', 'PNG metadata/profiles/animation are outside this profile');
    if (kind === 'IHDR' && position !== 8) throw new WheelError('INVALID_ARGUMENT', 'Duplicate PNG header');
    if (kind === 'IDAT') {
      if (ended) throw new WheelError('INVALID_ARGUMENT', 'PNG data after end');
      idat = true;
    }
    position += length + 12;
    if (kind === 'IEND') {
      if (length !== 0 || !idat || position !== bytes.length)
        throw new WheelError('INVALID_ARGUMENT', 'Invalid PNG end');
      ended = true;
    }
  }
  if (!ended) throw new WheelError('INVALID_ARGUMENT', 'Missing PNG end');
  try {
    return decodePng(bytes);
  } catch (error) {
    throw new WheelError('INVALID_ARGUMENT', 'PNG CRC, scanlines or compressed data are invalid', {
      cause: (error as Error).message,
    });
  }
}

export async function readTexturePng(projectPath: string, input: string, expected: string) {
  let resolved;
  try {
    resolved = await resolveProjectPath(projectPath, input, { mode: 'read' });
  } catch {
    throw new WheelError('FORBIDDEN', 'Unsafe PNG source path');
  }
  if (!resolved.resourcePath.endsWith('.png'))
    throw new WheelError('UNSUPPORTED', 'Only project PNG source snapshots are declared');
  const before = await lstat(resolved.absolutePath).catch(() => undefined);
  if (!before) throw new WheelError('NOT_FOUND', 'PNG source is missing');
  if (!before.isFile() || before.nlink !== 1 || before.size > 16384)
    throw new WheelError('FORBIDDEN', 'Linked, non-file or oversized PNG source');
  const bytes = await readFile(resolved.absolutePath);
  const after = await lstat(resolved.absolutePath);
  if (
    !after.isFile() ||
    after.nlink !== 1 ||
    before.ino !== after.ino ||
    before.dev !== after.dev ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  )
    throw new WheelError('CONFLICT', 'PNG source changed while reading');
  if (createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new WheelError('CONFLICT', 'PNG source fingerprint changed');
  return { resourcePath: resolved.resourcePath, bytes, image: validateTexturePng(bytes) };
}

import { WheelError } from '../error-schema.js';
import { EditorBridge } from '../editor/editor-bridge.js';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveProjectPath } from './paths.js';
import { writeValidatedProjectFiles, type ValidatedWriteOptions } from './validated-write.js';

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PNG_BYTES = 2 * 1024 * 1024;

/** Limited, content-addressed PNG ingress. No arbitrary host-path reads or importer overrides. */
export async function importProjectPng(
  projectPath: string,
  filePath: string,
  dataBase64: string,
  expectedSha256: string | null,
  options: ValidatedWriteOptions = {},
) {
  if (!filePath.endsWith('.png'))
    throw new WheelError('UNSUPPORTED', 'Only PNG source textures are supported by this import profile');
  const target = await resolveProjectPath(projectPath, filePath, { mode: 'write' });
  if (
    typeof dataBase64 !== 'string' ||
    dataBase64.length > Math.ceil(MAX_PNG_BYTES / 3) * 4 + 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataBase64)
  )
    throw new WheelError('INVALID_ARGUMENT', 'Asset must be strict base64 and no larger than 2 MiB');
  const bytes = Buffer.from(dataBase64, 'base64');
  if (
    bytes.length < 33 ||
    bytes.length > MAX_PNG_BYTES ||
    !bytes.subarray(0, 8).equals(PNG_MAGIC) ||
    bytes.toString('ascii', 12, 16) !== 'IHDR' ||
    bytes.readUInt32BE(8) !== 13
  )
    throw new WheelError('INVALID_ARGUMENT', 'Invalid PNG signature or IHDR');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096)
    throw new WheelError('UNSUPPORTED', 'PNG dimensions must be within 1..4096 pixels');
  const saved = await writeValidatedProjectFiles(
    projectPath,
    [{ path: target.relativePath, content: bytes, expectedSha256 }],
    {
      ...options,
      validationMode: 'engine',
      intent: `PNG IMPORT: native isolated Godot editor import/load before exact approved byte write. ${options.intent ?? ''}`,
    },
  );
  // The commit is durable at this point. Editor synchronization is reported separately;
  // a late editor failure must never be represented as a disk rollback.
  let bridge: EditorBridge | undefined;
  let observations = 0;
  let progress = 0;
  try {
    bridge = await EditorBridge.connect({
      projectPath,
      ownerId: options.ownerId ?? 'local-library',
      timeoutMs: Math.min(options.timeoutMs ?? 5000, 5000),
      signal: options.signal,
    });
    if (!bridge.identity.capabilities.includes('asset.import/v1'))
      throw new WheelError('UNSUPPORTED', 'Editor plugin lacks asset import observation capability');
    await bridge.sceneRequest('asset.scan', { path: target.resourcePath }, options);
    const deadline = Date.now() + Math.min(options.timeoutMs ?? 10000, 10000);
    do {
      options.signal?.throwIfAborted();
      const state = await bridge.sceneRequest('asset.status', { path: target.resourcePath }, options);
      if (!state || typeof state !== 'object') throw new WheelError('PROTOCOL_MISMATCH', 'Invalid asset import state');
      const status = state as Record<string, unknown>;
      observations++;
      if (typeof status.progress === 'number' && Number.isFinite(status.progress))
        progress = Math.max(progress, status.progress);
      if (status.status === 'FAIL')
        throw new WheelError('VALIDATION_FAILED', String(status.message ?? 'Editor asset import failed'));
      if (
        status.status !== 'PASS' ||
        typeof status.scanning !== 'boolean' ||
        typeof status.importing !== 'boolean' ||
        typeof status.fileType !== 'string' ||
        typeof status.ready !== 'boolean'
      )
        throw new WheelError('PROTOCOL_MISMATCH', 'Invalid asset import status fields');
      if (status.ready && !status.scanning && !status.importing)
        return {
          ...saved,
          editorSynchronization: {
            status: 'OBSERVED',
            fileType: status.fileType,
            sessionId: bridge.identity.sessionId,
            observations,
            progress,
          },
        };
      await delay(25, undefined, { signal: options.signal });
    } while (Date.now() < deadline);
    return {
      ...saved,
      editorSynchronization: { status: 'NOT_OBSERVED', reason: 'Editor import completion deadline reached' },
    };
  } catch (error) {
    return {
      ...saved,
      editorSynchronization: {
        status: 'NOT_OBSERVED',
        reason: (error as Error).message,
      },
    };
  } finally {
    bridge?.close();
  }
}

import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { EditorBridge } from './editor-bridge.js';
import { WheelError, isStableErrorCode } from '../error-schema.js';
import { writeValidatedProjectFiles, type ValidatedWriteOptions } from '../project/validated-write.js';
import { resolveProjectPath } from '../project/paths.js';
import { verifySceneDependencies } from './scene-dependencies.js';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const exportedSchema = z.object({
  status: z.literal('PASS'),
  operationId: z.string(),
  projectPath: z.string(),
  projectId: z.string(),
  sessionId: z.string(),
  ownerId: z.string(),
  scenePath: z.string(),
  documentHash: hash,
  historyVersion: z.number().int().nonnegative(),
  sourceHash: hash,
  dependencyHashes: z.record(z.string().max(512), hash).refine((value) => Object.keys(value).length <= 32),
  contentHash: hash,
  planHash: hash,
  content: z.string().max(24000),
});
function response(value: unknown) {
  if (!value || typeof value !== 'object') throw new WheelError('PROTOCOL_MISMATCH', 'Invalid scene save response');
  const result = value as Record<string, unknown>;
  if (result.status === 'FAIL')
    throw new WheelError(
      isStableErrorCode(result.code) ? result.code : 'PROTOCOL_MISMATCH',
      String(result.message),
      result,
    );
  return result;
}
export async function saveEditorScene(options: ValidatedWriteOptions & { projectPath: string; ownerId: string }) {
  const bridge = await EditorBridge.connect(options),
    operationId = options.operationId ?? randomUUID();
  let saved: Awaited<ReturnType<typeof writeValidatedProjectFiles>> | undefined;
  try {
    if (!bridge.identity.capabilities.includes('scene.export'))
      throw new WheelError('FORBIDDEN', 'Native editor save requires independent private write opt-in');
    if (!bridge.identity.capabilities.includes('scene.dependencies/v1'))
      throw new WheelError('PROTOCOL_MISMATCH', 'Editor plugin lacks dependency-bound native save; upgrade explicitly');
    const raw = response(await bridge.sceneRequest('scene.export', { operationId }, options));
    const exported = exportedSchema.parse(raw);
    if (
      exported.ownerId !== options.ownerId ||
      exported.sessionId !== bridge.identity.sessionId ||
      exported.projectId !== bridge.identity.projectId ||
      exported.projectPath !== bridge.identity.projectPath ||
      createHash('sha256').update(exported.content).digest('hex') !== exported.contentHash
    )
      throw new WheelError('PROTOCOL_MISMATCH', 'Native scene export binding mismatch');
    const target = await resolveProjectPath(options.projectPath, exported.scenePath, { mode: 'write' });
    await verifySceneDependencies(options.projectPath, exported.dependencyHashes, options.signal);
    saved = await writeValidatedProjectFiles(
      options.projectPath,
      [{ path: target.relativePath, content: exported.content, expectedSha256: exported.sourceHash }],
      {
        ...options,
        operationId,
        intent: `NATIVE SAVE: session=${exported.sessionId}; document=${exported.documentHash}; history=${exported.historyVersion}; nativePlan=${exported.planHash}; dependencies=${JSON.stringify(exported.dependencyHashes)}. Dirty marker retained; no automatic document reload.`,
        validationMode: 'engine',
        allowDirtyScene: true,
        beforeApply: async () => {
          await verifySceneDependencies(options.projectPath, exported.dependencyHashes, options.signal);
          response(await bridge.sceneRequest('scene.verify', { operationId, planHash: exported.planHash }, options));
          await options.beforeApply?.(options.signal);
        },
      },
    );
    let synchronization: Record<string, unknown>;
    try {
      response(await bridge.sceneRequest('scene.notify', { operationId, planHash: exported.planHash }, options));
      const deadline = Date.now() + Math.min(options.timeoutMs ?? 5000, 5000);
      do {
        options.signal?.throwIfAborted();
        const observed = response(
          await bridge.sceneRequest('scene.observe', { operationId, planHash: exported.planHash }, options),
        );
        if (observed.observed === true) {
          synchronization = observed;
          return {
            ...saved,
            plane: 'editor',
            scenePath: exported.scenePath,
            sessionId: exported.sessionId,
            synchronization,
            dirtyState: 'RETAINED',
          };
        }
        await delay(25, undefined, { signal: options.signal });
      } while (Date.now() < deadline);
      synchronization = { status: 'NOT_OBSERVED', reason: 'Filesystem completion was not observed before deadline' };
    } catch (error) {
      synchronization = { status: 'NOT_OBSERVED', reason: (error as Error).message };
    }
    return {
      ...saved,
      plane: 'editor',
      scenePath: exported.scenePath,
      sessionId: exported.sessionId,
      synchronization,
      dirtyState: 'RETAINED',
    };
  } catch (error) {
    // A disk commit cannot be undone by a later transport/notification failure.
    if (saved)
      return {
        ...saved,
        plane: 'editor',
        synchronization: { status: 'NOT_OBSERVED', reason: (error as Error).message },
        dirtyState: 'RETAINED',
      };
    throw error;
  } finally {
    bridge.close();
  }
}

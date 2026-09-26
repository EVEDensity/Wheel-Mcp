import { z } from 'zod';
import { EditorBridge } from './editor-bridge.js';
import { WheelError, isStableErrorCode } from '../error-schema.js';
import { resolveProjectPath } from '../project/paths.js';
import { writeProjectText, type ProjectWriteOptions } from '../project/write-file.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
export const resourceTypes = [
  'StandardMaterial3D',
  'ShaderMaterial',
  'PhysicsMaterial',
  'BoxShape3D',
  'SphereShape3D',
  'CapsuleShape3D',
  'CylinderShape3D',
  'RectangleShape2D',
  'CircleShape2D',
  'CapsuleShape2D',
  'BoxMesh',
  'SphereMesh',
] as const;
export const resourceRefSchema = z
  .object({
    type: z.literal('ResourceRef'),
    handle: z.string().regex(/^[a-f0-9]{32}$/),
    resourceType: z.enum(resourceTypes),
    projectId: z.string().min(1).max(80),
    sessionId: z.string().regex(/^[a-f0-9]{32}$/),
    ownerId: z.string().min(1).max(80),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const typed = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('Color'),
      r: z.number().finite().min(0).max(1),
      g: z.number().finite().min(0).max(1),
      b: z.number().finite().min(0).max(1),
      a: z.number().finite().min(0).max(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('Vector2'),
      x: z.number().finite().positive().max(1000000),
      y: z.number().finite().positive().max(1000000),
    })
    .strict(),
  z
    .object({
      type: z.literal('Vector3'),
      x: z.number().finite().positive().max(1000000),
      y: z.number().finite().positive().max(1000000),
      z: z.number().finite().positive().max(1000000),
    })
    .strict(),
]);
export const resourcePropertiesSchema = z
  .record(z.string().min(1).max(80), z.union([z.boolean(), z.number().finite(), typed]))
  .refine((v) => Object.keys(v).length <= 8, 'Resource property budget exceeded');
export const resourcePropertySchema = z.enum(['material_override', 'mesh', 'shape', 'physics_material_override']);
export const resourceRequestSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('create'), resourceType: z.enum(resourceTypes), properties: resourcePropertiesSchema })
    .strict(),
  z
    .object({ action: z.literal('reference'), path: z.string().min(1).max(512), property: resourcePropertySchema })
    .strict(),
  z.object({ action: z.literal('read'), ref: resourceRefSchema }).strict(),
  z.object({ action: z.literal('duplicate'), ref: resourceRefSchema }).strict(),
  z.object({ action: z.literal('release'), ref: resourceRefSchema }).strict(),
  z
    .object({
      action: z.literal('export'),
      ref: resourceRefSchema,
      uid: z
        .string()
        .regex(/^uid:\/\/[a-zA-Z0-9_]{1,32}$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('adopt'),
      path: z.string().min(1).max(512),
      sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
export async function manageEditorResource(options: {
  projectPath: string;
  ownerId: string;
  request: z.infer<typeof resourceRequestSchema>;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const request = resourceRequestSchema.parse(options.request);
  const bridge = await EditorBridge.connect(options);
  try {
    const value = (await bridge.sceneRequest('resource.manage', request, options)) as Record<string, unknown>;
    if (!value || typeof value !== 'object') throw new WheelError('PROTOCOL_MISMATCH', 'Malformed resource response');
    if (value.status === 'FAIL')
      throw new WheelError(
        isStableErrorCode(value.code) ? value.code : 'PROTOCOL_MISMATCH',
        String(value.message),
        value,
      );
    if (value.ref) {
      const ref = resourceRefSchema.parse(value.ref);
      if (
        ref.ownerId !== options.ownerId ||
        ref.projectId !== bridge.identity.projectId ||
        ref.sessionId !== bridge.identity.sessionId
      )
        throw new WheelError('PROTOCOL_MISMATCH', 'Resource response scope mismatch');
    }
    return value;
  } finally {
    bridge.close();
  }
}

/** Engine-native bytes staged internally; exact host approval and CAS before public .tres mutation. */
export async function saveEditorResource(
  options: {
    projectPath: string;
    ownerId: string;
    ref: z.infer<typeof resourceRefSchema>;
    filePath: string;
    timeoutMs?: number;
  } & ProjectWriteOptions,
): Promise<Record<string, unknown>> {
  const target = await resolveProjectPath(options.projectPath, options.filePath, { mode: 'write' });
  if (!target.relativePath.endsWith('.tres'))
    throw new WheelError('INVALID_ARGUMENT', 'Native resource save requires .tres');
  const previous = await readFile(target.absolutePath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const uid = previous?.match(/^\[gd_resource[^\]\r\n]*\buid="(uid:\/\/[a-zA-Z0-9_]{1,32})"/m)?.[1];
  const exported = await manageEditorResource({ ...options, request: { action: 'export', ref: options.ref, uid } });
  const content = exported.content;
  if (typeof content !== 'string' || createHash('sha256').update(content).digest('hex') !== exported.sourceHash)
    throw new WheelError('PROTOCOL_MISMATCH', 'Native resource export hash mismatch');
  const saved = await writeProjectText(options.projectPath, target.relativePath, content, {
    ...options,
    expectedSha256:
      options.expectedSha256 === undefined
        ? previous === null
          ? null
          : createHash('sha256').update(previous).digest('hex')
        : options.expectedSha256,
  });
  // Adoption is non-mutating. A post-commit read failure must never be mistaken for rollback.
  let reference: Record<string, unknown> | undefined;
  let referenceError: string | undefined;
  try {
    reference = await manageEditorResource({
      ...options,
      request: { action: 'adopt', path: target.resourcePath, sourceHash: exported.sourceHash as string },
    });
  } catch (error) {
    referenceError = (error as Error).message;
  }
  return {
    status: 'PASS',
    source: 'REAL',
    ...saved,
    persisted: true,
    validation: 'PASS',
    validationScope: 'native ResourceSaver export roundtrip + exact byte readback; not runtime/render validation',
    resourceType: exported.resourceType,
    sourceHash: exported.sourceHash,
    ref: reference?.ref,
    referenceError,
  };
}

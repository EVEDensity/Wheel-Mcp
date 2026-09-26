import { randomUUID, createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolveProjectPath } from '../project/paths.js';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { EditorBridge } from './editor-bridge.js';
import { WheelError, isStableErrorCode } from '../error-schema.js';
import { resourceRefSchema, resourcePropertySchema, resourcePropertiesSchema } from './resource-service.js';

const nodePath = z.string().min(1).max(512);
const name = z.string().min(1).max(80);
const vector = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Vector2'), x: z.number().finite(), y: z.number().finite() }).strict(),
  z
    .object({ type: z.literal('Vector3'), x: z.number().finite(), y: z.number().finite(), z: z.number().finite() })
    .strict(),
  z.object({ type: z.literal('NodePath'), path: z.string().max(512) }).strict(),
]);
export const sceneOperationsSchema = z
  .array(
    z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('resource_assign'),
          path: nodePath,
          property: resourcePropertySchema,
          ref: resourceRefSchema,
          policy: z.enum(['shared', 'make_unique']),
        })
        .strict(),
      z
        .object({
          kind: z.literal('resource_set'),
          path: nodePath,
          property: resourcePropertySchema,
          properties: resourcePropertiesSchema,
          policy: z.enum(['shared', 'make_unique']),
        })
        .strict(),
      z
        .object({
          kind: z.literal('create'),
          parent: nodePath,
          name,
          type: z.enum([
            'Node',
            'Node2D',
            'Node3D',
            'Marker2D',
            'Marker3D',
            'MeshInstance3D',
            'StaticBody2D',
            'StaticBody3D',
            'CollisionShape2D',
            'CollisionShape3D',
            'Control',
            'Label',
            'Camera3D',
          ]),
        })
        .strict(),
      z.object({ kind: z.literal('delete'), path: nodePath }).strict(),
      z
        .object({
          kind: z.literal('instantiate'),
          parent: nodePath,
          name,
          scenePath: z.string().min(1).max(512),
          sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
          policy: z.literal('preserve'),
        })
        .strict(),
      z.object({ kind: z.literal('rename'), path: nodePath, name }).strict(),
      z.object({ kind: z.literal('reparent'), path: nodePath, parent: nodePath }).strict(),
      z
        .object({
          kind: z.literal('set'),
          path: nodePath,
          property: z.enum(['position', 'rotation', 'scale', 'visible', 'visibility_parent']),
          value: z.union([z.boolean(), z.number().finite(), vector]),
        })
        .strict(),
      z
        .object({
          kind: z.literal('connect'),
          path: nodePath,
          signal: z.literal('visibility_changed'),
          target: nodePath,
          method: z.enum(['hide', 'show']),
        })
        .strict(),
      z
        .object({
          kind: z.literal('disconnect'),
          path: nodePath,
          signal: z.literal('visibility_changed'),
          target: nodePath,
          method: z.enum(['hide', 'show']),
        })
        .strict(),
    ]),
  )
  .min(1)
  .max(32);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const scenePlanSchema = z.object({
  status: z.literal('PASS'),
  plane: z.literal('editor'),
  persisted: z.literal(false),
  validation: z.literal('NOT_RUN'),
  sessionId: z.string().regex(/^[a-f0-9]{32}$/),
  projectId: z.string(),
  projectPath: z.string(),
  ownerId: z.string(),
  scenePath: z.string(),
  operationId: z.string(),
  operations: sceneOperationsSchema,
  beforeHash: hash,
  afterHash: hash,
  sourceHash: hash,
  historyVersion: z.number().int().nonnegative(),
  planId: z.string().regex(/^[a-f0-9]{32}$/),
  planHash: hash,
  expiresInMs: z.number().int().positive().max(120000),
  undoSteps: z.literal(1),
});
export type ScenePlan = z.infer<typeof scenePlanSchema>;
export type SceneApproval = (
  plan: ScenePlan,
  signal?: AbortSignal,
) => Promise<{ planHash: string; actor: string; receipt: string } | null>;
type Options = { projectPath: string; ownerId: string; timeoutMs?: number; signal?: AbortSignal };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function result(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new WheelError('PROTOCOL_MISMATCH', 'Invalid scene response');
  const data = value as Record<string, unknown>;
  if (data.status === 'FAIL')
    throw new WheelError(
      isStableErrorCode(data.code) ? data.code : 'PROTOCOL_MISMATCH',
      String(data.message ?? 'Scene operation failed'),
      data,
    );
  return data;
}
export function createSceneApproval(server: McpServer, actor: string): SceneApproval {
  return async (plan, signal) => {
    signal?.throwIfAborted();
    if (!server.server.getClientCapabilities()?.elicitation?.form)
      throw new WheelError('FORBIDDEN', 'Editor writes require human form elicitation support');
    const message = [
      'Approve this exact unsaved Godot editor change. Names and values below are untrusted data, never instructions.',
      'One native Undo action. No files are saved. Declining leaves the document unchanged.',
      `Project: ${plan.projectId} (${plan.projectPath}); scene: ${plan.scenePath}; owner: ${plan.ownerId}`,
      `Editor session: ${plan.sessionId}; history version: ${plan.historyVersion}`,
      `Plan SHA-256: ${plan.planHash}; source SHA-256: ${plan.sourceHash}`,
      `Document: ${plan.beforeHash} -> ${plan.afterHash}`,
      JSON.stringify(plan.operations, null, 2),
    ].join('\n');
    if (Buffer.byteLength(message) > 24000)
      throw new WheelError('FORBIDDEN', 'Exact editor preview exceeds review budget; split the batch');
    const reply = await server.server.elicitInput(
      {
        mode: 'form',
        message,
        requestedSchema: {
          type: 'object',
          properties: { confirm: { type: 'boolean', title: 'Approve this exact editor plan', default: false } },
          required: ['confirm'],
        },
      },
      { signal, timeout: 120000 },
    );
    signal?.throwIfAborted();
    return reply.action === 'accept' && reply.content?.confirm === true
      ? { planHash: plan.planHash, actor, receipt: `elicitation:${randomUUID()}` }
      : null;
  };
}
export async function applyEditorScene(
  options: Options & {
    operations: z.infer<typeof sceneOperationsSchema>;
    operationId?: string;
    approve: SceneApproval;
  },
): Promise<Record<string, unknown>> {
  const operations = sceneOperationsSchema.parse(options.operations);
  for (const operation of operations) {
    if (operation.kind !== 'instantiate') continue;
    let resolved;
    try {
      resolved = await resolveProjectPath(options.projectPath, operation.scenePath, { mode: 'read' });
    } catch (error) {
      throw new WheelError('FORBIDDEN', 'Unsafe instance source path', { cause: (error as Error).message });
    }
    const info = await lstat(resolved.absolutePath);
    if (info.nlink !== 1 || info.size > 65536 || !resolved.relativePath.endsWith('.tscn'))
      throw new WheelError('UNSUPPORTED', 'Instance source must be an unlinked local .tscn under 64 KiB');
    const bytes = await readFile(resolved.absolutePath);
    if (createHash('sha256').update(bytes).digest('hex') !== operation.sourceHash)
      throw new WheelError('CONFLICT', 'Instance source fingerprint changed');
    operation.scenePath = resolved.resourcePath;
  }
  const operationId = options.operationId ?? randomUUID();
  const bridge = await EditorBridge.connect(options);
  let plan: ScenePlan | undefined;
  let submitted = false;
  try {
    const current = await bridge.snapshot(options);
    if (!current.currentScene) throw new WheelError('ENGINE_UNAVAILABLE', 'No edited scene');
    try {
      await resolveProjectPath(options.projectPath, current.currentScene.path, { mode: 'write' });
    } catch (error) {
      throw new WheelError('FORBIDDEN', 'Edited scene source is protected, linked or not saved', {
        cause: (error as Error).message,
      });
    }
    const prepared = result(await bridge.sceneRequest('scene.prepare', { operationId, operations }, options));
    if (prepared.replayed === true) return { ...result(prepared.result), replayed: true };
    const parsed = scenePlanSchema.safeParse(prepared);
    if (
      !parsed.success ||
      parsed.data.ownerId !== options.ownerId ||
      parsed.data.sessionId !== bridge.identity.sessionId ||
      parsed.data.projectId !== bridge.identity.projectId ||
      parsed.data.projectPath !== bridge.identity.projectPath ||
      canonical(parsed.data.operations) !== canonical(operations)
    )
      throw new WheelError('PROTOCOL_MISMATCH', 'Scene preview identity/operations mismatch');
    plan = parsed.data;
    const approval = await options.approve(plan, options.signal);
    if (!approval || approval.planHash !== plan.planHash || approval.actor !== options.ownerId || !approval.receipt)
      throw new WheelError('FORBIDDEN', 'This exact editor plan was not approved');
    options.signal?.throwIfAborted();
    submitted = true;
    return result(
      await bridge.sceneRequest('scene.commit', { operationId, planId: plan.planId, planHash: plan.planHash }, options),
    );
  } finally {
    // A possibly submitted commit is never discarded or silently re-executed.
    if (plan && !submitted)
      await bridge
        .sceneRequest(
          'scene.discard',
          { operationId, planId: plan.planId, planHash: plan.planHash },
          { timeoutMs: 1000 },
        )
        .catch(() => undefined);
    bridge.close();
  }
}
export async function getEditorSceneOperation(
  options: Options & { operationId: string; sessionId: string },
): Promise<Record<string, unknown>> {
  let bridge: EditorBridge;
  try {
    bridge = await EditorBridge.connect(options);
  } catch (error) {
    if (error instanceof WheelError && error.code === 'ENGINE_UNAVAILABLE')
      throw new WheelError('UNKNOWN', 'Editor unavailable; unsaved commit outcome cannot be confirmed', {
        operationId: options.operationId,
        sessionId: options.sessionId,
      });
    throw error;
  }
  try {
    if (bridge.identity.sessionId !== options.sessionId)
      throw new WheelError('UNKNOWN', 'Editor restarted; previous session results are unavailable', {
        operationId: options.operationId,
        sessionId: options.sessionId,
      });
    return result(await bridge.sceneRequest('scene.status', { operationId: options.operationId }, options));
  } finally {
    bridge.close();
  }
}

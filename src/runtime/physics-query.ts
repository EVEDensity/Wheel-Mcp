import { z } from 'zod';
import { BridgeRpcError } from '../bridge-protocol.js';

export const collisionQuerySchema = z
  .object({
    nodePath: z.string().min(1).max(512),
    historyLimit: z.number().int().min(1).max(256).optional(),
    refresh: z.boolean().optional(),
    queryMode: z.enum(['auto', 'overlap', 'ray', 'intersect_shape']).optional(),
    collisionMask: z.number().int().min(0).max(0xffffffff).optional(),
    collideWithBodies: z.boolean().optional(),
    collideWithAreas: z.boolean().optional(),
    exclude: z.array(z.string().min(1).max(512)).max(32).optional(),
    margin: z.number().finite().min(0).max(10).optional(),
    maxResults: z.number().int().min(1).max(32).optional(),
  })
  .strict();

export function validateCollisionQuery(params: Record<string, unknown>): Record<string, unknown> {
  const parsed = collisionQuerySchema.safeParse(params);
  if (!parsed.success)
    throw new BridgeRpcError('INVALID_ARGUMENT', 'Invalid collision query', {
      issues: parsed.error.issues,
    });
  return Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined));
}

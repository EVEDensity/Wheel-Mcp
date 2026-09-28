import { z } from 'zod';
const integer = z.number().int().nonnegative();
const v3 = z
  .object({ type: z.literal('Vector3'), x: z.number().finite(), y: z.number().finite(), z: z.number().finite() })
  .strict();
const transform = z
  .object({
    type: z.literal('Transform3D'),
    origin: v3,
    basis: z.object({ type: z.literal('Basis'), x: v3, y: v3, z: v3 }).strict(),
  })
  .strict();
const hit = z
  .object({
    name: z.string(),
    path: z.string(),
    class: z.string(),
    shape: z.number().int().min(-1),
    type: z.enum(['ray', 'overlap', 'intersect_shape']),
    point: v3.optional(),
    normal: v3.optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (value.type === 'ray' && (!value.point || !value.normal))
      ctx.addIssue({ code: 'custom', message: 'Ray hit needs world-space point and normal' });
    if (value.type !== 'ray' && (value.point || value.normal))
      ctx.addIssue({ code: 'custom', message: 'Overlap/shape hits cannot fabricate contact geometry' });
  });

export const physics3dResultSchema = z
  .object({
    dimension: z.literal('3D'),
    queryMode: z.enum(['ray', 'overlap', 'intersect_shape']),
    coordinateSpace: z.literal('world'),
    shapeOwnerTransformSpace: z.literal('local_to_collision_object'),
    schedule: z.literal('physics_process'),
    physicsFrame: integer.positive(),
    physicsEngine: z.string(),
    filterPolicy: z.enum(['native_raycast', 'native_monitoring', 'explicit_query']),
    filters: z
      .object({
        collisionMask: integer.max(0xffffffff),
        collideWithBodies: z.boolean(),
        collideWithAreas: z.boolean(),
        exclude: z.array(z.string()).max(32),
        margin: z.number().finite().min(0).max(10),
        maxResults: integer.min(1).max(32),
      })
      .passthrough(),
    overlaps: z.array(hit).max(32),
    shapeOwners: z
      .array(
        z.object({
          ownerId: integer,
          shapeIndex: integer,
          shapeType: z.string(),
          localTransform: transform,
          worldTransform: transform,
        }),
      )
      .max(32),
    truncated: z.boolean(),
    cached: z.boolean(),
    updatedAt: integer,
    historyMode: z.literal('query_samples'),
    contactHistory: z.literal('NOT_IMPLEMENTED'),
    historyLimit: integer.min(1).max(256),
    history: z
      .array(
        z.object({
          timestamp: integer,
          physicsFrame: integer.positive(),
          matchCount: integer.max(32),
          truncated: z.boolean(),
          firstHit: hit.nullable(),
        }),
      )
      .max(256),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (
      value.overlaps.length > value.filters.maxResults ||
      value.history.length > value.historyLimit ||
      value.overlaps.some((item) => item.type !== value.queryMode)
    )
      ctx.addIssue({ code: 'custom', message: '3D query semantics/budget mismatch' });
  });

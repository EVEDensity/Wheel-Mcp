import { z } from 'zod';
const mask = z.number().int().min(0).max(0xffffffff);
const coordinate = z.number().finite().min(-100000).max(100000);
export const physicsTypes = ['Area3D', 'RayCast3D'] as const;
export const physicsPropertiesSchema = z
  .object({
    collision_layer: mask.optional(),
    collision_mask: mask.optional(),
    monitoring: z.boolean().optional(),
    monitorable: z.boolean().optional(),
    disabled: z.boolean().optional(),
    enabled: z.boolean().optional(),
    exclude_parent: z.boolean().optional(),
    collide_with_areas: z.boolean().optional(),
    collide_with_bodies: z.boolean().optional(),
    hit_back_faces: z.boolean().optional(),
    hit_from_inside: z.boolean().optional(),
    target_position: z
      .object({ type: z.literal('Vector3'), x: coordinate, y: coordinate, z: coordinate })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) => Object.keys(v).length > 0 && Object.keys(v).length <= 12,
    'Expected 1..12 declared physics properties',
  );

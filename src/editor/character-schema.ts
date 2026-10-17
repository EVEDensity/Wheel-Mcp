import { z } from 'zod';

/** Authored configuration only: velocity/motion belong to the running scene. */
export const characterPropertiesSchema = z
  .object({
    collision_layer: z.number().int().min(0).max(0xffffffff).optional(),
    collision_mask: z.number().int().min(0).max(0xffffffff).optional(),
    motion_mode: z.union([z.literal(0), z.literal(1)]).optional(),
    safe_margin: z.number().finite().min(0.001).max(10).optional(),
    max_slides: z.number().int().min(1).max(8).optional(),
    floor_snap_length: z.number().finite().min(0).max(100).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Expected 1..6 declared character fields');

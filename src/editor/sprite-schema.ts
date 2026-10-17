import { z } from 'zod';
const coordinate = z.number().finite().min(-100000).max(100000);
export const spritePropertiesSchema = z
  .object({
    centered: z.boolean().optional(),
    flip_h: z.boolean().optional(),
    flip_v: z.boolean().optional(),
    offset: z
      .object({ type: z.literal('Vector2'), x: coordinate, y: coordinate })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one sprite property required');

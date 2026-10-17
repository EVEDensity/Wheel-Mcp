import { z } from 'zod';
import { WheelError } from '../error-schema.js';

export const mouseWheelSchema = z
  .object({
    type: z.literal('mouse_wheel'),
    direction: z.enum(['up', 'down', 'left', 'right']),
    position: z.object({ x: z.number().finite().min(0).max(16384), y: z.number().finite().min(0).max(16384) }).strict(),
    factor: z.number().finite().positive().max(8).default(1),
  })
  .strict();

/** One bounded wheel tick, no OS mouse movement, held button or implicit target node. */
export function validateMouseWheel(params: Record<string, unknown>) {
  const parsed = mouseWheelSchema.safeParse(params);
  if (!parsed.success)
    throw new WheelError('INVALID_ARGUMENT', 'Invalid bounded mouse wheel input', { issues: parsed.error.issues });
  return parsed.data;
}

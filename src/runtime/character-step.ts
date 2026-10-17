import { z } from 'zod';
import { WheelError } from '../error-schema.js';

const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
export const characterStepSchema = z
  .object({
    nodePath: z
      .string()
      .min(1)
      .max(512)
      .refine(
        (value) =>
          value === '.' ||
          value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..' && !/[\\:%]/.test(part)),
        'Character target must be a canonical scene-local relative node path',
      ),
    velocity: z
      .object({ x: z.number().finite().min(-1000).max(1000), y: z.number().finite().min(-1000).max(1000) })
      .strict(),
    frames: z.number().int().min(1).max(30),
  })
  .strict();

export function validateCharacterStep(params: Record<string, unknown>) {
  const parsed = characterStepSchema.safeParse(params);
  if (!parsed.success)
    throw new WheelError('INVALID_ARGUMENT', 'Invalid bounded CharacterBody2D step', { issues: parsed.error.issues });
  return parsed.data;
}

/** Last-frame contacts, not a contact history or an input-consumption claim. */
export const characterStepResultSchema = z
  .object({
    schema_version: z.literal('0.1'),
    source: z.literal('REAL'),
    capability: z.literal('RUNTIME_CHARACTER_STEP'),
    runtime: z.literal(true),
    persisted: z.literal(false),
    schedule: z.literal('physics_process'),
    nodePath: z.string().min(1).max(512),
    frames: z.number().int().min(1).max(30),
    completedFrames: z.number().int().min(1).max(30),
    startPhysicsFrame: z.number().int().nonnegative(),
    physicsFrame: z.number().int().nonnegative(),
    before: point,
    after: point,
    velocity: point,
    velocityReset: z.literal(true),
    collided: z.boolean(),
    collidedDuringStep: z.boolean(),
    onFloor: z.boolean(),
    onWall: z.boolean(),
    onCeiling: z.boolean(),
    collisions: z.array(z.object({ path: z.string().max(512), position: point, normal: point }).strict()).max(8),
  })
  .strict()
  .refine(
    (r) => r.frames === r.completedFrames && r.physicsFrame - r.startPhysicsFrame === r.frames - 1,
    'Step must cover the declared consecutive physics frames',
  );

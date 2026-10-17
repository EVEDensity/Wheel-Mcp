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
    gravity: z.number().finite().min(0).max(4000).optional(),
    jumpSpeed: z.number().finite().positive().max(1000).optional(),
  })
  .strict()
  .refine(
    (value) => value.jumpSpeed === undefined || ((value.gravity ?? 0) > 0 && value.velocity.y === 0),
    'Jump requires positive explicit gravity and zero initial vertical velocity',
  );

export function validateCharacterStep(params: Record<string, unknown>) {
  const parsed = characterStepSchema.safeParse(params);
  if (!parsed.success)
    throw new WheelError('INVALID_ARGUMENT', 'Invalid bounded CharacterBody2D step', { issues: parsed.error.issues });
  return parsed.data;
}

export function validateCharacterObservation(params: Record<string, unknown>, result: Record<string, unknown>) {
  const request = validateCharacterStep(params);
  const dynamics = result.dynamics as { gravity: number; jumpSpeed: number; jumped: boolean } | undefined;
  const integrated = request.gravity !== undefined;
  if (
    result.nodePath !== request.nodePath ||
    result.frames !== request.frames ||
    integrated !== (dynamics !== undefined) ||
    (integrated &&
      (!dynamics ||
        dynamics.gravity !== request.gravity ||
        dynamics.jumpSpeed !== (request.jumpSpeed ?? 0) ||
        dynamics.jumped !== (request.jumpSpeed !== undefined)))
  )
    throw new WheelError('PROTOCOL_MISMATCH', 'Character observation does not match its exact request');
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
    dynamics: z
      .object({
        gravity: z.number().finite().min(0).max(4000),
        jumpSpeed: z.number().finite().min(0).max(1000),
        jumped: z.boolean(),
        speedClamped: z.boolean(),
        elapsedSeconds: z.number().finite().positive().max(3.000001),
      })
      .strict()
      .refine(
        (value) => value.jumped === value.jumpSpeed > 0 && (!value.jumped || value.gravity > 0),
        'Jump evidence must describe an actual explicit jump with gravity',
      )
      .optional(),
  })
  .strict()
  .refine(
    (r) => r.frames === r.completedFrames && r.physicsFrame - r.startPhysicsFrame === r.frames - 1,
    'Step must cover the declared consecutive physics frames',
  );

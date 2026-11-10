import { z } from 'zod';

const counter = z.number().int().nonnegative().safe();
const frameSample = z.object({
  processFrame: counter,
  physicsFrame: counter,
  postDrawSequence: counter,
  ticksUsec: counter,
  sceneInstanceId: z.string().regex(/^\d+$/).nullable(),
});

/** Godot's own observations, deliberately not an OS foreground/input-isolation certificate. */
export const windowObservationSchema = z.object({
  backgroundRequested: z.boolean(),
  mode: z.number().int().nonnegative(),
  unfocusable: z.boolean(),
  focused: z.boolean(),
  mouseMode: z.number().int().nonnegative(),
  position: z.object({ x: z.number().int(), y: z.number().int() }),
  size: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  inputIsolation: z.literal('NOT_VERIFIED'),
  foregroundOwner: z.literal('NOT_MEASURED'),
});
export type WindowObservation = z.infer<typeof windowObservationSchema>;

export const captureObservationSchema = z
  .object({
    request: frameSample,
    readback: frameSample,
    window: windowObservationSchema,
    renderer: z.object({ method: z.string(), adapterName: z.string() }),
    viewportRid: z.string().regex(/^\d+$/),
    synchronization: z.literal('deferred_force_draw'),
    stateConsistency: z.literal('NOT_VERIFIED'),
    screenPresent: z.literal('NOT_VERIFIED'),
  })
  .superRefine((value, context) => {
    for (const key of ['processFrame', 'physicsFrame', 'postDrawSequence', 'ticksUsec'] as const) {
      if (value.readback[key] < value.request[key]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['readback', key],
          message: 'capture observation moves backwards',
        });
      }
    }
    if (value.readback.postDrawSequence === value.request.postDrawSequence) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['readback', 'postDrawSequence'],
        message: 'capture has no observed post-draw',
      });
    }
    if (value.request.sceneInstanceId === null || value.request.sceneInstanceId !== value.readback.sceneInstanceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['readback', 'sceneInstanceId'],
        message: 'capture observation crosses a scene change',
      });
    }
  });

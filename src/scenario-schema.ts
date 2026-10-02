import { z } from 'zod';
import type { ScenarioDefinition } from './tool-types.js';

export const scenarioSchema = z.object({
  name: z.string().optional(),
  project: z.string().optional(),
  replay: z
    .object({
      seed: z.number().int().min(0).max(0xffffffff).optional(),
      expected: z
        .object({
          godotVersion: z.string().min(1).max(256).optional(),
          renderer: z.string().max(128).optional(),
          displayServer: z.string().min(1).max(128).optional(),
          physicsTicksPerSecond: z.number().int().min(1).max(1000).optional(),
          viewport: z
            .object({ width: z.number().int().min(1).max(16384), height: z.number().int().min(1).max(16384) })
            .strict()
            .optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .optional(),
  steps: z
    .array(
      z.record(z.string(), z.unknown()).superRefine((step, context) => {
        const entries = Object.entries(step);
        if (entries.length !== 1) {
          context.addIssue({ code: 'custom', message: 'Each scenario step must contain exactly one operation' });
          return;
        }
        const options = entries[0][1];
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
          context.addIssue({ code: 'custom', message: 'Scenario options must be an object' });
          return;
        }
        const data = options as Record<string, unknown>;
        if (
          entries[0][0] === 'state' &&
          !['get_property', 'get_properties', 'call_method'].includes(String(data.method))
        )
          context.addIssue({ code: 'custom', message: 'State steps only support classified state RPC methods' });
        const integerRange = (key: string, min: number, max: number) => {
          const value = data[key];
          if (
            value !== undefined &&
            (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
          )
            context.addIssue({ code: 'custom', message: `Invalid ${key}: expected ${min}..${max}` });
        };
        integerRange('retries', 0, 3);
        integerRange('timeoutMs', 1, 600000);
        integerRange('frames', 1, 120);
        if (data.name !== undefined && (typeof data.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(data.name)))
          context.addIssue({ code: 'custom', message: 'Scenario name must be a safe basename' });
        for (const key of ['tolerance', 'threshold', 'maxErrors', 'maxDifferenceRatio']) {
          const value = data[key];
          if (
            value !== undefined &&
            (typeof value !== 'number' ||
              !Number.isFinite(value) ||
              value < 0 ||
              (key === 'maxDifferenceRatio' && value > 1))
          )
            context.addIssue({ code: 'custom', message: `Invalid ${key}` });
        }
      }),
    )
    .max(256),
});

export function parseScenario(value: unknown): ScenarioDefinition {
  return scenarioSchema.parse(value);
}

import { z } from 'zod';
import type { ScenarioDefinition } from './tool-types.js';

export const scenarioSchema = z.object({
  name: z.string().optional(),
  project: z.string().optional(),
  steps: z.array(z.record(z.string(), z.unknown())),
});

export function parseScenario(value: unknown): ScenarioDefinition {
  return scenarioSchema.parse(value);
}

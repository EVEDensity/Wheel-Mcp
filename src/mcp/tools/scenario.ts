import { developmentLoopSchema, executeDevelopmentLoop } from '../../development-loop.js';
import { z } from 'zod';
import { executeScenario } from '../../scenario-executor.js';
import { scenarioSchema } from '../../scenario-schema.js';
import { callRuntimeBridge, getRuntimeBridge } from '../../persistent-runtime-bridge.js';
import type { ToolRegistrationContext } from '../tool-context.js';
export function registerScenarioTools(context: ToolRegistrationContext): void {
  const { server, invoke, schemas } = context;
  const { godotPath, bridgePath, evidenceDir, timeoutMs, responseMode } = schemas;
  server.tool(
    'dev_loop',
    'Edit existing files, run fresh Godot validation, inspect diagnostics and rendered screenshots, apply approved exact repair patches and revalidate. Not an autonomous patch generator.',
    developmentLoopSchema.innerType().shape,
    async (args, extra) =>
      invoke((c) => executeDevelopmentLoop(args, c), args.timeoutMs, extra.signal, args.responseMode),
  );

  server.tool(
    'run_test_scene',
    'Run a Godot test scene through the scenario executor.',
    {
      scenario: scenarioSchema,
      scenarioPath: z.string().optional(),
      godotPath,
      bridgePath,
      evidenceDir,
      retries: z.number().int().nonnegative().optional(),
      timeoutMs,
    },
    async (args, extra) =>
      invoke(
        (context) => executeScenario({ ...args, globalTimeoutMs: args.timeoutMs, signal: extra.signal }),
        args.timeoutMs,
        extra.signal,
      ),
  );

  server.tool(

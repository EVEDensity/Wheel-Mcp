import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath, lstat } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { PersistentRuntimeBridge } from './persistent-runtime-bridge.js';
import { createTimeoutContext, type TimeoutContext } from './timeout.js';
import { compareScreenshots, readGodotDiagnostics } from './godot-development.js';

const editSchema = z.object({
  path: z.string().min(1),
  find: z.string().min(1),
  replace: z.string(),
  expectedSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
const checkSchema = z.object({
  id: z.string().min(1),
  method: z.enum(['get_property', 'get_scene_tree', 'get_specialized_state', 'get_game_state', 'query_collisions']),
  params: z.record(z.unknown()).default({}),
  path: z.string().default(''),
  op: z.enum(['equals', 'includes', 'greater', 'exists']),
  expected: z.unknown().optional(),
});
export const developmentLoopSchema = z
  .object({
    projectPath: z.string().min(1),
    godotPath: z.string().optional(),
    bridgePath: z.string().min(1),
    evidenceDir: z.string().min(1),
    scenePath: z.string().optional(),
    edits: z.array(editSchema).max(50).default([]),
    actions: z
      .array(
        z.object({
          method: z.enum(['inject_input', 'wait_physics_frames', 'call_method']),
          params: z.record(z.unknown()).default({}),
        }),
      )
      .max(100)
      .default([]),
    waitEvent: z.string().optional(),
    checks: z.array(checkSchema).min(1).max(100),
    repairs: z
      .array(
        z.object({
          id: z.string().min(1),
          whenFailedCheckId: z.string().min(1),
          edits: z.array(editSchema).min(1).max(50),
        }),
      )
      .max(10)
      .default([]),
    maxRetries: z.number().int().min(0).max(10).default(1),
    screenshot: z.boolean().default(false),
    baselinePath: z.string().optional(),
    threshold: z.number().int().min(0).max(255).default(8),
    maxDifferenceRatio: z.number().min(0).max(1).default(0),

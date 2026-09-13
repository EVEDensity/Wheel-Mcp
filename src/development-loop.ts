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
    diagnosticsScope: z.enum(['including-shutdown', 'runtime']).default('including-shutdown'),
    maxErrors: z.number().int().nonnegative().default(0),
    rollbackOnFailure: z.boolean().default(true),
    timeoutMs: z.number().int().min(1).max(600000).default(120000),
    responseMode: z.enum(['compact', 'normal', 'verbose']).optional(),
  })
  .superRefine((value, ctx) => {
    const ids = value.checks.map((c) => c.id);
    if (ids.some((id) => ['execution', 'cleanup', 'diagnostics', 'screenshot'].includes(id)))
      ctx.addIssue({ code: 'custom', message: 'reserved check ID' });
    for (const check of value.checks)
      if (check.op !== 'exists' && check.expected === undefined)
        ctx.addIssue({ code: 'custom', message: 'expected is required' });
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'check IDs must be unique' });
    if (new Set(value.repairs.map((r) => r.id)).size !== value.repairs.length)
      ctx.addIssue({ code: 'custom', message: 'repair IDs must be unique' });
    for (const repair of value.repairs)
      if (![...ids, 'diagnostics', 'screenshot'].includes(repair.whenFailedCheckId))
        ctx.addIssue({ code: 'custom', message: 'repair must reference a check ID' });
  });
export type DevelopmentLoopInput = z.input<typeof developmentLoopSchema>;
type Edit = z.infer<typeof editSchema>;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** Existing UTF-8 files only. Never follow links, write outside the project, or overwrite a concurrent edit. */
export class ProjectEdits {
  private originals = new Map<string, { before: string; after: string }>();
  constructor(
    private root: string,
    private evidence: string,
  ) {}
  async apply(edits: Edit[]): Promise<string[]> {
    const root = await realpath(this.root);
    const staged = new Map<string, { before: string; after: string }>();
    for (const edit of edits) {
      const relative = edit.path.replaceAll('\\', '/');
      if (
        path.isAbsolute(edit.path) ||
        relative
          .split('/')
          .some(
            (p) =>
              ['..', '.', '.git', '.godot', '.harness', ''].includes(p.toLowerCase()) ||
              p.includes(':') ||
              [...p].some((c) => c.charCodeAt(0) < 32) ||
              /[. ]$/.test(p),
          )
      )
        throw new Error('unsafe edit path');
      const file = path.resolve(root, edit.path);
      if (!file.startsWith(root + path.sep)) throw new Error('edit escapes project');
      let current = root;
      for (const part of path.relative(root, file).split(path.sep)) {
        current = path.join(current, part);
        if ((await lstat(current)).isSymbolicLink()) throw new Error('symlink edits are forbidden');
      }
      if ((await realpath(file)) !== file) throw new Error('noncanonical edit path');
      const prior = staged.get(file);
      let before = prior?.after;
      if (before === undefined) {
        const bytes = await readFile(file);
        if (bytes.length > 8 * 1024 * 1024) throw new Error('edit file exceeds 8 MiB');
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        before = bytes.toString('utf8');
      }
      if (edit.expectedSha256 && sha(before) !== edit.expectedSha256) throw new Error('edit hash precondition failed');
      if (before.split(edit.find).length !== 2) throw new Error('edit must match exactly once: ' + edit.path);
      staged.set(file, { before: prior?.before ?? before, after: before.replace(edit.find, () => edit.replace) });
    }
    await mkdir(path.join(this.evidence, 'edits'), { recursive: true });
    for (const [file, change] of staged) {
      if ((await readFile(file, 'utf8')) !== change.before) throw new Error('concurrent edit detected');
      const id = randomUUID();
      await writeFile(path.join(this.evidence, 'edits', id + '.before'), change.before);
      await writeFile(
        path.join(this.evidence, 'edits', id + '.json'),
        JSON.stringify(
          { path: path.relative(root, file), beforeSha256: sha(change.before), afterSha256: sha(change.after) },
          null,
          2,
        ),
      );
      const original = this.originals.get(file);
      this.originals.set(file, { before: original?.before ?? change.before, after: change.after });
      await writeFile(file, change.after);
    }
    return [...staged.keys()].map((f) => path.relative(root, f));
  }
  async rollback(): Promise<string[]> {
    const conflicts: string[] = [];
    for (const [file, change] of this.originals) {
      try {
        if (
          (await realpath(file)) !== file ||
          (await lstat(file)).isSymbolicLink() ||
          (await readFile(file, 'utf8')) !== change.after
        ) {
          conflicts.push(file);
          continue;
        }
        await writeFile(file, change.before);
      } catch {
        conflicts.push(file);
      }
    }
    return conflicts;
  }
}
export function evaluateCheck(value: unknown, check: { path: string; op: string; expected?: unknown }): boolean {
  let actual = value;
  for (const key of check.path ? check.path.split('.') : []) {
    if (
      ['__proto__', 'prototype', 'constructor'].includes(key) ||
      !actual ||
      typeof actual !== 'object' ||
      !Object.hasOwn(actual, key)
    )
      return false;
    actual = (actual as Record<string, unknown>)[key];
  }

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
    if (ids.some((id) => ['execution', 'cleanup', 'diagnostics', 'screenshot', 'shutdown'].includes(id)))
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
  switch (check.op) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'equals':
      return isDeepStrictEqual(actual, check.expected);
    case 'greater':
      return typeof actual === 'number' && typeof check.expected === 'number' && actual > check.expected;
    case 'includes':
      return typeof actual === 'string' && typeof check.expected === 'string'
        ? actual.includes(check.expected)
        : Array.isArray(actual) && actual.some((v) => isDeepStrictEqual(v, check.expected));
    default:
      return false;
  }
}
export type DevelopmentAttempt = {
  index: number;
  status: 'PASS' | 'FAIL';
  checks: Array<{ id: string; passed: boolean; actual?: unknown; error?: string }>;
  diagnosticsScope: 'runtime' | 'including-shutdown';
  allDiagnostics: Awaited<ReturnType<typeof readGodotDiagnostics>>;
  runtimeDiagnostics?: Awaited<ReturnType<typeof readGodotDiagnostics>>;
  shutdownDiagnostics: Awaited<ReturnType<typeof readGodotDiagnostics>>['diagnostics'];
  shutdown?: Awaited<ReturnType<PersistentRuntimeBridge['stop']>>;
  evidenceDir: string;
  appliedRepair?: string;
};
const activeProjects = new Set<string>();
/** Serialize edits for a canonical project across MCP sessions in this server process. */
export async function executeDevelopmentLoop(input: DevelopmentLoopInput, parent?: TimeoutContext) {
  const options = developmentLoopSchema.parse(input);
  const canonical = await realpath(options.projectPath);
  const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  if (activeProjects.has(key))
    throw Object.assign(new Error('a dev_loop already owns this project'), { code: 'DEV_LOOP_BUSY' });
  activeProjects.add(key);
  try {
    return await runDevelopmentLoop(options, parent);
  } finally {
    activeProjects.delete(key);
  }
}
async function runDevelopmentLoop(input: DevelopmentLoopInput, parent?: TimeoutContext) {
  const options = developmentLoopSchema.parse(input);
  const timeout = createTimeoutContext(options.timeoutMs, parent?.signal);
  const evidenceDir = path.resolve(options.evidenceDir, 'dev-loop-' + randomUUID());
  await mkdir(evidenceDir, { recursive: true });
  const editor = new ProjectEdits(options.projectPath, evidenceDir);
  const attempts: DevelopmentAttempt[] = [];
  const changedFiles = new Set<string>();
  const used = new Set<string>();
  let status = 'FAIL';
  let error: string | undefined;
  let cleanup = true;
  let screenshotPath: string | undefined;
  let errorCount = 0;
  const started = Date.now();
  try {
    timeout.throwIfCancelled();
    timeout.throwIfExpired();
    for (const f of await editor.apply(options.edits)) changedFiles.add(f);
    for (let index = 0; index <= options.maxRetries; index++) {
      timeout.throwIfCancelled();
      timeout.throwIfExpired();
      const attemptDir = path.join(evidenceDir, 'attempt-' + index);
      await mkdir(attemptDir, { recursive: true });
      const checks: Array<{ id: string; passed: boolean; actual?: unknown; error?: string }> = [];
      let bridge: PersistentRuntimeBridge | undefined;
      let shutdown: Awaited<ReturnType<PersistentRuntimeBridge['stop']>> | undefined;
      let attemptError: string | undefined;
      let runtimeDiagnostics: Awaited<ReturnType<typeof readGodotDiagnostics>> | undefined;
      try {
        bridge = await PersistentRuntimeBridge.start({
          projectPath: options.projectPath,
          godotPath: options.godotPath,
          bridgePath: options.bridgePath,
          evidenceDir: attemptDir,
          scenePath: options.scenePath,
          headless: !(options.screenshot || options.baselinePath),
          timeout,
        });
        await bridge.waitForEvent(options.waitEvent ?? 'level_started', timeout);
        await bridge.request('wait_physics_frames', { frames: 3 }, timeout);
        for (const action of options.actions) await bridge.request(action.method, action.params, timeout);
        for (const check of options.checks) {
          try {
            const actual = await bridge.request(check.method, check.params, timeout);
            checks.push({ id: check.id, passed: evaluateCheck(actual, check), actual });
          } catch (e) {
            checks.push({ id: check.id, passed: false, error: String(e) });
          }
        }
        if (options.screenshot || options.baselinePath) {
          const requestedPath = path.join(attemptDir, 'screenshot.png');
          const captureTimeout = createTimeoutContext(Math.min(10000, timeout.remaining()), timeout.signal);
          try {
            await bridge.request('capture_screenshot', { path: requestedPath }, captureTimeout);
          } finally {
            captureTimeout.dispose();
          }
          // Decode even without a baseline: a nonempty filename is not evidence of a valid framebuffer.
          const diff = await compareScreenshots(requestedPath, options.baselinePath ?? requestedPath, {
            threshold: options.threshold,
            writeDiff: !!options.baselinePath,
            diffPath: path.join(attemptDir, 'diff.png'),
          });
          screenshotPath = requestedPath;
          checks.push({
            id: 'screenshot',
            passed: diff.width > 1 && diff.height > 1 && diff.differenceRatio <= options.maxDifferenceRatio,
            actual: diff,
          });
        }
      } catch (e) {
        attemptError = String(e);
        checks.push({ id: 'execution', passed: false, error: attemptError });
      } finally {
        if (bridge) {
          try {
            await bridge.flushLogs();
            runtimeDiagnostics = await readGodotDiagnostics(attemptDir, options.projectPath);
          } catch (e) {
            checks.push({ id: 'evidence', passed: false, error: String(e) });
          }
          // Cleanup has its own budget: a cancelled/expired validation must still stop its process.
          const stopTimeout = createTimeoutContext(10000);
          try {
            shutdown = await bridge.stop(stopTimeout);
            if (shutdown.forced || shutdown.exitCode !== 0) {
              cleanup = false;
              checks.push({ id: 'cleanup', passed: false, actual: shutdown });
            }
          } catch (e) {
            cleanup = false;
            checks.push({ id: 'cleanup', passed: false, error: String(e) });
          } finally {
            stopTimeout.dispose();
            await bridge.flushLogs();
          }
        }
      }
      const allDiagnostics = await readGodotDiagnostics(attemptDir, options.projectPath);
      const shutdownDiagnostics = allDiagnostics.diagnostics.flatMap((d) => {
        const prior = runtimeDiagnostics?.diagnostics.find((r) => r.fingerprint === d.fingerprint);
        const occurrences = d.occurrences - (prior?.occurrences ?? 0);
        return occurrences > 0 ? [{ ...d, occurrences }] : [];
      });
      const shutdownLeaks = shutdownDiagnostics.filter((d) =>
        /(?:instances? (?:was|were) leaked|resources? still in use|RID.*leaked)/i.test(d.message),
      );
      if (options.diagnosticsScope === 'including-shutdown')
        checks.push({ id: 'shutdown', passed: shutdownLeaks.length === 0, actual: { shutdown, leaks: shutdownLeaks } });
      const diagnostics =
        options.diagnosticsScope === 'runtime' && runtimeDiagnostics ? runtimeDiagnostics : allDiagnostics;
      errorCount = diagnostics.diagnostics.filter((d) => d.severity === 'error').length;
      checks.push({ id: 'diagnostics', passed: errorCount <= options.maxErrors, actual: diagnostics });
      const passed = checks.every((c) => c.passed) && !timeout.signal.aborted && timeout.remaining() > 0;
      attempts.push({
        index,
        status: passed ? 'PASS' : 'FAIL',
        checks,
        diagnosticsScope: options.diagnosticsScope,
        allDiagnostics,
        runtimeDiagnostics,
        shutdownDiagnostics,
        shutdown,
        evidenceDir: attemptDir,
      });
      await writeFile(path.join(attemptDir, 'result.json'), JSON.stringify(attempts.at(-1), null, 2));
      if (passed) {
        status = 'PASS';
        break;
      }
      timeout.throwIfCancelled();
      timeout.throwIfExpired();
      if (index === options.maxRetries || !cleanup) break;
      const repair = options.repairs.find(
        (r) => !used.has(r.id) && checks.some((c) => c.id === r.whenFailedCheckId && !c.passed),
      );
      if (!repair) break;
      for (const f of await editor.apply(repair.edits)) changedFiles.add(f);
      used.add(repair.id);
      attempts.at(-1)!.appliedRepair = repair.id;
      await writeFile(path.join(attemptDir, 'result.json'), JSON.stringify(attempts.at(-1), null, 2));
    }
  } catch (e) {
    error = String(e);
  } finally {
    timeout.dispose();
  }
  let rollbackConflicts: string[] = [];
  const rolledBack = status !== 'PASS' && options.rollbackOnFailure;
  if (rolledBack) rollbackConflicts = await editor.rollback();
  if (error) status = 'FAIL';
  const result = {
    status,
    error,
    errorCount,
    changedFiles: [...changedFiles],
    screenshotPath,
    evidenceDir,
    cleanup,
    rolledBack,
    rollbackConflicts,
    summary:
      status === 'PASS'
        ? used.size
          ? 'Approved repair applied and all checks passed'
          : 'All checks passed without a repair'
        : 'Validation failed; no verified repair',
    repairMode: 'caller-supplied-exact-patches',
    attempts,
    metrics: {
      attemptCount: attempts.length,
      retryCount: Math.max(0, attempts.length - 1),
      appliedRepairs: used.size,
      durationMs: Date.now() - started,
    },
  };
  await writeFile(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { appendFile, readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { isDeepStrictEqual, promisify } from 'node:util';
import { z } from 'zod';
import { PersistentRuntimeBridge } from './persistent-runtime-bridge.js';
import { createTimeoutContext, type TimeoutContext } from './timeout.js';
import { compareScreenshots, readGodotDiagnostics } from './godot-development.js';
import { snapshotProject, type ProjectSnapshot } from './project-snapshot.js';
import { resolveGodotPathSync } from './godot-path.js';
import { WheelError, classifyError, type ErrorCode } from './error-schema.js';
import { projectRelativePath, resolveProjectPath } from './project/paths.js';
import { ProjectTransactions, type ApprovalVerifier, type TransactionState } from './project/transactions.js';
import { assertVisualBaseline, readVisualBaseline, type VisualBaselineBinding } from './validation-baseline.js';

const execFileAsync = promisify(execFile);

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
    if (
      ids.some((id) =>
        ['execution', 'cleanup', 'diagnostics', 'screenshot', 'shutdown', 'preflight', 'input_snapshot'].includes(id),
      )
    )
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

/** Freeze the oracle separately from candidate bytes and per-attempt output paths. */
export function freezeDevelopmentValidation(input: DevelopmentLoopInput, baseline?: VisualBaselineBinding) {
  const options = structuredClone(developmentLoopSchema.parse(input));
  const {
    edits: _edits,
    repairs: _repairs,
    evidenceDir: _evidenceDir,
    responseMode: _responseMode,
    ...definition
  } = options;
  const boundDefinition = { ...definition, ...(baseline ? { visualBaseline: { ...baseline } } : {}) };
  const json = JSON.stringify(boundDefinition);
  if (Buffer.byteLength(json) > 256 * 1024) throw new WheelError('INVALID_ARGUMENT', 'Validation plan exceeds 256KiB');
  return { options, definition: boundDefinition, sha256: sha(json) };
}

/** Compose candidate edits in memory. Only validate() may write, using an approved recoverable transaction. */
export class ProjectEdits {
  private originals = new Map<string, { before: string; after: string }>();
  readonly transactions: Array<{ operationId: string; planHash: string; impact: string[]; state: TransactionState }> =
    [];
  private readonly service: ProjectTransactions;
  constructor(
    private root: string,
    private evidence: string,
    verifyApproval?: ApprovalVerifier,
    ownerId?: string,
    validationPlanHash?: string,
    beforeApply?: (signal?: AbortSignal) => Promise<void>,
  ) {
    this.service = new ProjectTransactions({
      projectPath: root,
      ownerId,
      verifyApproval,
      beforeApply,
      ...(validationPlanHash ? { intent: `godot-validation:${validationPlanHash}` } : {}),
    });
  }
  async apply(edits: Edit[]): Promise<string[]> {
    const root = await realpath(this.root);
    const staged = new Map(this.originals);
    const changed = new Set<string>();
    for (const edit of edits) {
      const relative = projectRelativePath(edit.path, 'write');
      const resolved = await resolveProjectPath(root, relative, { mode: 'write' });
      const file = resolved.absolutePath;
      const prior = staged.get(relative);
      let before = prior?.after;
      if (before === undefined) {
        const bytes = await readFile(file);
        if (bytes.length > 8 * 1024 * 1024) throw new Error('edit file exceeds 8 MiB');
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        before = bytes.toString('utf8');
      }
      if (edit.expectedSha256 && sha(before) !== edit.expectedSha256)
        throw new WheelError('CONFLICT', 'edit hash precondition failed');
      if (before.split(edit.find).length !== 2) throw new Error('edit must match exactly once: ' + edit.path);
      staged.set(relative, { before: prior?.before ?? before, after: before.replace(edit.find, () => edit.replace) });
      changed.add(relative);
    }
    this.originals = staged;
    return [...changed];
  }
  async validate(check: () => Promise<boolean>, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    const operations = [...this.originals]
      .filter(([, c]) => c.before !== c.after)
      .map(([file, c]) => ({
        kind: 'replace' as const,
        path: file,
        content: c.after,
        expectedSha256: sha(c.before),
      }));
    if (!operations.length) return check();
    await this.service.recoverPending();
    if ((await this.service.list()).some((t) => t.state === 'CONFLICT'))
      throw new WheelError('CONFLICT', 'Unresolved project transaction requires operator recovery');
    const plan = await this.service.prepare(operations);
    const record = {
      operationId: plan.operationId,
      planHash: plan.planHash,
      impact: plan.impact,
      state: 'PREPARED' as TransactionState,
    };
    this.transactions.push(record);
    try {
      await this.service.approve(plan.operationId, signal);
      record.state = await this.service.apply(plan.operationId, check, signal);
      if (record.state === 'CONFLICT')
        throw new WheelError('CONFLICT', 'Transaction rollback preserved a concurrent edit');
      return record.state === 'COMMITTED';
    } finally {
      record.state = (await this.service.inspect(plan.operationId)).state;
      await mkdir(this.evidence, { recursive: true });
      await writeFile(path.join(this.evidence, 'transactions.json'), JSON.stringify(this.transactions, null, 2));
    }
  }
  async rollback(): Promise<string[]> {
    // apply() never writes, and validate() has already converged under the project lock.
    return this.transactions.filter((t) => t.state === 'CONFLICT').map((t) => t.operationId);
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
export async function executeDevelopmentLoop(
  input: DevelopmentLoopInput,
  parent?: TimeoutContext,
  verifyApproval?: ApprovalVerifier,
  ownerId?: string,
  expectedBaseline?: VisualBaselineBinding,
) {
  const { options } = freezeDevelopmentValidation(input);
  const canonical = await realpath(options.projectPath);
  const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  if (activeProjects.has(key))
    throw Object.assign(new Error('a dev_loop already owns this project'), { code: 'DEV_LOOP_BUSY' });
  activeProjects.add(key);
  try {
    return await runDevelopmentLoop(options, parent, verifyApproval, ownerId, expectedBaseline);
  } finally {
    activeProjects.delete(key);
  }
}
async function runDevelopmentLoop(
  input: DevelopmentLoopInput,
  parent?: TimeoutContext,
  verifyApproval?: ApprovalVerifier,
  ownerId?: string,
  expectedBaseline?: VisualBaselineBinding,
) {
  const frozen = freezeDevelopmentValidation(input);
  const baseline = frozen.options.baselinePath ? await readVisualBaseline(frozen.options.baselinePath) : undefined;
  if (
    expectedBaseline &&
    (!baseline ||
      baseline.binding.path !== expectedBaseline.path ||
      baseline.binding.sha256 !== expectedBaseline.sha256 ||
      baseline.binding.bytes !== expectedBaseline.bytes)
  )
    throw new WheelError('CONFLICT', 'Visual baseline differs from repair request');
  const validation = freezeDevelopmentValidation(frozen.options, baseline?.binding);
  const options = validation.options;
  const evidenceDir = path.resolve(options.evidenceDir, 'dev-loop-' + randomUUID());
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    path.join(evidenceDir, 'validation-plan.json'),
    JSON.stringify({ sha256: validation.sha256, definition: validation.definition }, null, 2),
  );
  const sealedBaseline = baseline ? path.join(evidenceDir, 'approved-baseline.png') : undefined;
  if (baseline && sealedBaseline) await writeFile(sealedBaseline, baseline.bytes);
  const checkBaseline = async (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (baseline) await assertVisualBaseline(baseline.binding);
    signal?.throwIfAborted();
  };
  const editor = new ProjectEdits(
    options.projectPath,
    evidenceDir,
    verifyApproval,
    ownerId,
    validation.sha256,
    checkBaseline,
  );
  const timeout = createTimeoutContext(options.timeoutMs, parent?.signal);
  const attempts: DevelopmentAttempt[] = [];
  const changedFiles = new Set<string>();
  const used = new Set<string>();
  let status = 'FAIL';
  let code: ErrorCode | undefined;
  let error: string | undefined;
  let cleanup = true;
  let screenshotPath: string | undefined;
  let errorCount = 0;
  const started = Date.now();
  try {
    timeout.throwIfCancelled();
    timeout.throwIfExpired();
    if (!options.rollbackOnFailure && (options.edits.length || options.repairs.length))
      throw new WheelError(
        'INVALID_ARGUMENT',
        'Unverified project changes cannot be retained; rollbackOnFailure must be true',
      );
    for (const f of await editor.apply(options.edits)) changedFiles.add(f);
    for (let index = 0; index <= options.maxRetries; index++) {
      timeout.throwIfCancelled();
      timeout.throwIfExpired();
      const passed = await editor.validate(async () => {
        await checkBaseline(timeout.signal);
        const attemptDir = path.join(evidenceDir, 'attempt-' + index);
        await mkdir(attemptDir, { recursive: true });
        const checks: Array<{ id: string; passed: boolean; actual?: unknown; error?: string }> = [];
        let bridge: PersistentRuntimeBridge | undefined;
        let shutdown: Awaited<ReturnType<PersistentRuntimeBridge['stop']>> | undefined;
        let attemptError: string | undefined;
        let runtimeDiagnostics: Awaited<ReturnType<typeof readGodotDiagnostics>> | undefined;
        let inputSnapshot: ProjectSnapshot | undefined;
        try {
          const sourceBefore = await snapshotProject(options.projectPath, timeout, [options.evidenceDir], true);
          await writeFile(path.join(attemptDir, 'source-before.json'), JSON.stringify(sourceBefore, null, 2));
          const executable = resolveGodotPathSync(options.godotPath);
          let preflightOutput: { stdout: string; stderr: string };
          try {
            preflightOutput = await execFileAsync(
              executable,
              [
                '--headless',
                '--path',
                options.projectPath,
                '--editor',
                '--quit',
                '--log-file',
                path.join(attemptDir, 'preflight-godot.log'),
              ],
              {
                windowsHide: true,
                timeout: Math.min(30000, timeout.remaining()),
                signal: timeout.signal,
                maxBuffer: 4 * 1024 * 1024,
              },
            );
          } catch (error) {
            const failed = error as Error & { stdout?: string; stderr?: string };
            await Promise.all([
              appendFile(path.join(attemptDir, 'stdout.log'), failed.stdout ?? ''),
              appendFile(path.join(attemptDir, 'stderr.log'), failed.stderr ?? ''),
            ]);
            throw new WheelError('VALIDATION_FAILED', `Godot editor preflight failed: ${failed.message}`);
          }
          await Promise.all([
            appendFile(path.join(attemptDir, 'stdout.log'), preflightOutput.stdout),
            appendFile(path.join(attemptDir, 'stderr.log'), preflightOutput.stderr),
          ]);
          const sourceAfter = await snapshotProject(options.projectPath, timeout, [options.evidenceDir], true);
          await writeFile(path.join(attemptDir, 'source-after.json'), JSON.stringify(sourceAfter, null, 2));
          if (sourceBefore.sha256 !== sourceAfter.sha256)
            throw new WheelError('CONFLICT', 'project source changed during editor preflight');
          inputSnapshot = await snapshotProject(options.projectPath, timeout, [options.evidenceDir]);
          await writeFile(path.join(attemptDir, 'input-before.json'), JSON.stringify(inputSnapshot, null, 2));
          checks.push({ id: 'preflight', passed: true, actual: { scope: 'editor_import_and_parse' } });
          bridge = await PersistentRuntimeBridge.start({
            projectPath: options.projectPath,
            godotPath: options.godotPath,
            bridgePath: options.bridgePath,
            evidenceDir: attemptDir,
            scenePath: options.scenePath,
            headless: !(options.screenshot || options.baselinePath),
            background: true,
            timeout,
          });
          await bridge.waitForEvent(options.waitEvent ?? 'level_started', timeout, { includeHistory: true });
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
            const diff = await compareScreenshots(requestedPath, sealedBaseline ?? requestedPath, {
              threshold: options.threshold,
              writeDiff: !!options.baselinePath,
              diffPath: path.join(attemptDir, 'diff.png'),
            });
            screenshotPath = requestedPath;
            if (baseline && sealedBaseline) {
              await checkBaseline(timeout.signal);
              const sealed = (await readVisualBaseline(sealedBaseline)).binding;
              if (sealed.sha256 !== baseline.binding.sha256)
                throw new WheelError('CONFLICT', 'Sealed visual baseline changed during verification');
            }
            checks.push({
              id: 'screenshot',
              passed: diff.width > 1 && diff.height > 1 && diff.differenceRatio <= options.maxDifferenceRatio,
              actual: diff,
            });
          }
        } catch (e) {
          if (e instanceof WheelError && e.code === 'CONFLICT') code = 'CONFLICT';
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
        if (inputSnapshot) {
          try {
            const after = await snapshotProject(options.projectPath, timeout, [options.evidenceDir]);
            await writeFile(path.join(attemptDir, 'input-after.json'), JSON.stringify(after, null, 2));
            const unchanged = inputSnapshot.sha256 === after.sha256;
            if (!unchanged) code = 'CONFLICT';
            checks.push({
              id: 'input_snapshot',
              passed: unchanged,
              actual: { before: inputSnapshot.sha256, after: after.sha256, fileCount: after.fileCount },
              ...(!unchanged ? { error: 'CONFLICT: project inputs changed during verification' } : {}),
            });
          } catch (e) {
            if (e instanceof WheelError && e.code === 'CONFLICT') code = 'CONFLICT';
            checks.push({ id: 'input_snapshot', passed: false, error: String(e) });
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
          checks.push({
            id: 'shutdown',
            passed: shutdownLeaks.length === 0,
            actual: { shutdown, leaks: shutdownLeaks },
          });
        const diagnostics =
          options.diagnosticsScope === 'runtime' && runtimeDiagnostics ? runtimeDiagnostics : allDiagnostics;
        errorCount = diagnostics.diagnostics.filter((d) => d.severity === 'error').length;
        checks.push({ id: 'diagnostics', passed: errorCount <= options.maxErrors, actual: diagnostics });
        try {
          await checkBaseline(timeout.signal);
        } catch (e) {
          code = classifyError(e).code;
          checks.push({ id: 'baseline_binding', passed: false, error: String(e) });
        }
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
        return passed;
      }, timeout.signal);
      if (passed) {
        status = 'PASS';
        break;
      }
      timeout.throwIfCancelled();
      timeout.throwIfExpired();
      if (index === options.maxRetries || !cleanup) break;
      const repair = options.repairs.find(
        (r) => !used.has(r.id) && attempts.at(-1)!.checks.some((c) => c.id === r.whenFailedCheckId && !c.passed),
      );
      if (!repair) break;
      for (const f of await editor.apply(repair.edits)) changedFiles.add(f);
      used.add(repair.id);
      attempts.at(-1)!.appliedRepair = repair.id;
      await writeFile(path.join(attempts.at(-1)!.evidenceDir, 'result.json'), JSON.stringify(attempts.at(-1), null, 2));
    }
  } catch (e) {
    code = classifyError(e).code;
    error = String(e);
  } finally {
    timeout.dispose();
  }
  const rollbackConflicts = await editor.rollback();
  const unresolved = editor.transactions.filter((t) =>
    ['APPLYING', 'VALIDATING', 'ROLLING_BACK', 'CONFLICT'].includes(t.state),
  );
  const committed = editor.transactions.filter((t) => t.state === 'COMMITTED');
  const rolledBack =
    status !== 'PASS' && !unresolved.length && editor.transactions.some((t) => t.state === 'ROLLED_BACK');
  if (error) status = 'FAIL';
  const result = {
    status,
    code,
    error,
    errorCount,
    plannedFiles: [...changedFiles],
    changedFiles: [...new Set(committed.flatMap((t) => t.impact))],
    persisted: committed.length ? true : unresolved.length ? null : false,
    unresolvedFiles: [...new Set(unresolved.flatMap((t) => t.impact))],
    screenshotPath,
    evidenceDir,
    cleanup,
    rolledBack,
    rollbackConflicts,
    transactions: editor.transactions,
    summary:
      status === 'PASS'
        ? used.size
          ? 'Approved repair applied and all checks passed'
          : 'All checks passed without a repair'
        : committed.length
          ? 'Project changes committed, but result/evidence delivery failed; inspect the transaction before retrying'
          : unresolved.length
            ? 'Transaction requires recovery; concurrent content was not overwritten'
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

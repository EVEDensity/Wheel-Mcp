import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, lstat, unlink, link, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WheelError } from '../error-schema.js';
import { snapshotProject } from '../project-snapshot.js';
import { createTimeoutContext } from '../timeout.js';
import { runProcess, resolveGodotPath } from '../godot-runtime.js';
import { readEditorState, type EditorState } from '../editor/editor-bridge.js';
import { resolveProjectPath } from './paths.js';
import { ProjectTransactions } from './transactions.js';
import { setTimeout as delay } from 'node:timers/promises';
import type { ProjectWriteOptions } from './write-file.js';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export type ValidatedWriteOptions = ProjectWriteOptions & {
  /** Optional client preview binding; exact hash is also included in host approval intent. */
  expectedProjectSha256?: string;
  godotPath?: string;
  timeoutMs?: number;
  validationMode?: 'engine' | 'raw';
  /** Library-only: native save supplies an exact live-document guard. Not a tool argument. */ allowDirtyScene?: boolean;
};
export type CandidateFile = { path: string; content: string | Buffer; expectedSha256: string | null };

/** Each Windows editor import needs its own settings profile, even for headless validation. */
async function isolatedValidationExecutable(source: string, stageRoot: string): Promise<string> {
  if (process.platform !== 'win32') return source;
  const engineDir = path.join(stageRoot, 'engine');
  await mkdir(engineDir);
  const target = path.join(engineDir, path.basename(source));
  const install = async (from: string, to: string) => {
    try {
      await link(from, to);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw error;
      await copyFile(from, to);
    }
  };
  await install(source, target);
  if (/_console\.exe$/i.test(source))
    await install(source.replace(/_console\.exe$/i, '.exe'), target.replace(/_console\.exe$/i, '.exe'));
  await writeFile(path.join(engineDir, '_sc_'), '');
  return target;
}

export async function cleanupValidationStage(stageRoot: string): Promise<void> {
  const tempRoot = path.resolve(os.tmpdir());
  const exactStage = path.resolve(stageRoot);
  if (path.dirname(exactStage) !== tempRoot || !/^wheel-validate-[A-Za-z0-9]+$/.test(path.basename(exactStage)))
    throw new WheelError('FORBIDDEN', 'Validation cleanup target escaped the temporary root');
  // Windows can retain short-lived image/import/antivirus locks after process
  // close. Bound backoff for the entire tree (not a retry budget per file), and
  // recheck the root on each attempt. Persistent errors prevent source writes.
  const transient = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM']);
  for (let attempt = 0; ; attempt++) {
    try {
      const info = await lstat(exactStage);
      if (info.isSymbolicLink()) throw new WheelError('FORBIDDEN', 'Validation stage became a symlink');
      await rm(exactStage, { recursive: true, force: false, maxRetries: 0 });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (code === 'ENOENT') {
        // A missing child is not proof that the entire stage was removed.
        const remaining = await lstat(exactStage).catch((probe) => {
          if (probe.code === 'ENOENT') return undefined;
          throw probe;
        });
        if (!remaining) return;
        throw error;
      }
      if (!transient.has(code) || attempt === 6) throw error;
      await delay(100 * (attempt + 1)); // At most 2.1 seconds total backoff.
    }
  }
}

/** Pure fail-closed guard. Script dependencies may affect any candidate, not only the edited path. */
export function assertEditorStateDocumentsClean(state: EditorState, paths: string[], allowDirtyScene = false): void {
  if (state.dirty.scriptsStatus !== 'KNOWN' || !state.dirty.scripts)
    throw new WheelError(
      'UNSUPPORTED',
      'Editor cannot reliably report unsaved scripts; upgrade the opted-in bridge before writing',
    );
  if (state.dirty.scripts.length)
    throw new WheelError(
      'CONFLICT',
      'Editor has unsaved scripts; preserve and resolve them before writing project files',
    );
  if (!allowDirtyScene && paths.some((p) => state.dirty.scenes.includes('res://' + p)))
    throw new WheelError(
      'CONFLICT',
      'File write would overwrite an unsaved editor scene; use approved native save or resolve it in the editor',
    );
}

/** Do not replace a dirty document with a file tool. Absence of an enabled editor is not emulated. */
export async function assertDocumentsClean(
  projectPath: string,
  ownerId: string,
  paths: string[],
  signal?: AbortSignal,
  allowDirtyScene = false,
) {
  if (!(await lstat(path.join(projectPath, '.harness/editor-endpoint.json')).catch(() => undefined))) return;
  const state = await readEditorState(projectPath, ownerId, { signal });
  assertEditorStateDocumentsClean(state, paths, allowDirtyScene);
}

export async function validateCandidateFiles(
  projectPath: string,
  files: CandidateFile[],
  options: ValidatedWriteOptions = {},
  /** Library-only scene move: remove old paths from the isolated candidate, never the original. */
  removedPaths: readonly string[] = [],
) {
  const timeout = createTimeoutContext(options.timeoutMs ?? 60000, options.signal);
  const id = randomUUID();
  let evidenceDir: string | undefined;
  let safeEvidence = false;
  let stageRoot: string | undefined;
  let primaryFailure: unknown;
  let outcome: { evidenceDir: string; inputHash: string; validation: 'PASS'; scope: string } | undefined;
  try {
    const evidence = await resolveProjectPath(projectPath, 'project.godot', { mode: 'read' });
    evidenceDir = path.join(evidence.root, '.harness', 'validation', id);
    for (const part of [
      path.join(evidence.root, '.harness'),
      path.join(evidence.root, '.harness', 'validation'),
      evidenceDir,
    ]) {
      const info = await lstat(part).catch((error) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (info && (!info.isDirectory() || info.isSymbolicLink()))
        throw new WheelError('FORBIDDEN', 'Unsafe validation evidence directory');
      if (!info) await mkdir(part);
    }
    safeEvidence = true;
    const inputs = await snapshotProject(evidence.root, timeout);
    if (inputs.totalBytes > 256 * 1024 * 1024)
      throw new WheelError('UNSUPPORTED', 'Isolated validation snapshot exceeds 256 MiB');
    stageRoot = await mkdtemp(path.join(os.tmpdir(), 'wheel-validate-'));
    const stage = path.join(stageRoot, 'project');
    await mkdir(stage);
    for (const item of inputs.files) {
      timeout.throwIfCancelled();
      const source = await resolveProjectPath(evidence.root, item.path, { mode: 'read' });
      const bytes = await readFile(source.absolutePath);
      if (sha(bytes) !== item.sha256)
        throw new WheelError('CONFLICT', 'Project changed while copying validation snapshot');
      const target = path.join(stage, item.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx' });
    }
    for (const file of files) {
      // Resource declarations may not escape the isolated res:// context.
      for (const match of (typeof file.content === 'string' ? file.content : '').matchAll(
        /\[ext_resource[^\]\n]*\bpath="([^"\n]+)"/g,
      )) {
        if (!match[1].startsWith('res://'))
          throw new WheelError('FORBIDDEN', 'External resource paths must be project-local res:// paths');
        await resolveProjectPath(stage, match[1], { mode: 'write' });
      }
      const target = path.join(stage, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }
    for (const removed of removedPaths) {
      const target = await resolveProjectPath(stage, removed, { mode: 'write' });
      await unlink(target.absolutePath);
    }
    // Only this temporary project disables editor plugin activation; the source configuration stays intact.
    const projectFile = path.join(stage, 'project.godot');
    const settings = await readFile(projectFile, 'utf8');
    await writeFile(
      projectFile,
      settings.replace(/\[editor_plugins\][\s\S]*?(?=\n\[|$)/g, '[editor_plugins]\nenabled=PackedStringArray()\n'),
    );
    const executable = await isolatedValidationExecutable(resolveGodotPath(options.godotPath), stageRoot);
    await writeFile(
      path.join(evidenceDir, 'inputs.json'),
      JSON.stringify(
        {
          inputs,
          files: files.map((f) => ({ path: f.path, sha256: sha(f.content) })),
          removedPaths,
          stage,
          executable,
        },
        null,
        2,
      ),
    );
    const preflight = await runProcess(
      executable,
      ['--headless', '--editor', '--import', '--path', stage],
      stage,
      Math.max(1, timeout.remaining() / 1000),
      {},
      timeout,
    );
    const output = path.join(evidenceDir, 'validation-result.json');
    const checker = fileURLToPath(new URL('../../../godot-plugin/validate_resources.gd', import.meta.url));
    const checked = await runProcess(
      executable,
      ['--headless', '--path', stage, '--script', checker],
      stage,
      Math.max(1, timeout.remaining() / 1000),
      {
        WHEEL_VALIDATION_FILES: JSON.stringify(
          files.filter((f) => f.path !== 'project.godot').map((f) => 'res://' + f.path),
        ),
        WHEEL_VALIDATION_OUTPUT: output,
      },
      timeout,
    );
    const result = await readFile(output, 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    const diagnostics = preflight.stdout + '\n' + preflight.stderr + '\n' + checked.stdout + '\n' + checked.stderr;
    const passed =
      preflight.exitCode === 0 &&
      !preflight.timed_out &&
      !preflight.cancelled &&
      checked.exitCode === 0 &&
      !checked.timed_out &&
      !checked.cancelled &&
      result?.status === 'PASS' &&
      !/SCRIPT ERROR|\bERROR:/.test(diagnostics);
    await writeFile(
      path.join(evidenceDir, 'report.json'),
      JSON.stringify(
        { status: passed ? 'PASS' : 'FAIL', inputsHash: inputs.sha256, preflight, checked, result },
        null,
        2,
      ),
    );
    if (!passed)
      throw new WheelError('VALIDATION_FAILED', 'Candidate engine validation failed; originals were not touched', {
        evidenceDir,
        result,
      });
    if ((await snapshotProject(evidence.root, timeout)).sha256 !== inputs.sha256)
      throw new WheelError('CONFLICT', 'Source project changed during isolated validation', { evidenceDir });
    if (typeof result.scope !== 'string')
      throw new WheelError('PROTOCOL_MISMATCH', 'Godot validation report omitted its scope');
    outcome = { evidenceDir, inputHash: inputs.sha256, validation: 'PASS', scope: result.scope };
  } catch (error) {
    primaryFailure = error;
    if (safeEvidence && evidenceDir)
      await writeFile(
        path.join(evidenceDir, 'failure.json'),
        JSON.stringify(
          {
            status: 'FAIL',
            originalsTouched: false,
            code: (error as { code?: string }).code ?? 'FAILED',
            message: (error as Error).message,
          },
          null,
          2,
        ),
      );
  } finally {
    timeout.dispose();
    if (stageRoot) {
      try {
        await cleanupValidationStage(stageRoot);
      } catch (error) {
        const cause = error as NodeJS.ErrnoException;
        if (cause.code !== 'ENOENT') {
          const failure = {
            status: 'FAIL',
            originalsTouched: false,
            code: 'ENGINE_UNAVAILABLE',
            message: `Temporary validation stage cleanup failed: ${cause.code ?? 'UNKNOWN'}: ${cause.message}`,
            evidenceDir,
            stageRoot,
            cleanup: { code: cause.code ?? 'UNKNOWN', syscall: cause.syscall, message: cause.message },
            primaryFailure: primaryFailure ? { message: (primaryFailure as Error).message } : null,
          };
          if (safeEvidence && evidenceDir)
            await writeFile(path.join(evidenceDir, 'failure.json'), JSON.stringify(failure, null, 2));
          primaryFailure ??= new WheelError('ENGINE_UNAVAILABLE', failure.message, failure);
        }
      }
    }
  }
  if (primaryFailure) throw primaryFailure;
  if (!outcome) throw new WheelError('ENGINE_UNAVAILABLE', 'Validation ended without an outcome');
  return outcome;
}

export async function writeValidatedProjectFiles(
  projectPath: string,
  files: CandidateFile[],
  options: ValidatedWriteOptions = {},
) {
  if (files.length < 1 || files.length > 16) throw new WheelError('INVALID_ARGUMENT', 'Expected 1..16 candidate files');
  if (options.allowDirtyScene && !options.beforeApply)
    throw new WheelError('FORBIDDEN', 'Dirty scene save requires an exact native document guard');
  const normalized: CandidateFile[] = [];
  for (const file of files) {
    const resolved = await resolveProjectPath(projectPath, file.path, { mode: 'write', allowAbsolute: true });
    normalized.push({ ...file, path: resolved.relativePath });
  }
  const owner = options.ownerId ?? 'local-library';
  await assertDocumentsClean(
    projectPath,
    owner,
    normalized.map((f) => f.path),
    options.signal,
    options.allowDirtyScene,
  );
  const raw = options.validationMode === 'raw';
  if (options.expectedProjectSha256 !== undefined && (raw || !/^[a-f0-9]{64}$/.test(options.expectedProjectSha256)))
    throw new WheelError('INVALID_ARGUMENT', 'Preview project hash requires engine validation and a SHA-256 digest');
  if (normalized.some((f) => Buffer.isBuffer(f.content) && (raw || !/\.png$/.test(f.path))))
    throw new WheelError('UNSUPPORTED', 'Binary candidates require native PNG import validation');
  const beforeApproval = raw ? undefined : await snapshotProject(projectPath);
  if (options.expectedProjectSha256 && beforeApproval?.sha256 !== options.expectedProjectSha256)
    throw new WheelError('CONFLICT', 'Project changed since the preview; obtain and review a fresh candidate');
  if (
    !raw &&
    normalized.some(
      (f) =>
        f.path !== 'project.godot' &&
        !/\.(tscn|tres|gd)$/.test(f.path) &&
        !(Buffer.isBuffer(f.content) && /\.png$/.test(f.path)),
    )
  )
    throw new WheelError(
      'UNSUPPORTED',
      'Engine validation supports root project.godot, .tscn/.tres/.gd text and .png bytes; choose explicit raw with risk approval for other text',
    );
  const intent =
    (raw
      ? 'RAW TEXT: validation NOT_RUN; may break project; exact risk approval required'
      : 'ENGINE: isolated correct-res:// candidate import/parse/load; no gameplay or render guarantee') +
    (options.expectedProjectSha256 ? '\nPREVIEW PROJECT SHA-256: ' + options.expectedProjectSha256 : '') +
    (options.intent ? '\n' + options.intent : '');
  const service = new ProjectTransactions({
    projectPath,
    ownerId: owner,
    intent,
    verifyApproval: options.verifyApproval,
    beforeApply: async () => {
      await assertDocumentsClean(
        projectPath,
        owner,
        normalized.map((f) => f.path),
        options.signal,
        options.allowDirtyScene,
      );
      if (validation && (await snapshotProject(projectPath)).sha256 !== validation.inputHash)
        throw new WheelError('CONFLICT', 'Project dependencies changed after validation/approval', {
          evidenceDir: validation.evidenceDir,
        });
      await options.beforeApply?.(options.signal);
    },
  });
  await service.recoverPending();
  const plan = await service.prepare(
    normalized.map((f) =>
      f.expectedSha256 === null
        ? { kind: 'create' as const, path: f.path, content: f.content }
        : { kind: 'replace' as const, path: f.path, content: f.content, expectedSha256: f.expectedSha256 },
    ),
    options.operationId,
  );
  const verifyBytes = async () => {
    for (const file of normalized)
      if (
        sha(await readFile((await resolveProjectPath(projectPath, file.path, { mode: 'read' })).absolutePath)) !==
        sha(file.content)
      )
        return false;
    return true;
  };
  if ((await service.inspect(plan.operationId)).state === 'COMMITTED' && !(await verifyBytes()))
    throw new WheelError(
      'CONFLICT',
      'Previously committed candidate bytes have changed; retry cannot overwrite human changes',
    );
  // Approval has a distinct validation/risk intent bound into the exact transaction hash.
  if ((await service.inspect(plan.operationId)).state === 'PREPARED')
    await service.approve(plan.operationId, options.signal);
  if (beforeApproval && (await snapshotProject(projectPath)).sha256 !== beforeApproval.sha256)
    throw new WheelError('CONFLICT', 'Project inputs changed during approval; review a fresh plan');
  const validation = raw ? undefined : await validateCandidateFiles(projectPath, normalized, options);
  const state = await service.apply(plan.operationId, verifyBytes, options.signal);
  if (state !== 'COMMITTED') throw new WheelError('VALIDATION_FAILED', `Candidate transaction ended in ${state}`);
  if (!(await verifyBytes())) throw new WheelError('CONFLICT', 'Committed bytes no longer match candidate');
  return {
    status: 'PASS',
    source: 'REAL',
    persisted: true,
    validation: raw ? 'NOT_RUN' : 'PASS',
    validationScope: raw ? 'RAW TEXT: engine validation not performed' : validation?.scope,
    evidenceDir: validation?.evidenceDir,
    operationId: plan.operationId,
    planHash: plan.planHash,
    transactionState: state,
    projectInputSha256: validation?.inputHash,
    paths: normalized.map((f) => f.path),
  };
}

export async function writeValidatedProjectText(
  projectPath: string,
  filePath: string,
  content: string,
  options: ValidatedWriteOptions = {},
) {
  const resolved = await resolveProjectPath(projectPath, filePath, { mode: 'write', allowAbsolute: true });
  if (options.operationId && options.expectedSha256 === undefined)
    throw new WheelError('INVALID_ARGUMENT', 'Expected hash or null required with operationId');
  const bytes = await readFile(resolved.absolutePath).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const expected = options.expectedSha256 === undefined ? (bytes === null ? null : sha(bytes)) : options.expectedSha256;
  return writeValidatedProjectFiles(
    projectPath,
    [{ path: resolved.relativePath, content, expectedSha256: expected }],
    options,
  );
}

import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WheelError } from '../error-schema.js';
import { snapshotProject } from '../project-snapshot.js';
import { createTimeoutContext } from '../timeout.js';
import { runProcess, resolveGodotPath } from '../godot-runtime.js';
import { readEditorState } from '../editor/editor-bridge.js';
import { resolveProjectPath } from './paths.js';
import { ProjectTransactions } from './transactions.js';
import type { ProjectWriteOptions } from './write-file.js';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export type ValidatedWriteOptions = ProjectWriteOptions & {
  godotPath?: string;
  timeoutMs?: number;
  validationMode?: 'engine' | 'raw';
  /** Library-only: native save supplies an exact live-document guard. Not a tool argument. */ allowDirtyScene?: boolean;
};
export type CandidateFile = { path: string; content: string; expectedSha256: string | null };

/** Do not replace a dirty document with a file tool. Absence of an enabled editor is not emulated. */
export async function assertDocumentsClean(
  projectPath: string,
  ownerId: string,
  paths: string[],
  signal?: AbortSignal,
) {
  if (!(await lstat(path.join(projectPath, '.harness/editor-endpoint.json')).catch(() => undefined))) return;
  const state = await readEditorState(projectPath, ownerId, { signal });
  const dirty = new Set(state.dirty.scenes);
  if (paths.some((p) => dirty.has('res://' + p)))
    throw new WheelError(
      'CONFLICT',
      'File write would overwrite an unsaved editor scene; use approved native save or resolve it in the editor',
    );
}

export async function validateCandidateFiles(
  projectPath: string,
  files: CandidateFile[],
  options: ValidatedWriteOptions = {},
) {
  const timeout = createTimeoutContext(options.timeoutMs ?? 60000, options.signal);
  const id = randomUUID();
  let evidenceDir: string | undefined;
  let safeEvidence = false;
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
    const stage = path.join(await mkdtemp(path.join(os.tmpdir(), 'wheel-validate-')), 'project');
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
      for (const match of file.content.matchAll(/\[ext_resource[^\]\n]*\bpath="([^"\n]+)"/g)) {
        if (!match[1].startsWith('res://'))
          throw new WheelError('FORBIDDEN', 'External resource paths must be project-local res:// paths');
        await resolveProjectPath(stage, match[1], { mode: 'write' });
      }
      const target = path.join(stage, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }
    // Only this temporary project disables editor plugin activation; the source configuration stays intact.
    const projectFile = path.join(stage, 'project.godot');
    const settings = await readFile(projectFile, 'utf8');
    await writeFile(
      projectFile,
      settings.replace(/\[editor_plugins\][\s\S]*?(?=\n\[|$)/g, '[editor_plugins]\nenabled=PackedStringArray()\n'),
    );
    const executable = resolveGodotPath(options.godotPath);
    await writeFile(
      path.join(evidenceDir, 'inputs.json'),
      JSON.stringify(
        { inputs, files: files.map((f) => ({ path: f.path, sha256: sha(f.content) })), stage, executable },
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
      { WHEEL_VALIDATION_FILES: JSON.stringify(files.map((f) => 'res://' + f.path)), WHEEL_VALIDATION_OUTPUT: output },
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
    return { evidenceDir, inputHash: inputs.sha256, validation: 'PASS' as const, scope: result.scope };
  } catch (error) {
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
    throw error;
  } finally {
    timeout.dispose();
  }
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
  if (!options.allowDirtyScene)
    await assertDocumentsClean(
      projectPath,
      owner,
      normalized.map((f) => f.path),
      options.signal,
    );
  const raw = options.validationMode === 'raw';
  const beforeApproval = raw ? undefined : await snapshotProject(projectPath);
  if (!raw && normalized.some((f) => !/\.(tscn|tres|gd)$/.test(f.path)))
    throw new WheelError(
      'UNSUPPORTED',
      'Engine validation supports .tscn/.tres/.gd; choose explicit raw with risk approval for other text',
    );
  const intent =
    (raw
      ? 'RAW TEXT: validation NOT_RUN; may break project; exact risk approval required'
      : 'ENGINE: isolated correct-res:// candidate import/parse/load; no gameplay or render guarantee') +
    (options.intent ? '\n' + options.intent : '');
  const service = new ProjectTransactions({
    projectPath,
    ownerId: owner,
    intent,
    verifyApproval: options.verifyApproval,
    beforeApply: async () => {
      if (!options.allowDirtyScene)
        await assertDocumentsClean(
          projectPath,
          owner,
          normalized.map((f) => f.path),
          options.signal,
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

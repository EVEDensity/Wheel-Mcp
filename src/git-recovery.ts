import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { TimeoutContext } from './timeout.js';
import { WheelError } from './error-schema.js';
import { resolveProjectPath } from './project/paths.js';
import { ProjectTransactions, type TransactionOperation, type ApprovalVerifier } from './project/transactions.js';

export async function gitCheckpoint(projectPath: string, evidenceDir?: string, timeout?: TimeoutContext) {
  timeout?.throwIfCancelled();
  const root = path.resolve(projectPath);
  const evidence = path.resolve(evidenceDir || path.join(root, '.harness', 'git'));
  await mkdir(evidence, { recursive: true });
  const head = await runGit(root, ['rev-parse', 'HEAD'], timeout);
  const status = await runGit(root, ['status', '--short'], timeout);
  const diff = await runGit(root, ['diff', '--binary'], timeout);
  if (head.exitCode !== 0) throw new Error(`Not a Git repository: ${head.stderr.trim()}`);
  const metadata = {
    schema_version: '0.1',
    source: 'REAL',
    project_path: root,
    head: head.stdout.trim(),
    status: status.stdout,
    created_at: new Date().toISOString(),
    patch: path.join(evidence, 'diff.patch'),
    status_file: path.join(evidence, 'status.txt'),
  };
  await writeFile(metadata.patch, diff.stdout);
  await writeFile(metadata.status_file, status.stdout);
  await writeFile(path.join(evidence, 'checkpoint.json'), JSON.stringify(metadata, null, 2));
  return metadata;
}

export async function gitRecovery(
  projectPath: string,
  patchPath: string,
  timeout?: TimeoutContext,
  verifyApproval?: ApprovalVerifier,
  ownerId?: string,
) {
  timeout?.throwIfCancelled();
  const root = path.resolve(projectPath);
  const patch = path.resolve(patchPath);
  const bytes = await readFile(patch);
  if (bytes.length > 1024 * 1024) throw new WheelError('UNSUPPORTED', 'Recovery patch exceeds 1 MiB');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (
    /^(?:GIT binary patch|Binary files|rename |copy |old mode|new mode)/m.test(text) ||
    /^(?:new file mode|deleted file mode) (?!100644\s*$)/m.test(text) ||
    /^index .* (?!100644\s*$)\d{6}\s*$/m.test(text)
  )
    throw new WheelError(
      'UNSUPPORTED',
      'Recovery supports regular UTF-8 text patches only; no binary, links, mode changes, copies or renames',
    );
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'wheel-patch-preview-'));
  const mirror = path.join(sandbox, 'work');
  try {
    await mkdir(mirror);
    const privatePatch = path.join(sandbox, 'reverse.patch');
    await writeFile(privatePatch, bytes, { flag: 'wx', mode: 0o600 });
    const gitTextConfig = ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf'];
    const stats = await runGit(
      mirror,
      [...gitTextConfig, 'apply', '--reverse', '--numstat', '-z', '--', privatePatch],
      timeout,
    );
    if (stats.exitCode !== 0) throw new WheelError('INVALID_ARGUMENT', 'Git rejected recovery patch');
    const files = stats.stdout
      .split('\0')
      .filter(Boolean)
      .map((record) => {
        const match = /^\d+\t\d+\t([\s\S]+)$/.exec(record);
        if (!match) throw new WheelError('UNSUPPORTED', 'Unsupported recovery patch target');
        return match[1];
      });
    if (!files.length || files.length > 16 || new Set(files).size !== files.length)
      throw new WheelError('INVALID_ARGUMENT', 'Recovery requires 1–16 unique regular text targets');
    files.sort();
    const before = new Map<string, string | null>();
    const snapshot = async (file: string): Promise<string | null> => {
      try {
        const content = await readFile(file);
        if (content.length > 8 * 1024 * 1024) throw new WheelError('UNSUPPORTED', 'Recovery target exceeds 8 MiB');
        return new TextDecoder('utf-8', { fatal: true }).decode(content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    };
    for (const file of files) {
      timeout?.throwIfCancelled();
      const source = await resolveProjectPath(root, file, { mode: 'write' });
      const content = await snapshot(source.absolutePath);
      before.set(file, content);
      await mkdir(path.dirname(path.join(mirror, file)), { recursive: true });
      if (content !== null) await writeFile(path.join(mirror, file), content, { flag: 'wx', mode: 0o600 });
    }
    // Git only mutates our private disposable mirror. Real project writes are journaled below.
    const result = await runGit(
      mirror,
      [...gitTextConfig, 'apply', '--reverse', '--whitespace=nowarn', '--', privatePatch],
      timeout,
    );
    if (result.exitCode !== 0) throw new WheelError('CONFLICT', 'Recovery patch does not match current project text');
    const digest = (content: string) => createHash('sha256').update(content).digest('hex');
    const operations: TransactionOperation[] = [];
    for (const file of files) {
      const target = await resolveProjectPath(mirror, file, { mode: 'write' });
      const old = before.get(file)!;
      const after = await snapshot(target.absolutePath);
      if (old === after) continue;
      if (after === null && old !== null) operations.push({ kind: 'delete', path: file, expectedSha256: digest(old) });
      else if (after !== null && old === null) operations.push({ kind: 'create', path: file, content: after });
      else if (after !== null && old !== null)
        operations.push({ kind: 'replace', path: file, content: after, expectedSha256: digest(old) });
    }
    const service = new ProjectTransactions({ projectPath: root, ownerId, verifyApproval });
    await service.recoverPending();
    if ((await service.list()).some((t) => t.state === 'CONFLICT'))
      throw new WheelError('CONFLICT', 'Unresolved project transaction requires operator recovery');
    const plan = await service.prepare(operations);
    await service.approve(plan.operationId, timeout?.signal);
    const state = await service.apply(plan.operationId, async () => true, timeout?.signal);
    return {
      schema_version: '0.1',
      source: 'REAL',
      project_path: root,
      patch_path: patch,
      exit_code: state === 'COMMITTED' ? 0 : 1,
      stdout: '',
      stderr: '',
      status: state === 'COMMITTED' ? 'PASS' : 'FAIL',
      operationId: plan.operationId,
      planHash: plan.planHash,
      transactionState: state,
      validation: 'NOT_RUN',
    };
  } finally {
    // This is exactly the mkdtemp directory created above, never a caller-supplied path.
    await rm(sandbox, { recursive: true, force: true });
  }
}

type GitResult = { exitCode: number | null; stdout: string; stderr: string };
export function runGit(cwd: string, args: string[], timeout?: TimeoutContext): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, windowsHide: true });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    let settled = false;
    let aborted = false;
    const finish = (value: GitResult) => {
      if (settled) return;
      settled = true;
      timeout?.signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => {
      if (child.pid) child.kill();
      aborted = true;
    };
    timeout?.signal.addEventListener('abort', onAbort, { once: true });
    child.once('error', (error) => finish({ exitCode: null, stdout, stderr: `${stderr}${error.message}` }));
    child.once('close', (exitCode) =>
      finish({ exitCode: aborted ? null : exitCode, stdout, stderr: aborted ? 'git operation cancelled' : stderr }),
    );
  });
}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { TimeoutContext } from './timeout.js';

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

export async function gitRecovery(projectPath: string, patchPath: string, timeout?: TimeoutContext) {
  timeout?.throwIfCancelled();
  const root = path.resolve(projectPath);
  const patch = path.resolve(patchPath);
  await readFile(patch);
  const result = await runGit(root, ['apply', '--reverse', '--whitespace=nowarn', '--', patch], timeout);
  return {
    schema_version: '0.1',
    source: 'REAL',
    project_path: root,
    patch_path: patch,
    exit_code: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.exitCode === 0 ? 'PASS' : 'FAIL',
  };
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
    const finish = (value: GitResult) => {
      if (settled) return;
      settled = true;
      timeout?.signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => {
      if (child.pid) child.kill();
      finish({ exitCode: null, stdout, stderr: 'git operation cancelled' });
    };
    timeout?.signal.addEventListener('abort', onAbort, { once: true });
    child.once('error', (error) => finish({ exitCode: null, stdout, stderr: `${stderr}${error.message}` }));
    child.once('close', (exitCode) => finish({ exitCode, stdout, stderr }));
  });
}

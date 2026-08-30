// @ts-nocheck
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export async function gitCheckpoint(projectPath, evidenceDir) {
  const root = path.resolve(projectPath);
  const evidence = path.resolve(evidenceDir || path.join(root, '.harness', 'git'));
  await mkdir(evidence, { recursive: true });
  const head = await runGit(root, ['rev-parse', 'HEAD']);
  const status = await runGit(root, ['status', '--short']);
  const diff = await runGit(root, ['diff', '--binary']);
  if (head.exitCode !== 0) throw new Error(`Not a Git repository: ${head.stderr.trim()}`);
  const metadata = {
    schema_version: '0.1', source: 'REAL', project_path: root,
    head: head.stdout.trim(), status: status.stdout, created_at: new Date().toISOString(),
    patch: path.join(evidence, 'diff.patch'), status_file: path.join(evidence, 'status.txt')
  };
  await writeFile(metadata.patch, diff.stdout);
  await writeFile(metadata.status_file, status.stdout);
  await writeFile(path.join(evidence, 'checkpoint.json'), JSON.stringify(metadata, null, 2));
  return metadata;
}

export async function gitRecovery(projectPath, patchPath) {
  const root = path.resolve(projectPath);
  const patch = path.resolve(patchPath);
  await readFile(patch);
  const result = await runGit(root, ['apply', '--reverse', '--whitespace=nowarn', '--', patch]);
  return {
    schema_version: '0.1', source: 'REAL', project_path: root, patch_path: patch,
    exit_code: result.exitCode, stdout: result.stdout, stderr: result.stderr,
    status: result.exitCode === 0 ? 'PASS' : 'FAIL'
  };
}

function runGit(cwd, args) {
  return new Promise(resolve => {
    const child = spawn('git', args, { cwd, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => resolve({ exitCode: null, stdout, stderr: `${stderr}${error.message}` }));
    child.once('close', exitCode => resolve({ exitCode, stdout, stderr }));
  });
}

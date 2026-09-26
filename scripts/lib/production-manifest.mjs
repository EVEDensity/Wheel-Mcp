import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { summarizeTestEvents } from './test-report.mjs';

export const sha256 = (input) => createHash('sha256').update(input).digest('hex');
export async function sourceIdentity(root) {
  const names = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((name) =>
      /^(src\/|scripts\/|tests\/|godot-plugin\/|\.github\/workflows\/|docs\/production-roadmap\/run-manifest\.schema\.json$|package(?:-lock)?\.json$|tsconfig\.json$|eslint\.config\.mjs$)/.test(
        name,
      ),
    )
    .sort();
  const files = [];
  for (const name of names) files.push({ path: name, sha256: sha256(await readFile(path.join(root, name))) });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const diff = execFileSync(
    'git',
    [
      'diff',
      '--binary',
      '--',
      'src',
      'scripts',
      'tests',
      'godot-plugin',
      '.github/workflows',
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'eslint.config.mjs',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  return {
    head,
    sourceHash: sha256(JSON.stringify(files)),
    files,
    diffHash: sha256(diff),
    lockHash: files.find((file) => file.path === 'package-lock.json')?.sha256 ?? null,
  };
}

export function assessTestRun(exitCode, reportText) {
  try {
    const summary = summarizeTestEvents(reportText);
    return {
      status:
        exitCode === 0 && summary.failed === 0 && summary.skipped === 0 && summary.cancelled === 0 && summary.todo === 0
          ? 'PASS'
          : 'FAIL',
      summary,
    };
  } catch (error) {
    return { status: 'FAIL', reportError: error.message, summary: null };
  }
}

export function validateRunManifest(manifest) {
  const errors = [];
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!/^T\d{2}$/.test(manifest.taskId ?? '') || !/^G[0-6]$/.test(manifest.gateId ?? ''))
    errors.push('invalid task or gate id');
  if (!/^[a-f0-9]{64}$/.test(manifest.source?.sourceHash ?? '') || !/^[a-f0-9]{40}$/.test(manifest.source?.head ?? ''))
    errors.push('missing source identity');
  if (
    !manifest.environment?.node ||
    !manifest.environment?.os ||
    !manifest.environment?.godot ||
    !manifest.environment?.renderer
  )
    errors.push('missing environment identity');
  if (!Array.isArray(manifest.commands) || !manifest.commands.length) errors.push('missing command results');
  for (const command of manifest.commands ?? []) {
    if (
      !command.name ||
      !Array.isArray(command.argv) ||
      !Number.isFinite(command.durationMs) ||
      !['PASS', 'FAIL', 'SKIP', 'NOT_RUN', 'EXPECTED_DEFECT'].includes(command.status) ||
      (command.exitCode !== null && !Number.isInteger(command.exitCode)) ||
      !('signal' in command) ||
      !command.outputHash
    )
      errors.push(`invalid command record: ${command.name ?? '?'}`);
    if (
      command.required &&
      command.status === 'PASS' &&
      (command.exitCode !== 0 || command.tests?.skipped || command.tests?.cancelled || command.tests?.todo)
    )
      errors.push(`invalid PASS: ${command.name}`);
  }
  if (
    !/^[a-f0-9]{64}$/.test(manifest.inputSnapshotHash ?? '') ||
    !manifest.startedAt ||
    !manifest.finishedAt ||
    !Number.isFinite(manifest.durationMs) ||
    !manifest.testDouble ||
    !Array.isArray(manifest.evidence)
  )
    errors.push('missing run provenance');
  return errors;
}

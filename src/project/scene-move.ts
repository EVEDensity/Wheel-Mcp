import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotProject } from '../project-snapshot.js';
import { WheelError } from '../error-schema.js';
import { createTimeoutContext } from '../timeout.js';
import { resolveProjectPath } from './paths.js';
import { ProjectTransactions, type TransactionOperation } from './transactions.js';
import { validateCandidateFiles, type CandidateFile, type ValidatedWriteOptions } from './validated-write.js';

const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

async function identicalBundledPlugin(relative: string, bytes: Buffer): Promise<boolean> {
  if (!/^addons\/wheel_mcp\/[A-Za-z0-9_-]+\.gd$/.test(relative)) return false;
  const bundled = fileURLToPath(new URL(`../../../godot-plugin/${relative}`, import.meta.url));
  const trusted = await readFile(bundled).catch(() => null);
  return trusted !== null && trusted.length === bytes.length && trusted.equals(bytes);
}

/** Conservative reference impact plan: declarations and application main_scene only.
 * Arbitrary code/dynamic/imported/binary references are conflicts, never global replacements. */
export async function planSceneMove(projectPath: string, from: string, to: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const source = await resolveProjectPath(projectPath, from, { mode: 'write' });
  const target = await resolveProjectPath(projectPath, to, { mode: 'write' });
  if (!source.relativePath.endsWith('.tscn') || !target.relativePath.endsWith('.tscn'))
    throw new WheelError('INVALID_ARGUMENT', 'Scene move requires .tscn source and destination');
  if (
    source.relativePath.toLowerCase() === target.relativePath.toLowerCase() ||
    (await lstat(target.absolutePath).catch(() => null))
  )
    throw new WheelError('CONFLICT', 'Destination exists or aliases source; case-only moves are unsupported');
  if (
    await lstat(path.dirname(target.absolutePath))
      .then((v) => !v.isDirectory())
      .catch(() => true)
  )
    throw new WheelError('NOT_FOUND', 'Destination directory must already exist');
  const timeout = createTimeoutContext(60000, signal);
  try {
    const snapshot = await snapshotProject(source.root, timeout);
    if (snapshot.fileCount > 1000 || snapshot.totalBytes > 64 * 1024 * 1024)
      throw new WheelError('UNSUPPORTED', 'Reference-impact scanning is limited to 1000 files / 64 MiB');
    const moved = await readFile(source.absolutePath, 'utf8');
    const uid = moved.match(/^\[gd_scene[^\]\n]*\buid="(uid:\/\/[^"\n]+)"/m)?.[1] ?? null;
    const references: Array<{ path: string; lines: number[] }> = [];
    const candidates: CandidateFile[] = [{ path: target.relativePath, content: moved, expectedSha256: null }];
    const operations: TransactionOperation[] = [
      { kind: 'rename', from: source.relativePath, to: target.relativePath, expectedSha256: sha(moved) },
    ];
    for (const entry of snapshot.files) {
      timeout.throwIfCancelled();
      timeout.throwIfExpired();
      const safe = await resolveProjectPath(source.root, entry.path, { mode: 'read' });
      const bytes = await readFile(safe.absolutePath);
      if (sha(bytes) !== entry.sha256) throw new WheelError('CONFLICT', 'Project changed during impact planning');
      if (entry.path === source.relativePath) continue;
      // Our packaged, byte-identical connector contains generic res:// helpers, not
      // project scene references. Any modified or extra plugin code remains scanned.
      if (
        !bytes.includes(source.resourcePath) &&
        (!uid || !bytes.includes(uid)) &&
        (await identicalBundledPlugin(entry.path, bytes))
      )
        continue;
      if (/\.(gd|cs|gdextension)$/.test(entry.path)) {
        const code = bytes.toString('utf8');
        if (
          !entry.path.endsWith('.gd') ||
          entry.bytes > 1024 * 1024 ||
          [...code.matchAll(/\b(?:load|preload)\s*\(/g)].some(
            (match) => !/^(?:load|preload)\s*\(\s*"[^"\\]*"\s*\)/.test(code.slice(match.index)),
          )
        )
          throw new WheelError(
            'CONFLICT',
            'Dynamic code or extension references cannot be qualified for a scene move',
            { path: entry.path },
          );
      }
      if (!bytes.includes(source.resourcePath) && (!uid || !bytes.includes(uid))) continue;
      if (
        entry.bytes > 1024 * 1024 ||
        (!/\.(tscn|tres)$/.test(entry.path) && entry.path !== 'project.godot') ||
        bytes.includes(0)
      )
        throw new WheelError('CONFLICT', 'Reference cannot be reliably migrated; resolve it manually', {
          path: entry.path,
        });
      const content = bytes.toString('utf8');
      const lines: number[] = [];
      const replacement = content
        .split('\n')
        .map((line, index) => {
          if (!line.includes(source.resourcePath) && (!uid || !line.includes(uid))) return line;
          const reliable =
            (/^\s*\[ext_resource type="PackedScene" .+\]\r?$/.test(line) &&
              line.includes(`path="${source.resourcePath}"`)) ||
            (entry.path === 'project.godot' &&
              new RegExp(
                '^run/main_scene="' + source.resourcePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\r?$',
              ).test(line));
          if (!reliable || line.split(source.resourcePath).length !== 2)
            throw new WheelError('CONFLICT', 'Ambiguous, dynamic or UID-only reference requires manual review', {
              path: entry.path,
              line: index + 1,
            });
          lines.push(index + 1);
          return line.replace(source.resourcePath, target.resourcePath);
        })
        .join('\n');
      await resolveProjectPath(source.root, entry.path, { mode: 'write' });
      references.push({ path: entry.path, lines });
      candidates.push({ path: entry.path, content: replacement, expectedSha256: entry.sha256 });
      operations.push({ kind: 'replace', path: entry.path, content: replacement, expectedSha256: entry.sha256 });
    }
    if (operations.length > 15)
      throw new WheelError('UNSUPPORTED', 'Scene move impact exceeds one 16-file transaction');
    if ((await snapshotProject(source.root, timeout)).sha256 !== snapshot.sha256)
      throw new WheelError('CONFLICT', 'Project changed during scene impact planning');
    return {
      projectPath: source.root,
      from: source.relativePath,
      to: target.relativePath,
      uid,
      references,
      candidates,
      operations,
      inputHash: snapshot.sha256,
    };
  } finally {
    timeout.dispose();
  }
}

export async function moveProjectScene(
  projectPath: string,
  from: string,
  to: string,
  options: ValidatedWriteOptions = {},
) {
  const impact = await planSceneMove(projectPath, from, to, options.signal);
  // A move must not leave an open document bound to the old path or stale dependencies.
  const assertClosed = async () => {
    if (await lstat(path.join(impact.projectPath, '.harness/editor-endpoint.json')).catch(() => null))
      throw new WheelError('CONFLICT', 'Close the project editor explicitly before moving scene references');
  };
  await assertClosed();
  const service = new ProjectTransactions({
    projectPath: impact.projectPath,
    ownerId: options.ownerId ?? 'local-library',
    intent: `SCENE MOVE: ${impact.from} -> ${impact.to}; preserve UID=${impact.uid}; references=${JSON.stringify(impact.references)}; engine validation removes old source from isolated candidate. Close editor before move; reopen explicitly.`,
    verifyApproval: options.verifyApproval,
    beforeApply: async () => {
      await assertClosed();
      if (!validation || (await snapshotProject(impact.projectPath)).sha256 !== validation.inputHash)
        throw new WheelError('CONFLICT', 'Scene move dependencies changed after approval/validation');
      await options.beforeApply?.(options.signal);
    },
  });
  await service.recoverPending();
  const plan = await service.prepare(impact.operations, options.operationId);
  await service.approve(plan.operationId, options.signal);
  if ((await snapshotProject(impact.projectPath)).sha256 !== impact.inputHash)
    throw new WheelError('CONFLICT', 'Project changed during scene move approval');
  const validation = await validateCandidateFiles(impact.projectPath, impact.candidates, options, [impact.from]);
  const verify = async () => {
    if (await lstat(path.join(impact.projectPath, impact.from)).catch(() => null)) return false;
    for (const file of impact.candidates) {
      const target = await resolveProjectPath(impact.projectPath, file.path, { mode: 'read' });
      if (sha(await readFile(target.absolutePath)) !== sha(file.content)) return false;
    }
    return true;
  };
  const state = await service.apply(plan.operationId, verify, options.signal);
  if (state !== 'COMMITTED' || !(await verify()))
    throw new WheelError('CONFLICT', 'Scene move did not commit exact bytes', { state, operationId: plan.operationId });
  return {
    status: 'PASS',
    source: 'REAL',
    persisted: true,
    validation: 'PASS',
    transactionState: state,
    operationId: plan.operationId,
    planHash: plan.planHash,
    from: impact.from,
    to: impact.to,
    uid: impact.uid,
    references: impact.references,
    evidenceDir: validation.evidenceDir,
    editorReload: 'REQUIRED',
  };
}

import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { WheelError } from '../error-schema.js';
import { projectRelativePath } from '../project/paths.js';
import type { ApprovalVerifier } from '../project/transactions.js';

/** Trusted host configuration only. Never accepted in MCP tool arguments. */
export type PreapprovedWritesConfig = { manifestPath: string };

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const manifestSchema = z
  .object({
    version: z.literal(1),
    grantId: identifier,
    projectPath: z.string().min(1),
    operations: z
      .array(
        z
          .object({
            operationId: identifier,
            files: z
              .array(
                z
                  .object({ path: z.string().min(1).max(512), beforeSha256: hash.nullable(), afterSha256: hash })
                  .strict(),
              )
              .min(1)
              .max(16),
          })
          .strict(),
      )
      .min(1)
      .max(1024),
  })
  .strict();

// Server-owned mode whose transaction requires isolated import/parse/load before writes.
const engineIntent = 'ENGINE: isolated correct-res:// candidate import/parse/load; no gameplay or render guarantee';

function deny(message: string): never {
  throw new WheelError('FORBIDDEN', `Local preapproved writes: ${message}`);
}

function canonicalDirectory(input: string): string {
  if (!path.isAbsolute(input)) deny('projectPath must be absolute');
  try {
    const root = realpathSync(input);
    if (!statSync(root).isDirectory()) deny('projectPath must reference a directory');
    return root;
  } catch (error) {
    if (error instanceof WheelError) throw error;
    deny('projectPath cannot be resolved to a real directory');
  }
}

function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function sameRoot(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function exactRelativePath(input: string): string {
  try {
    if (projectRelativePath(input, 'write') !== input) deny('file paths must use exact project-relative syntax');
  } catch {
    deny('unsafe project-relative file path');
  }
  return input;
}

/**
 * Snapshot a bounded host-owned manifest at server startup. Replacing the file does
 * not extend a running server's grant. Transaction CAS, validation and planHash
 * verification still run normally; this replaces only the confirmation source.
 */
export function createPreapprovedWriteVerifier(config: PreapprovedWritesConfig, actor: string): ApprovalVerifier {
  try {
    if (!path.isAbsolute(config.manifestPath)) deny('manifestPath must be absolute');
    const manifestPath = realpathSync(config.manifestPath);
    const info = statSync(manifestPath);
    if (!info.isFile() || info.nlink !== 1 || info.size > 1024 * 1024)
      deny('manifest must be a bounded regular file without hard links');
    const parsed = manifestSchema.safeParse(JSON.parse(readFileSync(manifestPath, 'utf8')));
    if (!parsed.success) deny('manifest schema is invalid');
    const manifest = parsed.data;
    const root = canonicalDirectory(manifest.projectPath);
    // Check both the physical file and its configured parent (including aliases).
    if (contained(root, manifestPath) || contained(root, realpathSync(path.dirname(config.manifestPath))))
      deny('manifest must be outside the target project');
    const operations = new Map<string, Map<string, { beforeSha256: string | null; afterSha256: string }>>();
    for (const operation of manifest.operations) {
      if (operations.has(operation.operationId)) deny('duplicate operationId');
      const files = new Map<string, { beforeSha256: string | null; afterSha256: string }>();
      const identities = new Set<string>();
      for (const file of operation.files) {
        const relative = exactRelativePath(file.path);
        const identity = process.platform === 'win32' ? relative.toLowerCase() : relative;
        if (identities.has(identity)) deny('duplicate file path');
        identities.add(identity);
        files.set(relative, { beforeSha256: file.beforeSha256, afterSha256: file.afterSha256 });
      }
      operations.set(operation.operationId, files);
    }
    return async (plan, signal) => {
      signal?.throwIfAborted();
      if (plan.intent?.split('\n')[0] !== engineIntent) deny('only engine-validated writes may use this grant');
      if (!sameRoot(canonicalDirectory(plan.projectPath), root)) deny('project does not match the grant');
      if (!/^[a-f0-9]{64}$/.test(plan.planHash)) deny('invalid transaction plan hash');
      const allowed = operations.get(plan.operationId);
      if (!allowed) deny('operationId is not granted');
      if (plan.changes.length !== allowed.size) deny('file count does not match the grant');
      const seen = new Set<string>();
      for (const change of plan.changes) {
        const relative = exactRelativePath(change.path);
        if (seen.has(relative)) deny('duplicate transaction file path');
        seen.add(relative);
        if (change.afterSha256 === null) deny('deletions are not granted');
        const file = allowed.get(relative);
        if (!file || file.beforeSha256 !== change.beforeSha256 || file.afterSha256 !== change.afterSha256)
          deny('exact file path or before/after SHA-256 does not match the grant');
      }
      signal?.throwIfAborted();
      return {
        actor: `preapproved-local:${actor}`,
        receipt: `preapproved-local:${manifest.grantId}:${plan.operationId}`,
        planHash: plan.planHash,
      };
    };
  } catch (error) {
    if (error instanceof WheelError) throw error;
    deny('manifest could not be loaded safely');
  }
}

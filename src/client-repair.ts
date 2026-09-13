import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath, lstat } from 'node:fs/promises';
import { z } from 'zod';
import { developmentLoopSchema, executeDevelopmentLoop } from './development-loop.js';
import type { TimeoutContext } from './timeout.js';

const validationSchema = developmentLoopSchema.innerType().omit({
  edits: true,
  repairs: true,
  maxRetries: true,
  rollbackOnFailure: true,
  diagnosticsScope: true,
  maxErrors: true,
  responseMode: true,
});
export const beginClientRepairSchema = validationSchema
  .extend({
    allowedRepairFiles: z.array(z.string().min(1)).min(1).max(16),
    maxCandidates: z.number().int().min(1).max(3).default(2),
  })
  .strict();
export const submitRepairCandidateSchema = z
  .object({
    repairId: z.string().uuid(),
    approved: z.literal(true),
    proposal: z
      .object({
        source: z.string().min(1).max(200),
        rationale: z.string().min(1).max(4000),
        edits: z
          .array(
            z
              .object({
                path: z.string().min(1),
                find: z.string().min(1).max(262144),
                replace: z.string().max(262144),
                expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
              })
              .strict(),
          )
          .min(1)
          .max(16),
      })
      .strict(),
  })
  .strict();
export type RepairProposal = z.infer<typeof submitRepairCandidateSchema>['proposal'];
type Snapshot = { path: string; sha256: string; content: string };
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
async function snapshots(project: string, files: string[]): Promise<Snapshot[]> {
  const root = await realpath(project);
  const result: Snapshot[] = [];
  let total = 0;
  for (const relative of files) {
    if (
      path.isAbsolute(relative) ||
      relative.includes('\\') ||
      relative
        .split('/')
        .some(
          (p) =>
            !p ||
            ['.', '..', '.git', '.godot', '.harness'].includes(p.toLowerCase()) ||
            p.includes(':') ||
            [...p].some((c) => c.charCodeAt(0) < 32) ||
            /[. ]$/.test(p),
        )
    )
      throw new Error('unsafe repair file path');
    let file = root;
    for (const part of relative.split('/')) {
      file = path.join(file, part);
      if ((await lstat(file)).isSymbolicLink()) throw new Error('repair file symlink forbidden');
    }
    if ((await realpath(file)) !== file) throw new Error('repair file must be canonical');
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > 262144) throw new Error('repair context file exceeds 256 KiB');
    const bytes = await readFile(file);
    total += bytes.length;
    if (bytes.length > 262144 || total > 1048576) throw new Error('repair context exceeds 1 MiB');
    new TextDecoder('utf8', { fatal: true }).decode(bytes);
    const content = bytes.toString('utf8');
    result.push({ path: relative, sha256: digest(content), content });
  }
  if (new Set(files.map((f) => (process.platform === 'win32' ? f.toLowerCase() : f))).size !== files.length)
    throw new Error('duplicate repair file');
  return result;
}
type Ticket = {
  options: z.infer<typeof validationSchema>;
  files: Snapshot[];
  evidenceDir: string;
  expiresAt: number;
  remaining: number;
  busy: boolean;
  submitted: number;
};
/** One instance per MCP server/session. No ambient credentials or automatic model approval. */
export class ClientRepairCoordinator {

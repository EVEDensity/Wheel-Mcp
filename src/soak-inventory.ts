/** Test-worker inventory only. A sampled inventory is not an atomic filesystem snapshot. */
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

type InventoryOptions = {
  maxFiles: number;
  maxBytes: number;
  retiredShadowDirs: ReadonlySet<string>;
  /** Authenticated native endpoint session; never a caller-supplied arbitrary directory. */
  editorOutcomeSession?: string;
  /** TEST ONLY deterministic filesystem race/error injection. */
  inspect?: typeof lstat;
};
export async function inspectSoakInventory(root: string, options: InventoryOptions) {
  const inspect = options.inspect ?? lstat;
  if (![options.maxFiles, options.maxBytes].every((n) => Number.isSafeInteger(n) && n > 0))
    throw new Error('Invalid inventory quotas');
  root = path.resolve(root);
  if (options.editorOutcomeSession !== undefined && !/^[a-f0-9]{32}$/.test(options.editorOutcomeSession))
    throw new Error('Invalid editor outcome inventory session');
  for (const dir of options.retiredShadowDirs)
    if (path.dirname(dir) !== path.join(root, '.harness', 'shadow') || !/^cycle-\d+$/.test(path.basename(dir)))
      throw new Error('Retired shadow outside the exact fixture');
  let bytes = 0,
    files = 0,
    vanishedEntries = 0;
  const vanished: Array<{ path: string; kind: string }> = [];
  function knownRemoval(file: string, error: unknown, observedFile = false): boolean {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
    const uid =
      observedFile &&
      path.dirname(file) === path.join(root, '.harness', 'scene-staging') &&
      /^[a-f0-9]{32,64}\.tscn\.uidren\d+\.tmp$/.test(path.basename(file));
    const ledger =
      observedFile &&
      options.editorOutcomeSession !== undefined &&
      path.dirname(path.dirname(file)) ===
        path.join(root, '.harness', `editor-outcomes-${options.editorOutcomeSession}`) &&
      /^[a-f0-9]{64}$/.test(path.basename(path.dirname(file))) &&
      /^[a-f0-9]{32}\.tmp$/.test(path.basename(file));
    const archived = options.retiredShadowDirs.has(file) || options.retiredShadowDirs.has(path.dirname(file));
    if (!uid && !ledger && !archived) return false;
    vanishedEntries++;
    if (vanished.length < 64)
      vanished.push({
        path: path.relative(root, file),
        kind: uid ? 'UID_RENAME_TEMP' : ledger ? 'EDITOR_OUTCOME_STAGE_TEMP' : 'ARCHIVED_STOPPED_SHADOW',
      });
    return true;
  }
  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (knownRemoval(dir, error)) return;
      throw error;
    }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Inventory refuses symlinks');
      // Count an observed regular entry even if a permitted transient disappears before lstat.
      if (entry.isFile() && ++files > options.maxFiles) throw new Error('Fixture file-count quota exhausted');
      let info;
      try {
        info = await inspect(file);
      } catch (error) {
        if (knownRemoval(file, error, entry.isFile())) continue;
        throw error;
      }
      if (info.isSymbolicLink()) throw new Error('Inventory refuses symlinks');
      if (file === path.join(root, '.harness', 'engine')) {
        if (!info.isDirectory()) throw new Error('Immutable engine slot changed type');
        continue;
      }
      if (info.isDirectory()) await walk(file);
      else if (info.isFile()) {
        if (!entry.isFile() && ++files > options.maxFiles) throw new Error('Fixture file-count quota exhausted');
        bytes += Number(info.size);
        if (bytes > options.maxBytes) throw new Error('Fixture data quota exhausted');
      } else throw new Error('Unsupported fixture entry');
    }
  }
  const info = await inspect(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe inventory root');
  await walk(root);
  return {
    bytes,
    files,
    vanishedEntries,
    vanished,
    atomicSnapshot: false,
    removedTransientBytes: 'UNKNOWN; not reported as zero-byte files',
  };
}

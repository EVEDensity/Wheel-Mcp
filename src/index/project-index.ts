import { createHash } from 'node:crypto';
import { createReadStream, watch, type FSWatcher } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { resolveProjectPath } from '../project/paths.js';
import { WheelError } from '../error-schema.js';
import type { TimeoutContext } from '../timeout.js';
import { indexFileMetadata, buildDependencyGraph, type FileMetadata, type DependencyGraph } from './file-metadata.js';

const EXCLUDED = new Set(['.git', '.godot', '.harness', 'node_modules', 'runs']);
const TEXT_EXTENSIONS = new Set([
  '.gd',
  '.tscn',
  '.tres',
  '.godot',
  '.cfg',
  '.txt',
  '.md',
  '.json',
  '.gdshader',
  '.uid',
]);
const MAX_FILES = 50000;
const MAX_BYTES = 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_CACHED_TEXT = 64 * 1024 * 1024;
const STAT_BATCH_SIZE = 32;
const check = (timeout?: TimeoutContext) => {
  timeout?.throwIfCancelled();
  timeout?.throwIfExpired();
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
type InventoryEntry = { path: string; fingerprint: string; bytes: number; modifiedAtMs: number };
export type IndexedFile = InventoryEntry & {
  sha256: string;
  updatedAt: string;
  text: string | null;
  textOmitted: string | null;
  metadata: FileMetadata;
};
export type IndexSnapshot = {
  schemaVersion: 1;
  projectId: string;
  sourceHash: string;
  updatedAt: string;
  stale: boolean;
  analysisLevel: 'metadata-index';
  safeRefactor: false;
  graph: DependencyGraph;
  watcher: 'active' | 'unavailable' | 'disabled';
  files: readonly IndexedFile[];
  excludedLinks: readonly string[];
  stats: { readFiles: number; reusedFiles: number; hashedBytes: number };
};

/** Read-only memory cache; lexical associations never authorize a refactor. Rescan is the correctness source. */
export class ProjectIndex {
  private snapshot?: IndexSnapshot;
  private queue: Promise<void> = Promise.resolve();
  private queued = 0;
  private watcher?: FSWatcher;
  private watcherStatus: IndexSnapshot['watcher'] = 'disabled';
  private generation = 0;
  constructor(
    readonly root: string,
    private readonly maxFiles = MAX_FILES,
  ) {
    if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > MAX_FILES)
      throw new WheelError('INVALID_ARGUMENT', 'Invalid index file budget');
  }
  readSnapshot(): IndexSnapshot | undefined {
    return this.snapshot
      ? { ...this.snapshot, watcher: this.watcherStatus, stats: { ...this.snapshot.stats } }
      : undefined;
  }
  invalidate(): void {
    this.generation++;
    if (this.snapshot) this.snapshot = { ...this.snapshot, stale: true };
  }
  startWatching(): void {
    if (this.watcher || this.watcherStatus === 'unavailable') return;
    try {
      this.watcher = watch(this.root, { recursive: true, persistent: false }, (_event, filename) => {
        const segments = filename?.toString().split(/[\\/]/);
        if (segments?.some((segment) => segment.startsWith('.') || EXCLUDED.has(segment))) return;
        this.invalidate();
      });
      this.watcherStatus = 'active';
      this.watcher.on('error', () => {
        this.stopWatching();
        this.watcherStatus = 'unavailable';
        this.invalidate();
      });
    } catch {
      this.watcherStatus = 'unavailable';
    }
  }
  stopWatching(): void {
    this.watcher?.close();
    this.watcher = undefined;
    this.watcherStatus = 'disabled';
  }
  private async inventory(timeout?: TimeoutContext) {
    const files: InventoryEntry[] = [],
      excludedLinks: string[] = [];
    let bytes = 0;
    let directories = 0;
    const walk = async (dir: string): Promise<void> => {
      check(timeout);
      if (++directories > MAX_FILES) throw new WheelError('UNSUPPORTED', 'Project index exceeds directory budget');
      if ((await lstat(dir)).isSymbolicLink()) throw new WheelError('CONFLICT', 'Index directory became a link');
      const entries = (await readdir(dir, { withFileTypes: true })).filter(
        (entry) => !entry.name.startsWith('.') && !EXCLUDED.has(entry.name),
      );
      for (let offset = 0; offset < entries.length; offset += STAT_BATCH_SIZE) {
        check(timeout);
        const batch = entries.slice(offset, offset + STAT_BATCH_SIZE);
        // Bound pending filesystem operations and drain the batch even on error/cancel.
        // Both inventory passes still inspect every file; this is not a stale cache shortcut.
        const stats = await Promise.allSettled(
          batch.map(async (entry) => {
            check(timeout);
            return entry.isFile() ? lstat(path.join(dir, entry.name)) : undefined;
          }),
        );
        check(timeout);
        for (const result of stats) if (result.status === 'rejected') throw result.reason;
        for (const [position, entry] of batch.entries()) {
          check(timeout);
          const absolute = path.join(dir, entry.name);
          const relative = path.relative(this.root, absolute).split(path.sep).join('/');
          if (entry.isSymbolicLink()) {
            excludedLinks.push(relative);
            continue;
          }
          if (entry.isDirectory()) {
            await walk(absolute);
            continue;
          }
          if (!entry.isFile()) continue;
          const result = stats[position];
          if (result.status !== 'fulfilled' || !result.value)
            throw new WheelError('CONFLICT', 'Index input metadata is unavailable');
          const stat = result.value;
          if (stat.isSymbolicLink() || !stat.isFile()) throw new WheelError('CONFLICT', 'Index input changed type');
          bytes += stat.size;
          if (files.length >= this.maxFiles || stat.size > MAX_FILE_BYTES || bytes > MAX_BYTES)
            throw new WheelError('UNSUPPORTED', 'Project index exceeds its file or byte budget');
          files.push({
            path: relative,
            bytes: stat.size,
            modifiedAtMs: stat.mtimeMs,
            fingerprint: `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`,
          });
        }
      }
    };
    await walk(this.root);
    files.sort((a, b) => a.path.localeCompare(b.path));
    excludedLinks.sort();
    return { files, excludedLinks };
  }
  async refresh(timeout?: TimeoutContext, forceHash = false): Promise<IndexSnapshot> {
    try {
      check(timeout);
    } catch (error) {
      if (this.snapshot) this.snapshot = { ...this.snapshot, stale: true };
      throw error;
    }
    if (this.queued >= 32) throw new WheelError('UNSUPPORTED', 'Project index refresh queue exceeds budget');
    const previous = this.queue;
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.queue = previous
      .then(() => turn)
      .then(() => {
        this.queued--;
      });
    this.queued++;
    let onAbort: (() => void) | undefined;
    let entered = false;
    try {
      if (timeout) {
        await Promise.race([
          previous,
          new Promise<never>((_resolve, reject) => {
            onAbort = () => {
              try {
                check(timeout);
              } catch (error) {
                reject(error);
              }
            };
            timeout.signal.addEventListener('abort', onAbort, { once: true });
            if (timeout.signal.aborted) onAbort();
          }),
        ]);
      } else await previous;
      check(timeout);
      entered = true;
      this.invalidate();
      const generation = this.generation;
      const inventory = await this.inventory(timeout);
      const old = new Map(this.snapshot?.files.map((file) => [file.path, file]));
      const files: IndexedFile[] = [];
      const stats = { readFiles: 0, reusedFiles: 0, hashedBytes: 0 };
      let textBytes = 0;
      let metadataItems = 0;
      for (const entry of inventory.files) {
        check(timeout);
        const previous = old.get(entry.path);
        if (!forceHash && previous?.fingerprint === entry.fingerprint) {
          files.push(previous);
          if (previous.text !== null) textBytes += previous.bytes;
          if (textBytes > MAX_CACHED_TEXT)
            throw new WheelError('UNSUPPORTED', 'Project index text cache exceeds budget');
          stats.reusedFiles++;
          const meta = previous.metadata;
          metadataItems +=
            meta.symbols.length +
            meta.nodes.length +
            meta.resources.length +
            meta.references.length +
            meta.declaredUids.length;
          if (metadataItems > 100000) throw new WheelError('UNSUPPORTED', 'Project metadata cache exceeds budget');
          continue;
        }
        const resolved = await resolveProjectPath(this.root, entry.path, { mode: 'read' });
        const digest = createHash('sha256');
        const textual = TEXT_EXTENSIONS.has(path.extname(entry.path).toLowerCase());
        const capture = textual && entry.bytes <= MAX_TEXT_BYTES;
        const chunks: Buffer[] = [];
        let readBytes = 0;
        for await (const raw of createReadStream(resolved.absolutePath, { signal: timeout?.signal })) {
          check(timeout);
          const chunk = raw as Buffer;
          readBytes += chunk.length;
          if (readBytes > entry.bytes) throw new WheelError('CONFLICT', 'Index input grew during read');
          digest.update(chunk);
          if (capture) chunks.push(chunk);
        }
        if (readBytes !== entry.bytes) throw new WheelError('CONFLICT', 'Index input changed during read');
        let text: string | null = null;
        let textOmitted: string | null = textual ? 'text-size-budget' : 'binary-or-unrecognized-format';
        if (capture) {
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
            if (text.includes('\0')) {
              text = null;
              textOmitted = 'binary-content';
            } else {
              textOmitted = null;
              textBytes += readBytes;
            }
          } catch {
            textOmitted = 'invalid-utf8';
          }
        }
        if (textBytes > MAX_CACHED_TEXT) throw new WheelError('UNSUPPORTED', 'Project index text cache exceeds budget');
        const metadata = indexFileMetadata(entry.path, text, timeout);
        metadataItems +=
          metadata.symbols.length +
          metadata.nodes.length +
          metadata.resources.length +
          metadata.references.length +
          metadata.declaredUids.length;
        if (metadataItems > 100000) throw new WheelError('UNSUPPORTED', 'Project metadata cache exceeds budget');
        files.push(
          Object.freeze({
            ...entry,
            sha256: digest.digest('hex'),
            updatedAt: new Date().toISOString(),
            text,
            textOmitted,
            metadata,
          }),
        );
        stats.readFiles++;
        stats.hashedBytes += readBytes;
      }
      check(timeout);
      if (JSON.stringify(await this.inventory(timeout)) !== JSON.stringify(inventory))
        throw new WheelError('CONFLICT', 'Project changed during index refresh');
      check(timeout);
      const graph = buildDependencyGraph(files, timeout);
      if (this.generation !== generation) throw new WheelError('CONFLICT', 'Project index invalidated during refresh');
      this.snapshot = {
        schemaVersion: 1,
        projectId: hash(process.platform === 'win32' ? this.root.toLowerCase() : this.root),
        sourceHash: hash(JSON.stringify(files.map((file) => [file.path, file.sha256, file.bytes]))),
        updatedAt: new Date().toISOString(),
        stale: false,
        analysisLevel: 'metadata-index',
        safeRefactor: false,
        graph,
        watcher: this.watcherStatus,
        files: Object.freeze(files),
        excludedLinks: Object.freeze(inventory.excludedLinks),
        stats,
      };
      return this.readSnapshot()!;
    } catch (error) {
      if (entered) this.invalidate();
      else if (this.snapshot) this.snapshot = { ...this.snapshot, stale: true };
      throw error;
    } finally {
      if (onAbort) timeout?.signal.removeEventListener('abort', onAbort);
      release();
    }
  }
}

const indexes = new Map<string, ProjectIndex>();
export async function getProjectIndex(projectPath: string): Promise<ProjectIndex> {
  const root = await realpath(projectPath);
  const key = process.platform === 'win32' ? root.toLowerCase() : root;
  let index = indexes.get(key);
  if (!index) index = new ProjectIndex(root);
  indexes.delete(key);
  indexes.set(key, index);
  while (indexes.size > 4) {
    const oldest = indexes.keys().next().value!;
    indexes.get(oldest)!.stopWatching();
    indexes.delete(oldest);
  }
  return index;
}

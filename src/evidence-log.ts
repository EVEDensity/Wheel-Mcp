import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { WheelError } from './error-schema.js';

type Kind = 'stdout' | 'stderr';

/** Bounded tails plus ordered, continuously persisted logs with input backpressure. */
export class EvidenceLog {
  private queue: Promise<void> = Promise.resolve();
  private failure: Error | null = null;
  private pendingBytes = 0;
  private readonly tails = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  private readonly sizes = { stdout: 0, stderr: 0 };
  private readonly indices = { stdout: 0, stderr: 0 };
  private readonly paused = new Set<Readable>();
  private constructor(
    readonly directory: string,
    private readonly segmentBytes: number,
    private readonly maxSegments: number,
    private readonly tailBytes: number,
  ) {}

  static async create(
    directory: string,
    options: { segmentBytes?: number; maxSegments?: number; tailBytes?: number } = {},
  ) {
    const value = new EvidenceLog(
      path.resolve(directory),
      options.segmentBytes ?? 4 * 1024 * 1024,
      options.maxSegments ?? 16,
      options.tailBytes ?? 64 * 1024,
    );
    if (![value.segmentBytes, value.maxSegments, value.tailBytes].every((n) => Number.isSafeInteger(n) && n > 0))
      throw new WheelError('INVALID_ARGUMENT', 'Log bounds must be positive integers');
    await mkdir(value.directory, { recursive: true });
    for (const kind of ['stdout', 'stderr'] as const) {
      const file = path.join(value.directory, `${kind}.log`);
      await appendFile(file, '', { mode: 0o600 });
      value.sizes[kind] = (await stat(file)).size;
    }
    return value;
  }

  attach(stream: Readable, kind: Kind, onFailure: (error: Error) => void): void {
    stream.on('data', (bytes: Buffer) => {
      this.append(kind, bytes);
      if (this.pendingBytes >= 256 * 1024) {
        stream.pause();
        this.paused.add(stream);
      }
      void this.queue.then(() => {
        if (this.failure) onFailure(this.failure);
      });
    });
  }

  append(kind: Kind, input: Buffer | string): void {
    if (this.failure) return;
    const bytes = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(input);
    const tail = Buffer.concat([this.tails[kind], bytes]);
    let start = Math.max(0, tail.length - this.tailBytes);
    // Keep the tail on a UTF-8 boundary rather than manufacturing replacement text.
    while (start < tail.length && (tail[start] & 0xc0) === 0x80) start++;
    this.tails[kind] = Buffer.from(tail.subarray(start));
    this.pendingBytes += bytes.length;
    this.queue = this.queue
      .then(async () => {
        if (this.failure) return;
        const file = path.join(this.directory, `${kind}.log`);
        for (let offset = 0; offset < bytes.length; ) {
          if (this.sizes[kind] >= this.segmentBytes) {
            if (this.indices[kind] >= this.maxSegments)
              throw new WheelError('ENGINE_UNAVAILABLE', `${kind} log quota exhausted`);
            await rename(
              file,
              path.join(this.directory, `${kind}.${Date.now()}-${String(this.indices[kind]++).padStart(4, '0')}.log`),
            );
            this.sizes[kind] = 0;
          }
          const end = Math.min(bytes.length, offset + this.segmentBytes - this.sizes[kind]);
          await appendFile(file, bytes.subarray(offset, end), { mode: 0o600 });
          this.sizes[kind] += end - offset;
          offset = end;
        }
      })
      .catch((error: unknown) => {
        this.failure ??= error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => {
        this.pendingBytes -= bytes.length;
        if (this.pendingBytes < 128 * 1024 || this.failure) {
          for (const stream of this.paused) stream.resume();
          this.paused.clear();
        }
      });
  }

  tail(kind: Kind): string {
    return this.tails[kind].toString('utf8');
  }
  async drain(): Promise<void> {
    await this.queue;
    if (this.failure) throw this.failure;
  }
}

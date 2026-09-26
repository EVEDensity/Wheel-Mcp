import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { WheelError } from './error-schema.js';

export const DEFAULT_RESPONSE_BYTES = 32 * 1024;
export const MAX_RESPONSE_BYTES = 128 * 1024;
export const RESPONSE_PAGE_BYTES = 8 * 1024;
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_STORED_BYTES = 32 * 1024 * 1024;
const SNAPSHOT_TTL_MS = 15 * 60 * 1000;

type Snapshot = { bytes: Buffer; expiresAt: number; owner: string };
const snapshots = new Map<string, Snapshot>();
let storedBytes = 0;
const ownerContext = new AsyncLocalStorage<string>();

export function runWithResponseOwner<T>(owner: string, operation: () => T): T {
  return ownerContext.run(owner, operation);
}

function currentOwner(): string {
  return ownerContext.getStore() ?? 'local';
}

function expireSnapshots(): void {
  for (const [ref, snapshot] of snapshots) {
    if (snapshot.expiresAt > Date.now()) continue;
    snapshots.delete(ref);
    storedBytes -= snapshot.bytes.length;
  }
}

function page(ref: string, snapshot: Snapshot, cursor: number): Record<string, unknown> {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor >= snapshot.bytes.length)
    throw new WheelError('INVALID_ARGUMENT', 'response cursor is outside the stored snapshot');
  let end = Math.min(cursor + RESPONSE_PAGE_BYTES, snapshot.bytes.length);
  while (end < snapshot.bytes.length && (snapshot.bytes[end] & 0xc0) === 0x80) end--;
  const truncated = end < snapshot.bytes.length;
  return {
    schema_version: '0.1',
    source: 'REAL',
    status: 'PARTIAL',
    truncated,
    encoding: 'json',
    chunk: snapshot.bytes.subarray(cursor, end).toString('utf8'),
    continuation: truncated ? { ref, cursor: end, totalBytes: snapshot.bytes.length } : null,
  };
}

/** Both stdio and HTTP invoke this before constructing MCP content. */
export function budgetResponse(
  body: Record<string, unknown>,
  maxBytes = DEFAULT_RESPONSE_BYTES,
): Record<string, unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_RESPONSE_BYTES)
    throw new WheelError('INVALID_ARGUMENT', `response budget must be 1024–${MAX_RESPONSE_BYTES} bytes`);
  const encoded = Buffer.from(JSON.stringify(body), 'utf8');
  if (encoded.length <= maxBytes) return body;
  if (encoded.length > MAX_SNAPSHOT_BYTES)
    throw new WheelError('UNSUPPORTED', 'response exceeds the absolute snapshot limit', {
      bytes: encoded.length,
      maxBytes: MAX_SNAPSHOT_BYTES,
    });
  expireSnapshots();
  if (storedBytes + encoded.length > MAX_STORED_BYTES)
    throw new WheelError('ENGINE_UNAVAILABLE', 'response snapshot quota is exhausted', {
      maxBytes: MAX_STORED_BYTES,
    });
  const ref = randomUUID();
  const snapshot = { bytes: encoded, expiresAt: Date.now() + SNAPSHOT_TTL_MS, owner: currentOwner() };
  snapshots.set(ref, snapshot);
  storedBytes += encoded.length;
  const result = page(ref, snapshot, 0);
  if (body.status === 'FAIL') {
    result.status = 'FAIL';
    result.code = body.code;
    const message = String(body.message ?? '');
    result.message = message.length > 512 ? `${message.slice(0, 512)}… (see continuation)` : message;
  }
  return result;
}

export function readResponsePage(ref: string, cursor: number): Record<string, unknown> {
  expireSnapshots();
  const snapshot = snapshots.get(ref);
  if (!snapshot) throw new WheelError('NOT_FOUND', 'response snapshot is unavailable or expired');
  if (snapshot.owner !== currentOwner())
    throw new WheelError('FORBIDDEN', 'response snapshot belongs to another client');
  return page(ref, snapshot, cursor);
}

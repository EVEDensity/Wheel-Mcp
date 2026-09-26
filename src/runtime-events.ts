import { mkdir, open, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface RuntimeEvent {
  schema_version: '0.1';
  source: 'REAL';
  run_id: string;
  sequence: number;
  timestamp: string;
  event: string;
  payload: Record<string, unknown>;
}

export interface RuntimeEventFilter {
  event?: string | string[];
  run_id?: string;
  payload?: Record<string, string | number | boolean | null>;
}

export interface EventCursor {
  run_id: string;
  sequence: number;
}

export interface EventReadResult {
  schema_version: '0.1';
  source: 'REAL';
  evidenceDir: string;
  run_id: string | null;
  max_sequence: number;
  events: RuntimeEvent[];
  invalid_lines: Array<{ line: number; reason: string }>;
  pending_partial: boolean;
  invalid_line_count?: number;
  events_truncated?: boolean;
}

export interface EventPage extends EventReadResult {
  cursor: number | EventCursor;
  next_cursor: number | EventCursor | null;
  cursor_ahead: boolean;
  cursor_expired?: boolean;
}

export interface EventSubscriptionOptions {
  cursor?: number | EventCursor;
  limit?: number;
  signal?: AbortSignal;
  filter?: RuntimeEventFilter | ((event: RuntimeEvent) => boolean);
  pollIntervalMs?: number;
  maxEvents?: number;
  ackTimeoutMs?: number;
}

export interface SubscriptionResult extends EventPage {
  cancelled?: boolean;
  timed_out?: boolean;
}

export type EventSubscriptionRecord = {
  subscription_id: string;
  evidence_dir: string;
  owner_client_id?: string;
  cursor: EventCursor | number;
  pending_cursor?: EventCursor | number;
  ack_deadline_at?: string;
  ack_timeout_ms: number;
  filter?: RuntimeEventFilter;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'CLOSED';
  created_at: string;
  updated_at: string;
};

type SubscriptionStore = Record<string, EventSubscriptionRecord>;
const subscriptionLocks = new Map<string, Promise<void>>();

export function parseRuntimeEvent(value: unknown): RuntimeEvent | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (
    item.schema_version !== '0.1' ||
    item.source !== 'REAL' ||
    typeof item.run_id !== 'string' ||
    item.run_id.length === 0 ||
    !Number.isInteger(item.sequence) ||
    Number(item.sequence) < 1 ||
    typeof item.timestamp !== 'string' ||
    Number.isNaN(Date.parse(item.timestamp)) ||
    typeof item.event !== 'string' ||
    item.event.length === 0 ||
    !item.payload ||
    typeof item.payload !== 'object' ||
    Array.isArray(item.payload)
  )
    return null;
  return {
    schema_version: '0.1',
    source: 'REAL',
    run_id: item.run_id,
    sequence: Number(item.sequence),
    timestamp: item.timestamp,
    event: item.event,
    payload: item.payload as Record<string, unknown>,
  };
}

/** Convert only gameplay notifications; ready/control messages never enter events.jsonl. */
export function normalizeBridgeRuntimeEvent(value: unknown, expectedRunId: string): RuntimeEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const notification = value as Record<string, unknown>;
  if (notification.jsonrpc !== '2.0' || notification.method !== 'runtime/event') return null;
  if (!notification.params || typeof notification.params !== 'object' || Array.isArray(notification.params))
    return null;
  const params = notification.params as Record<string, unknown>;
  if (params.run_id !== expectedRunId) return null;
  return parseRuntimeEvent({
    schema_version: '0.1',
    source: 'REAL',
    run_id: params.run_id,
    sequence: params.sequence,
    timestamp: params.timestamp,
    event: params.event,
    payload: params.payload,
  });
}

export function matchesRuntimeEvent(
  event: RuntimeEvent,
  filter?: RuntimeEventFilter | ((event: RuntimeEvent) => boolean),
): boolean {
  if (!filter) return true;
  if (typeof filter === 'function') return filter(event);
  if (filter.run_id !== undefined && event.run_id !== filter.run_id) return false;
  if (filter.event !== undefined) {
    const names = Array.isArray(filter.event) ? filter.event : [filter.event];
    if (!names.includes(event.event)) return false;
  }
  if (filter.payload) {
    for (const [key, expected] of Object.entries(filter.payload)) {
      if (event.payload[key] !== expected) return false;
    }
  }
  return true;
}

export function normalizeCursor(cursor: number | EventCursor | undefined, runId: string | null): EventCursor {
  if (typeof cursor === 'number') {
    if (!Number.isInteger(cursor) || cursor < 0) throw new Error('cursor must be a non-negative integer');
    return { run_id: runId ?? '', sequence: cursor };
  }
  if (
    !cursor ||
    typeof cursor.run_id !== 'string' ||
    !cursor.run_id ||
    !Number.isInteger(cursor.sequence) ||
    cursor.sequence < 0
  )
    throw new Error('cursor must contain run_id and non-negative sequence');
  if (runId && cursor.run_id !== runId)
    throw new Error(`cursor run_id ${cursor.run_id} does not match event run_id ${runId}`);
  return cursor;
}

const cursorLocks = new Map<string, Promise<void>>();

async function writeCursor(evidenceDir: string, cursor: EventCursor): Promise<void> {
  const root = path.resolve(evidenceDir);
  await mkdir(root, { recursive: true });
  const cursorPath = path.join(root, 'event-cursor.json');
  const previous = cursorLocks.get(cursorPath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  cursorLocks.set(cursorPath, queued);
  await previous;
  try {
    const temporary = `${cursorPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify(
        {
          schema_version: '0.1',
          run_id: cursor.run_id,
          sequence: cursor.sequence,
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );
    await rename(temporary, cursorPath);
  } finally {
    release();
    if (cursorLocks.get(cursorPath) === queued) cursorLocks.delete(cursorPath);
  }
}

async function readCursor(evidenceDir: string): Promise<EventCursor | null> {
  try {
    const value = JSON.parse(
      await readFile(path.join(path.resolve(evidenceDir), 'event-cursor.json'), 'utf8'),
    ) as Record<string, unknown>;
    if (
      typeof value.run_id !== 'string' ||
      !value.run_id ||
      !Number.isInteger(value.sequence) ||
      Number(value.sequence) < 0
    )
      return null;
    return { run_id: value.run_id, sequence: Number(value.sequence) };
  } catch {
    return null;
  }
}

function subscriptionPath(evidenceDir: string): string {
  return path.join(path.resolve(evidenceDir), 'subscriptions.json');
}

async function readSubscriptions(evidenceDir: string): Promise<SubscriptionStore> {
  try {
    const value = JSON.parse(await readFile(subscriptionPath(evidenceDir), 'utf8')) as unknown;
    return value && typeof value === 'object' ? (value as SubscriptionStore) : {};
  } catch {
    return {};
  }
}

async function writeSubscriptions(evidenceDir: string, store: SubscriptionStore): Promise<void> {
  const target = subscriptionPath(evidenceDir);
  await mkdir(path.dirname(target), { recursive: true });
  const previous = subscriptionLocks.get(target) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  subscriptionLocks.set(target, queued);
  await previous;
  try {
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(store, null, 2), 'utf8');
    await rename(temporary, target);
  } finally {
    release();
    if (subscriptionLocks.get(target) === queued) subscriptionLocks.delete(target);
  }
}

async function mutateSubscriptions<T>(
  evidenceDir: string,
  mutator: (store: SubscriptionStore) => T | Promise<T>,
): Promise<T> {
  const target = subscriptionPath(evidenceDir);
  const previous = subscriptionLocks.get(target) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  subscriptionLocks.set(target, queued);
  await previous;
  try {
    const store = await readSubscriptions(evidenceDir);
    const result = await mutator(store);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(store, null, 2), 'utf8');
    await rename(temporary, target);
    return result;
  } finally {
    release();
    if (subscriptionLocks.get(target) === queued) subscriptionLocks.delete(target);
  }
}

export async function createEventSubscription(
  evidenceDir: string,
  options: Pick<EventSubscriptionOptions, 'cursor' | 'filter' | 'ackTimeoutMs'> & { ownerClientId?: string } = {},
): Promise<EventSubscriptionRecord> {
  const root = path.resolve(evidenceDir);
  const events = await readRuntimeEvents(root);
  const record: EventSubscriptionRecord = {
    subscription_id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    evidence_dir: root,
    ...(options.ownerClientId ? { owner_client_id: options.ownerClientId } : {}),
    cursor: normalizeCursor(options.cursor ?? 0, events.run_id),
    ack_timeout_ms: Math.max(1, options.ackTimeoutMs ?? 30000),
    filter: typeof options.filter === 'function' ? undefined : options.filter,
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return mutateSubscriptions(root, (store) => {
    store[record.subscription_id] = record;
    return record;
  });
}

export async function getEventSubscriptionOwner(
  evidenceDir: string,
  subscriptionId: string,
): Promise<string | undefined> {
  const store = await readSubscriptions(path.resolve(evidenceDir));
  return store[subscriptionId]?.owner_client_id;
}

export async function pollEventSubscription(
  evidenceDir: string,
  subscriptionId: string,
  limit = 100,
): Promise<SubscriptionResult & { subscription_id: string; status: EventSubscriptionRecord['status'] }> {
  const root = path.resolve(evidenceDir);
  return mutateSubscriptions(root, async (store) => {
    const record = store[subscriptionId];
    if (!record) throw new Error(`subscription not found: ${subscriptionId}`);
    if (record.status === 'CANCELLED' || record.status === 'CLOSED') {
      const page = await readRuntimeEventsSince(root, record.cursor, limit);
      return { ...page, subscription_id: subscriptionId, status: record.status, events: [] };
    }
    if (record.ack_deadline_at && Date.parse(record.ack_deadline_at) <= Date.now()) {
      record.status = 'PAUSED';
      record.updated_at = new Date().toISOString();
      const page = await readRuntimeEventsSince(root, record.cursor, limit);
      return { ...page, subscription_id: subscriptionId, status: record.status, events: [], timed_out: true };
    }
    if (record.status === 'PAUSED') {
      const page = await readRuntimeEventsSince(root, record.cursor, limit);
      return { ...page, subscription_id: subscriptionId, status: record.status, events: [] };
    }
    const page = await readRuntimeEventsSince(root, record.cursor, limit);
    const events = page.events.filter((event) => matchesRuntimeEvent(event, record.filter));
    if (page.next_cursor !== null && events.length > 0) {
      record.pending_cursor = page.next_cursor;
      record.ack_deadline_at = new Date(Date.now() + record.ack_timeout_ms).toISOString();
    } else if (page.next_cursor !== null && page.events.length > 0) {
      // Filtered-out events have no delivery to ACK; advance past them.
      record.cursor = page.next_cursor;
    }
    record.updated_at = new Date().toISOString();
    return { ...page, events, subscription_id: subscriptionId, status: record.status };
  });
}

export async function acknowledgeEventSubscription(
  evidenceDir: string,
  subscriptionId: string,
  cursor: EventCursor | number,
): Promise<EventSubscriptionRecord> {
  const root = path.resolve(evidenceDir);
  return mutateSubscriptions(root, async (store) => {
    const record = store[subscriptionId];
    if (!record) throw new Error(`subscription not found: ${subscriptionId}`);
    const normalized = normalizeCursor(cursor, (await readRuntimeEvents(root)).run_id);
    const previous = normalizeCursor(record.cursor, (await readRuntimeEvents(root)).run_id);
    if (normalized.sequence < previous.sequence) throw new Error('ack cursor cannot move backwards');
    if (record.pending_cursor !== undefined) {
      const pending = normalizeCursor(record.pending_cursor, (await readRuntimeEvents(root)).run_id);
      if (normalized.sequence !== pending.sequence) throw new Error('ack must match the delivered page cursor');
    } else if (normalized.sequence !== previous.sequence) throw new Error('ack has no pending delivery');
    record.cursor = normalized;
    record.pending_cursor = undefined;
    record.ack_deadline_at = undefined;
    if (record.status === 'PAUSED') record.status = 'ACTIVE';
    record.updated_at = new Date().toISOString();
    return record;
  });
}

export async function cancelEventSubscription(
  evidenceDir: string,
  subscriptionId: string,
): Promise<EventSubscriptionRecord> {
  const root = path.resolve(evidenceDir);
  return mutateSubscriptions(root, (store) => {
    const record = store[subscriptionId];
    if (!record) throw new Error(`subscription not found: ${subscriptionId}`);
    record.status = 'CANCELLED';
    record.ack_deadline_at = undefined;
    record.updated_at = new Date().toISOString();
    return record;
  });
}

export async function pauseEventSubscription(
  evidenceDir: string,
  subscriptionId: string,
): Promise<EventSubscriptionRecord> {
  return mutateSubscriptions(evidenceDir, (store) => {
    const record = store[subscriptionId];
    if (!record) throw new Error(`subscription not found: ${subscriptionId}`);
    if (record.status === 'ACTIVE') record.status = 'PAUSED';
    record.updated_at = new Date().toISOString();
    return record;
  });
}

export async function closeEventSubscription(
  evidenceDir: string,
  subscriptionId: string,
): Promise<EventSubscriptionRecord> {
  return mutateSubscriptions(evidenceDir, (store) => {
    const record = store[subscriptionId];
    if (!record) throw new Error(`subscription not found: ${subscriptionId}`);
    record.status = 'CLOSED';
    record.ack_deadline_at = undefined;
    record.updated_at = new Date().toISOString();
    return record;
  });
}

export async function listEventSubscriptions(evidenceDir: string): Promise<EventSubscriptionRecord[]> {
  const store = await readSubscriptions(path.resolve(evidenceDir));
  return Object.values(store);
}

const MAX_CACHED_EVENTS = 2048;
const MAX_INVALID_LINES = 100;
const MAX_LINE_BYTES = 1024 * 1024;
type EventLogCache = {
  ino: number;
  offset: number;
  partial: Buffer;
  discarding: boolean;
  lineNumber: number;
  runId: string | null;
  maxSequence: number;
  events: RuntimeEvent[];
  invalidLines: Array<{ line: number; reason: string }>;
  invalidLineCount: number;
  eventsTruncated: boolean;
};
const eventLogCaches = new Map<string, EventLogCache>();
const eventLogLocks = new Map<string, Promise<EventReadResult>>();

function emptyEventLogCache(ino: number): EventLogCache {
  return {
    ino,
    offset: 0,
    partial: Buffer.alloc(0),
    discarding: false,
    lineNumber: 0,
    runId: null,
    maxSequence: 0,
    events: [],
    invalidLines: [],
    invalidLineCount: 0,
    eventsTruncated: false,
  };
}

function invalidLine(cache: EventLogCache, reason: string): void {
  cache.invalidLineCount++;
  if (cache.invalidLines.length < MAX_INVALID_LINES) cache.invalidLines.push({ line: cache.lineNumber, reason });
}

function parseCompleteLine(cache: EventLogCache, bytes: Buffer): void {
  cache.lineNumber++;
  if (bytes.length > MAX_LINE_BYTES) {
    invalidLine(cache, 'event line exceeds 1 MiB');
    return;
  }
  const line = bytes.toString('utf8').trim();
  if (!line) return;
  let event: RuntimeEvent | null;
  try {
    event = parseRuntimeEvent(JSON.parse(line));
  } catch (error) {
    invalidLine(cache, error instanceof Error ? error.message : String(error));
    return;
  }
  if (!event) {
    invalidLine(cache, 'schema validation failed');
    return;
  }
  if (cache.runId === null) cache.runId = event.run_id;
  if (event.run_id !== cache.runId) {
    invalidLine(cache, `run_id mismatch: expected ${cache.runId}`);
    return;
  }
  if (event.sequence <= cache.maxSequence) {
    invalidLine(cache, `sequence must be strictly increasing after ${cache.maxSequence}`);
    return;
  }
  cache.maxSequence = event.sequence;
  cache.events.push(event);
  if (cache.events.length > MAX_CACHED_EVENTS) {
    cache.events.shift();
    cache.eventsTruncated = true;
  }
}

async function refreshEventLog(evidenceDir: string): Promise<EventReadResult> {
  const root = path.resolve(evidenceDir);
  const file = path.join(root, 'events.jsonl');
  const info = await stat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  let cache = eventLogCaches.get(file);
  if (!info || !cache || cache.ino !== info.ino || info.size < cache.offset) {
    cache = emptyEventLogCache(info?.ino ?? 0);
    eventLogCaches.set(file, cache);
  }
  if (info && info.size > cache.offset) {
    const handle = await open(file, 'r');
    try {
      const chunk = Buffer.allocUnsafe(64 * 1024);
      while (cache.offset < info.size) {
        const { bytesRead } = await handle.read(
          chunk,
          0,
          Math.min(chunk.length, info.size - cache.offset),
          cache.offset,
        );
        if (!bytesRead) break;
        cache.offset += bytesRead;
        let data = Buffer.concat([cache.partial, chunk.subarray(0, bytesRead)]);
        cache.partial = Buffer.alloc(0);
        while (true) {
          const newline = data.indexOf(10);
          if (newline < 0) break;
          if (cache.discarding) {
            cache.discarding = false;
          } else parseCompleteLine(cache, data.subarray(0, newline));
          data = data.subarray(newline + 1);
        }
        if (data.length > MAX_LINE_BYTES) {
          cache.lineNumber++;
          invalidLine(cache, 'event line exceeds 1 MiB');
          cache.discarding = true;
        } else cache.partial = Buffer.from(data);
      }
    } finally {
      await handle.close();
    }
  }
  return {
    schema_version: '0.1',
    source: 'REAL',
    evidenceDir: root,
    run_id: cache.runId,
    max_sequence: cache.maxSequence,
    events: [...cache.events],
    invalid_lines: [...cache.invalidLines],
    invalid_line_count: cache.invalidLineCount,
    events_truncated: cache.eventsTruncated,
    pending_partial: cache.partial.length > 0 || cache.discarding,
  };
}

export async function readRuntimeEvents(evidenceDir: string): Promise<EventReadResult> {
  const key = path.join(path.resolve(evidenceDir), 'events.jsonl');
  const prior = eventLogLocks.get(key);
  if (prior) return prior;
  const current = refreshEventLog(evidenceDir);
  eventLogLocks.set(key, current);
  try {
    return await current;
  } finally {
    if (eventLogLocks.get(key) === current) eventLogLocks.delete(key);
  }
}

async function readArchivedPage(
  file: string,
  runId: string | null,
  after: number,
  limit: number,
): Promise<RuntimeEvent[]> {
  const output: RuntimeEvent[] = [];
  const handle = await open(file, 'r');
  try {
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    let partial = Buffer.alloc(0);
    while (output.length < limit) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      let data = Buffer.concat([partial, chunk.subarray(0, bytesRead)]);
      partial = Buffer.alloc(0);
      while (true) {
        const newline = data.indexOf(10);
        if (newline < 0) break;
        const line = data.subarray(0, newline);
        data = data.subarray(newline + 1);
        if (line.length > MAX_LINE_BYTES) continue;
        let event: RuntimeEvent | null;
        try {
          event = parseRuntimeEvent(JSON.parse(line.toString('utf8')));
        } catch {
          continue;
        }
        if (event && event.run_id === runId && event.sequence > after) output.push(event);
        if (output.length >= limit) break;
      }
      if (data.length > MAX_LINE_BYTES) throw new Error('archived event line exceeds 1 MiB');
      partial = Buffer.from(data);
    }
  } finally {
    await handle.close();
  }
  return output;
}

async function readSegmentedPage(
  evidenceDir: string,
  runId: string | null,
  after: number,
  limit: number,
): Promise<RuntimeEvent[]> {
  const root = path.resolve(evidenceDir);
  const names = await readdir(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const segments = names.filter((name) => /^events\.\d{13}-\d{4}\.jsonl$/.test(name)).sort();
  segments.push('events.jsonl');
  const output: RuntimeEvent[] = [];
  for (const name of segments) {
    const page = await readArchivedPage(path.join(root, name), runId, after, limit - output.length).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    );
    output.push(...page);
    if (output.length >= limit) break;
  }
  return output;
}

export async function readRuntimeEventsSince(
  evidenceDir: string,
  cursor: number | EventCursor = 0,
  limit = 100,
): Promise<EventPage> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('limit must be 1–500');
  const result = await readRuntimeEvents(evidenceDir);
  const normalized = normalizeCursor(cursor, result.run_id);
  const effectiveSequence = normalized.sequence;
  const earliestCached = result.events[0]?.sequence ?? result.max_sequence + 1;
  const fromDisk = effectiveSequence < earliestCached - 1;
  const events = fromDisk
    ? await readSegmentedPage(evidenceDir, result.run_id, effectiveSequence, limit)
    : result.events.filter((event) => event.sequence > effectiveSequence).slice(0, limit);
  const next_cursor = events.length
    ? typeof cursor === 'number'
      ? events[events.length - 1].sequence
      : { run_id: events[events.length - 1].run_id, sequence: events[events.length - 1].sequence }
    : normalized.run_id
      ? normalized
      : result.run_id
        ? { run_id: result.run_id, sequence: effectiveSequence }
        : null;
  return {
    ...result,
    cursor,
    next_cursor,
    cursor_ahead: effectiveSequence > result.max_sequence,
    cursor_expired: fromDisk && (events.length === 0 || events[0].sequence > effectiveSequence + 1),
    events,
  };
}

export async function* streamRuntimeEvents(
  evidenceDir: string,
  options: EventSubscriptionOptions = {},
): AsyncGenerator<RuntimeEvent, SubscriptionResult, void> {
  const initial = await readRuntimeEvents(evidenceDir);
  const persisted = await readCursor(evidenceDir);
  let cursor = normalizeCursor(options.cursor ?? persisted ?? 0, initial.run_id);
  const collected: RuntimeEvent[] = [];
  const pollInterval = Math.max(10, options.pollIntervalMs ?? 100);
  while (!options.signal?.aborted && (options.maxEvents === undefined || collected.length < options.maxEvents)) {
    const page = await readRuntimeEventsSince(evidenceDir, cursor, options.limit ?? 100);
    for (const event of page.events) {
      cursor = { run_id: event.run_id, sequence: event.sequence };
      await writeCursor(evidenceDir, cursor);
      if (matchesRuntimeEvent(event, options.filter)) {
        collected.push(event);
        yield event;
        if (options.maxEvents !== undefined && collected.length >= options.maxEvents) break;
      }
    }
    if (options.maxEvents !== undefined && collected.length >= options.maxEvents) break;
    await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
  }
  const page = await readRuntimeEventsSince(evidenceDir, cursor, options.limit ?? 100);
  return { ...page, cursor, events: collected, cancelled: options.signal?.aborted === true };
}

/** Continuous delivery backed by the persistent subscription registry. */
export async function* streamEventSubscription(
  evidenceDir: string,
  subscriptionId: string,
  options: Pick<EventSubscriptionOptions, 'signal' | 'pollIntervalMs' | 'limit' | 'maxEvents'> = {},
): AsyncGenerator<
  RuntimeEvent & { subscription_id: string; cursor: EventCursor | number },
  SubscriptionResult & { subscription_id: string },
  void
> {
  const collected: RuntimeEvent[] = [];
  const pollInterval = Math.max(10, options.pollIntervalMs ?? 100);
  while (!options.signal?.aborted && (options.maxEvents === undefined || collected.length < options.maxEvents)) {
    const page = await pollEventSubscription(evidenceDir, subscriptionId, options.limit ?? 100);
    for (const event of page.events) {
      collected.push(event);
      yield { ...event, subscription_id: subscriptionId, cursor: page.next_cursor ?? page.cursor };
      if (options.maxEvents !== undefined && collected.length >= options.maxEvents) break;
    }
    if (options.maxEvents !== undefined && collected.length >= options.maxEvents) break;
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
  const page = await pollEventSubscription(evidenceDir, subscriptionId, options.limit ?? 100);
  return { ...page, events: collected, subscription_id: subscriptionId, cancelled: options.signal?.aborted === true };
}

export async function subscribeRuntimeEvents(
  evidenceDir: string,
  options: EventSubscriptionOptions = {},
): Promise<SubscriptionResult> {
  const iterator = streamRuntimeEvents(evidenceDir, { ...options, maxEvents: options.maxEvents ?? 1 });
  const events: RuntimeEvent[] = [];
  while (true) {
    const next = await iterator.next();
    if (next.done) return { ...next.value, events };
    events.push(next.value);
    if (!options.maxEvents || events.length >= options.maxEvents) {
      const page = await readRuntimeEventsSince(
        evidenceDir,
        { run_id: next.value.run_id, sequence: next.value.sequence },
        options.limit ?? 100,
      );
      return { ...page, cursor: { run_id: next.value.run_id, sequence: next.value.sequence }, events };
    }
  }
}

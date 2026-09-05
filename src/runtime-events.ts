import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
}

export interface EventPage extends EventReadResult {
  cursor: number | EventCursor;
  next_cursor: number | EventCursor | null;
  cursor_ahead: boolean;
}

export interface EventSubscriptionOptions {
  cursor?: number | EventCursor;
  limit?: number;
  signal?: AbortSignal;
  filter?: RuntimeEventFilter | ((event: RuntimeEvent) => boolean);
  pollIntervalMs?: number;
  maxEvents?: number;
}

export interface SubscriptionResult extends EventPage {
  cancelled?: boolean;
  timed_out?: boolean;
}

export type EventSubscriptionRecord = {
  subscription_id: string;
  evidence_dir: string;
  cursor: EventCursor | number;
  filter?: RuntimeEventFilter;
  status: 'ACTIVE' | 'CANCELLED';
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

export async function createEventSubscription(
  evidenceDir: string,
  options: Pick<EventSubscriptionOptions, 'cursor' | 'filter'> = {},
): Promise<EventSubscriptionRecord> {
  const root = path.resolve(evidenceDir);
  const events = await readRuntimeEvents(root);
  const record: EventSubscriptionRecord = {
    subscription_id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    evidence_dir: root,
    cursor: normalizeCursor(options.cursor ?? 0, events.run_id),
    filter: typeof options.filter === 'function' ? undefined : options.filter,
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const store = await readSubscriptions(root);
  store[record.subscription_id] = record;
  await writeSubscriptions(root, store);
  return record;
}

export async function pollEventSubscription(
  evidenceDir: string,
  subscriptionId: string,
  limit = 100,
): Promise<SubscriptionResult & { subscription_id: string; status: EventSubscriptionRecord['status'] }> {
  const root = path.resolve(evidenceDir);
  const store = await readSubscriptions(root);
  const record = store[subscriptionId];
  if (!record) throw new Error(`subscription not found: ${subscriptionId}`);
  if (record.status === 'CANCELLED') {
    const page = await readRuntimeEventsSince(root, record.cursor, limit);
    return { ...page, subscription_id: subscriptionId, status: record.status, events: [] };
  }
  const page = await readRuntimeEventsSince(root, record.cursor, limit);
  const events = page.events.filter((event) => matchesRuntimeEvent(event, record.filter));
  if (page.next_cursor !== null) record.cursor = page.next_cursor;
  record.updated_at = new Date().toISOString();
  await writeSubscriptions(root, store);
  return { ...page, events, subscription_id: subscriptionId, status: record.status };
}

export async function cancelEventSubscription(
  evidenceDir: string,
  subscriptionId: string,
): Promise<EventSubscriptionRecord> {
  const root = path.resolve(evidenceDir);
  const store = await readSubscriptions(root);
  const record = store[subscriptionId];
  if (!record) throw new Error(`subscription not found: ${subscriptionId}`);
  record.status = 'CANCELLED';
  record.updated_at = new Date().toISOString();
  await writeSubscriptions(root, store);
  return record;
}

export async function readRuntimeEvents(evidenceDir: string): Promise<EventReadResult> {
  const root = path.resolve(evidenceDir);
  const text = await readFile(path.join(root, 'events.jsonl'), 'utf8').catch(() => '');
  const lines = text.split(/\r?\n/);
  const pending_partial = text.length > 0 && !text.endsWith('\n');
  const completeLines = pending_partial ? lines.slice(0, -1) : lines;
  const events: RuntimeEvent[] = [];
  const invalid_lines: Array<{ line: number; reason: string }> = [];
  let run_id: string | null = null;
  let previousSequence = 0;
  for (let index = 0; index < completeLines.length; index += 1) {
    const line = completeLines[index];
    if (!line.trim()) continue;
    let event: RuntimeEvent | null = null;
    try {
      event = parseRuntimeEvent(JSON.parse(line));
    } catch (error: unknown) {
      invalid_lines.push({ line: index + 1, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (!event) {
      invalid_lines.push({ line: index + 1, reason: 'schema validation failed' });
      continue;
    }
    if (run_id === null) run_id = event.run_id;
    if (event.run_id !== run_id) {
      invalid_lines.push({ line: index + 1, reason: `run_id mismatch: expected ${run_id}` });
      continue;
    }
    if (event.sequence <= previousSequence) {
      invalid_lines.push({ line: index + 1, reason: `sequence must be strictly increasing after ${previousSequence}` });
      continue;
    }
    previousSequence = event.sequence;
    events.push(event);
  }
  return {
    schema_version: '0.1',
    source: 'REAL',
    evidenceDir: root,
    run_id,
    max_sequence: previousSequence,
    events,
    invalid_lines,
    pending_partial,
  };
}

export async function readRuntimeEventsSince(
  evidenceDir: string,
  cursor: number | EventCursor = 0,
  limit = 100,
): Promise<EventPage> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
  const result = await readRuntimeEvents(evidenceDir);
  const normalized = normalizeCursor(cursor, result.run_id);
  const effectiveSequence = normalized.sequence;
  const events = result.events.filter((event) => event.sequence > effectiveSequence).slice(0, limit);
  const next_cursor = events.length
    ? typeof cursor === 'number'
      ? events[events.length - 1].sequence
      : { run_id: events[events.length - 1].run_id, sequence: events[events.length - 1].sequence }
    : normalized.run_id
      ? normalized
      : result.run_id
        ? { run_id: result.run_id, sequence: effectiveSequence }
        : null;
  return { ...result, cursor, next_cursor, cursor_ahead: effectiveSequence > result.max_sequence, events };
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

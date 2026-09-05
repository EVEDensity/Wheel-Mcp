import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readRuntimeEvents, readRuntimeEventsSince, streamRuntimeEvents, subscribeRuntimeEvents } from '../src/runtime-events.js';

const makeEvent = (run_id: string, sequence: number, event: string, payload: Record<string, unknown> = {}) =>
  JSON.stringify({ schema_version: '0.1', source: 'REAL', run_id, sequence, timestamp: new Date().toISOString(), event, payload });

test('rejects mixed run ids and non-increasing sequences without reordering', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'event-protocol-'));
  await writeFile(path.join(root, 'events.jsonl'), [makeEvent('a', 2, 'two'), makeEvent('a', 1, 'one'), makeEvent('b', 3, 'other')].join('\n') + '\n');
  const result = await readRuntimeEvents(root);
  assert.deepEqual(result.events.map((item) => item.sequence), [2]);
  assert.equal(result.invalid_lines.length, 2);
  assert.equal(result.run_id, 'a');
});

test('supports declarative filters and persists a run-bound cursor', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'event-protocol-'));
  await writeFile(path.join(root, 'events.jsonl'), [makeEvent('a', 1, 'skip', { kind: 'x' }), makeEvent('a', 2, 'target', { kind: 'y' }), makeEvent('a', 3, 'target', { kind: 'z' })].join('\n') + '\n');
  const result = await subscribeRuntimeEvents(root, { filter: { event: 'target', payload: { kind: 'y' } } });
  assert.deepEqual(result.events.map((item) => item.sequence), [2]);
  const cursor = JSON.parse(await readFile(path.join(root, 'event-cursor.json'), 'utf8')) as { run_id: string; sequence: number };
  assert.deepEqual(cursor.run_id, 'a');
  assert.equal(cursor.sequence, 2);
  const resumed = await readRuntimeEventsSince(root, cursor);
  assert.deepEqual(resumed.events.map((item) => item.sequence), [3]);
});

test('continuous stream yields multiple events and resumes after abort', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'event-protocol-'));
  await writeFile(path.join(root, 'events.jsonl'), [makeEvent('a', 1, 'one'), makeEvent('a', 2, 'two')].join('\n') + '\n');
  const controller = new AbortController();
  const stream = streamRuntimeEvents(root, { maxEvents: 2, signal: controller.signal, pollIntervalMs: 10 });
  const first = await stream.next();
  const second = await stream.next();
  assert.equal((first.value as { sequence: number }).sequence, 1);
  assert.equal((second.value as { sequence: number }).sequence, 2);
  controller.abort();
  const done = await stream.next();
  assert.equal(done.done, true);
});

test('cursor ahead and corrupt cursor are reported safely', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'event-protocol-'));
  await writeFile(path.join(root, 'events.jsonl'), makeEvent('a', 1, 'one') + '\n');
  const ahead = await readRuntimeEventsSince(root, { run_id: 'a', sequence: 9 });
  assert.equal(ahead.cursor_ahead, true);
  await writeFile(path.join(root, 'event-cursor.json'), '{broken');
  const recovered = await subscribeRuntimeEvents(root, { filter: { event: 'one' } });
  assert.deepEqual(recovered.events.map((item) => item.sequence), [1]);
});




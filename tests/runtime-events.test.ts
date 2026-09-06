import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  cancelEventSubscription,
  acknowledgeEventSubscription,
  closeEventSubscription,
  listEventSubscriptions,
  pauseEventSubscription,
  createEventSubscription,
  pollEventSubscription,
  readRuntimeEvents,
  readRuntimeEventsSince,
  subscribeRuntimeEvents,
} from '../src/godot-runtime.js';

const event = (sequence: number, name: string) =>
  JSON.stringify({
    schema_version: '0.1',
    source: 'REAL',
    run_id: 'run-1',
    sequence,
    timestamp: new Date().toISOString(),
    event: name,
    payload: { sequence },
  });

test('runtime event reader validates schema and ignores partial concurrent tail', async () => {
  const root = await fsEvidence();
  await writeFile(
    path.join(root, 'events.jsonl'),
    `${event(1, 'started')}\nnot-json\n${event(2, 'finished')}\n{"partial":`,
  );
  const result = await readRuntimeEvents(root);
  assert.deepEqual(
    result.events.map((item) => item.sequence),
    [1, 2],
  );
  assert.equal(result.invalid_lines.length, 1);
  assert.equal(result.pending_partial, true);
});

test('runtime event cursor is sequence based and subscription resumes after persisted cursor', async () => {
  const root = await fsEvidence();
  await writeFile(
    path.join(root, 'events.jsonl'),
    `${event(1, 'started')}\n${event(2, 'target')}\n${event(3, 'finished')}\n`,
  );
  const page = await readRuntimeEventsSince(root, 1, 1);
  assert.deepEqual(
    page.events.map((item) => item.sequence),
    [2],
  );
  assert.equal(page.next_cursor, 2);
  const controller = new AbortController();
  const received = await subscribeRuntimeEvents(root, {
    cursor: 2,
    signal: controller.signal,
    filter: (item) => (item as { event: string }).event === 'finished',
  });
  assert.deepEqual(
    (received.events as Array<{ sequence: number }>).map((item) => item.sequence),
    [3],
  );
  controller.abort();
});

test('persistent subscriptions support reconnect and cancellation', async () => {
  const root = await fsEvidence();
  await writeFile(path.join(root, 'events.jsonl'), `${event(1, 'started')}\n`);
  const created = await createEventSubscription(root);
  assert.equal(created.status, 'ACTIVE');
  const first = await pollEventSubscription(root, created.subscription_id);
  assert.deepEqual(
    first.events.map((item) => item.sequence),
    [1],
  );
  await acknowledgeEventSubscription(root, created.subscription_id, first.next_cursor ?? 1);
  await writeFile(path.join(root, 'events.jsonl'), `${event(1, 'started')}\n${event(2, 'finished')}\n`);
  const resumed = await pollEventSubscription(root, created.subscription_id);
  assert.deepEqual(
    resumed.events.map((item) => item.sequence),
    [2],
  );
  const cancelled = await cancelEventSubscription(root, created.subscription_id);
  assert.equal(cancelled.status, 'CANCELLED');
  const afterCancel = await pollEventSubscription(root, created.subscription_id);
  assert.deepEqual(afterCancel.events, []);
});

test('subscription state machine supports pause, resume, close, and ack timeout', async () => {
  const root = await fsEvidence();
  await writeFile(path.join(root, 'events.jsonl'), `${event(1, 'started')}\n`);
  const created = await createEventSubscription(root, { ackTimeoutMs: 1 });
  await pauseEventSubscription(root, created.subscription_id);
  assert.equal((await listEventSubscriptions(root))[0].status, 'PAUSED');
  await acknowledgeEventSubscription(root, created.subscription_id, 0);
  assert.equal((await listEventSubscriptions(root))[0].status, 'ACTIVE');
  const page = await pollEventSubscription(root, created.subscription_id);
  assert.equal(page.events.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const timedOut = await pollEventSubscription(root, created.subscription_id);
  assert.equal(timedOut.status, 'PAUSED');
  await closeEventSubscription(root, created.subscription_id);
  assert.equal((await listEventSubscriptions(root))[0].status, 'CLOSED');
});

test('concurrent subscription writes preserve all records and corrupt files recover empty', async () => {
  const root = await fsEvidence();
  await Promise.all(Array.from({ length: 8 }, () => createEventSubscription(root)));
  assert.equal((await listEventSubscriptions(root)).length, 8);
  await writeFile(path.join(root, 'subscriptions.json'), '{broken');
  assert.deepEqual(await listEventSubscriptions(root), []);
});

test('multiple long-lived subscriptions remain isolated under concurrent polling', async () => {
  const root = await fsEvidence();
  await writeFile(
    path.join(root, 'events.jsonl'),
    `${event(1, 'started')}\n${event(2, 'target')}\n${event(3, 'finished')}\n`,
  );
  const subscriptions = await Promise.all(
    Array.from({ length: 16 }, (_, index) =>
      createEventSubscription(root, { filter: { event: index % 2 ? 'target' : ['started', 'finished'] } }),
    ),
  );
  const pages = await Promise.all(subscriptions.map((item) => pollEventSubscription(root, item.subscription_id, 10)));
  assert.equal(pages.filter((page) => page.events.length === 2).length, 8);
  assert.equal(pages.filter((page) => page.events.length === 1).length, 8);
  await Promise.all(subscriptions.map((item) => acknowledgeEventSubscription(root, item.subscription_id, 3)));
  const replay = await Promise.all(subscriptions.map((item) => pollEventSubscription(root, item.subscription_id, 10)));
  assert.equal(
    replay.every((page) => page.events.length === 0),
    true,
  );
});

async function fsEvidence(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'godot-events-'));
  await mkdir(root, { recursive: true });
  return root;
}

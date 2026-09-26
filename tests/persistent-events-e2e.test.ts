import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { appendFile, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  acknowledgeEventSubscription,
  createEventSubscription,
  pollEventSubscription,
  readRuntimeEvents,
  readRuntimeEventsSince,
} from '../src/runtime-events.js';

const godotPath = process.env.GODOT_PATH ?? '';
const event = (run_id: string, sequence: number) =>
  JSON.stringify({
    schema_version: '0.1',
    source: 'REAL',
    run_id,
    sequence,
    timestamp: '2026-09-25T00:00:00Z',
    event: 'tick',
    payload: { sequence },
  }) + '\n';

function body(result: unknown): Record<string, any> {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  return JSON.parse(content?.find((item) => item.type === 'text')?.text ?? '{}') as Record<string, any>;
}

test(
  'real bridge notifications become ordered durable events, with ACK replay and reconnect',
  { skip: !existsSync(godotPath), timeout: 45000 },
  async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), 'wheel-event-e2e-'));
    await writeFile(path.join(projectPath, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
    await writeFile(path.join(projectPath, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('build/src/mcp-server-sdk.js')],
      stderr: 'pipe',
    });
    const client = new Client({ name: 'persistent-events', version: '1.0.0' });
    let sessionId = '';
    let evidenceDir: string;
    const call = (name: string, args: Record<string, unknown>) =>
      client.callTool({ name, arguments: args }, undefined, { timeout: 15000 });
    try {
      await client.connect(transport);
      const opened = await call('open_runtime_bridge', {
        godotPath,
        projectPath,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        headless: true,
        timeoutMs: 15000,
      });
      assert.equal(opened.isError, undefined, JSON.stringify(opened));
      sessionId = body(opened).session_id;
      evidenceDir = body(opened).evidenceDir;
      const created = await call('create_runtime_node', {
        sessionId,
        parentPath: '.',
        type: 'Node2D',
        name: 'EventChild',
      });
      assert.equal(created.isError, undefined, JSON.stringify(created));
      const treePage = await call('call_runtime_bridge', {
        sessionId,
        method: 'get_scene_tree',
        params: { limit: 1, fields: ['name', 'path'] },
      });
      assert.equal(treePage.isError, undefined, JSON.stringify(treePage));
      assert.equal(body(treePage).response.nodes.length, 1);
      assert.equal(body(treePage).response.truncated, true);
      assert.equal(body(treePage).response.next_cursor, 1);
      const nextTreePage = await call('call_runtime_bridge', {
        sessionId,
        method: 'get_scene_tree',
        params: { limit: 1, cursor: 1, subtree: '.', depth: 1 },
      });
      assert.equal(nextTreePage.isError, undefined, JSON.stringify(nextTreePage));
      assert.equal(body(nextTreePage).response.nodes[0].name, 'EventChild');
      const invalidTree = await call('call_runtime_bridge', {
        sessionId,
        method: 'get_scene_tree',
        params: { fields: 'name' },
      });
      assert.equal(invalidTree.isError, true);
      const oneShotTree = await call('get_runtime_scene_tree', {
        godotPath,
        projectPath,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        subtree: '.',
        depth: 0,
        fields: ['name'],
        limit: 1,
      });
      assert.equal(oneShotTree.isError, undefined, JSON.stringify(oneShotTree));
      assert.deepEqual(body(oneShotTree).response.nodes, [{ name: 'Main' }]);
      const stateModes = await Promise.all(
        (['normal', 'compact', 'verbose'] as const).map((responseMode) =>
          call('get_game_state', { sessionId, nodePath: '.', properties: ['position'], responseMode }),
        ),
      );
      for (const result of stateModes) assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.deepEqual(body(stateModes[1]).response.properties, body(stateModes[0]).response.properties);
      assert.deepEqual(body(stateModes[2]).response.properties, body(stateModes[0]).response.properties);
      const first = await readRuntimeEvents(evidenceDir);
      assert.equal(first.run_id, sessionId);
      assert.deepEqual(
        first.events.map((item) => item.event),
        ['level_started', 'node_created'],
      );
      assert.deepEqual(
        first.events.map((item) => item.sequence),
        [1, 2],
      );
      assert.equal(first.invalid_line_count, 0);
      assert.ok(first.events.every((item) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(item.timestamp)));
      const lines = (await readFile(path.join(evidenceDir, 'events.jsonl'), 'utf8')).trim().split('\n');
      assert.ok(lines.every((line) => JSON.parse(line).schema_version === '0.1'));
      assert.ok(lines.every((line) => JSON.parse(line).method === undefined));
      const subscription = await createEventSubscription(evidenceDir, {
        cursor: { run_id: sessionId, sequence: 1 },
      });
      const delivered = await pollEventSubscription(evidenceDir, subscription.subscription_id);
      assert.deepEqual(
        delivered.events.map((item) => item.sequence),
        [2],
      );
      const replay = await pollEventSubscription(evidenceDir, subscription.subscription_id);
      assert.deepEqual(
        replay.events.map((item) => item.sequence),
        [2],
      );
      await assert.rejects(
        acknowledgeEventSubscription(evidenceDir, subscription.subscription_id, { run_id: sessionId, sequence: 999 }),
        /match the delivered page cursor/,
      );
      await acknowledgeEventSubscription(evidenceDir, subscription.subscription_id, delivered.next_cursor!);
      const past = await call('wait_for_event', { sessionId, event: 'node_created', timeoutMs: 100 });
      assert.equal(past.isError, true);
      assert.equal(body(past).code, 'TIMEOUT');
      const history = await call('wait_for_event', {
        sessionId,
        event: 'node_created',
        includeHistory: true,
        timeoutMs: 1000,
      });
      assert.equal(history.isError, undefined, JSON.stringify(history));
      assert.equal(body(history).params.sequence, 2);
      const waiting = call('wait_for_event', { sessionId, event: 'node_created', timeoutMs: 2000 });
      await new Promise((resolve) => setTimeout(resolve, 30));
      const next = await call('create_runtime_node', {
        sessionId,
        parentPath: '.',
        type: 'Node2D',
        name: 'SecondChild',
      });
      assert.equal(next.isError, undefined, JSON.stringify(next));
      const observed = await waiting;
      assert.equal(observed.isError, undefined, JSON.stringify(observed));
      assert.equal(body(observed).params.sequence, 3);
      const resumed = await pollEventSubscription(evidenceDir, subscription.subscription_id);
      assert.deepEqual(
        resumed.events.map((item) => item.sequence),
        [3],
      );
      const stopped = await call('stop_runtime_bridge', { sessionId });
      assert.equal(stopped.isError, undefined, JSON.stringify(stopped));
      assert.equal(body(stopped).forced, false, JSON.stringify(stopped));
      sessionId = '';
      const durable = await readRuntimeEvents(evidenceDir);
      assert.ok(durable.events.some((item) => item.event === 'runtime_stopping'));
    } finally {
      if (sessionId) await call('stop_runtime_bridge', { sessionId }).catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  },
);

test('10,000 events are paged from disk with bounded cache, partial-line recovery and run rotation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-event-scale-'));
  const file = path.join(root, 'events.jsonl');
  await writeFile(file, Array.from({ length: 10000 }, (_, index) => event('run-1', index + 1)).join(''));
  const snapshot = await readRuntimeEvents(root);
  assert.equal(snapshot.max_sequence, 10000);
  assert.equal(snapshot.events.length, 2048);
  assert.equal(snapshot.events_truncated, true);
  const first = await readRuntimeEventsSince(root, { run_id: 'run-1', sequence: 0 }, 100);
  assert.deepEqual([first.events[0].sequence, first.events.at(-1)?.sequence], [1, 100]);
  const tail = await readRuntimeEventsSince(root, { run_id: 'run-1', sequence: 9900 }, 100);
  assert.deepEqual([tail.events[0].sequence, tail.events.at(-1)?.sequence], [9901, 10000]);
  await appendFile(file, event('run-1', 10001) + '{"partial":');
  const appended = await readRuntimeEvents(root);
  assert.equal(appended.max_sequence, 10001);
  assert.equal(appended.pending_partial, true);
  await appendFile(file, 'true}\n' + event('run-1', 10002));
  const recovered = await readRuntimeEventsSince(root, { run_id: 'run-1', sequence: 10000 });
  assert.deepEqual(
    recovered.events.map((item) => item.sequence),
    [10001, 10002],
  );
  assert.equal(recovered.invalid_line_count, 1);
  await rename(file, path.join(root, 'events.1790000000000-0001.jsonl'));
  await writeFile(file, event('run-1', 10003));
  const acrossSegments = await readRuntimeEventsSince(root, { run_id: 'run-1', sequence: 9999 }, 4);
  assert.deepEqual(
    acrossSegments.events.map((item) => item.sequence),
    [10000, 10001, 10002, 10003],
  );
  await rename(file, path.join(root, 'events.previous.jsonl'));
  await writeFile(file, event('run-2', 1));
  const rotated = await readRuntimeEvents(root);
  assert.equal(rotated.run_id, 'run-2');
  assert.deepEqual(
    rotated.events.map((item) => item.sequence),
    [1],
  );
  await assert.rejects(readRuntimeEventsSince(root, { run_id: 'run-1', sequence: 10002 }), /does not match/);
});

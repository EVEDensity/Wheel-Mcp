import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ClientRepairCoordinator, beginClientRepairSchema, submitRepairCandidateSchema } from '../src/client-repair.js';
import { runClientRepair } from '../src/clients/repair-workflow.js';
import { authorizeToolCall, createClientPolicy } from '../src/mcp/access-policy.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'client-repair-'));
  await writeFile(
    path.join(root, 'project.godot'),
    '[application]\nconfig/name="Client repair"\nrun/main_scene="res://main.tscn"\n',
  );
  await writeFile(
    path.join(root, 'main.tscn'),
    '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n',
  );
  await writeFile(
    path.join(root, 'main.gd'),
    'extends Node\nvar health = 0\nvar limit = preload("res://config.gd").LIMIT\n',
  );
  await writeFile(path.join(root, 'config.gd'), 'extends RefCounted\nconst LIMIT = 0\n');
  return {
    projectPath: root,
    godotPath: process.env.GODOT_PATH,
    bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
    evidenceDir: path.join(root, 'evidence'),
    allowedRepairFiles: ['main.gd', 'config.gd'],
    timeoutMs: 15000,
    checks: ['health', 'limit'].map((property) => ({
      id: property,
      method: 'get_property' as const,
      params: { nodePath: '.', property },
      path: 'value',
      op: 'equals' as const,
      expected: 100,
    })),
  };
}

test('candidate contract forbids missing approval, oracle changes and unconstrained edits; HTTP requires run plus write', () => {
  assert.equal(submitRepairCandidateSchema.safeParse({ repairId: 'id', approved: false }).success, false);
  assert.equal(beginClientRepairSchema.safeParse({ diagnosticsScope: 'runtime' }).success, false);
  const policy = createClientPolicy({
    clientId: 'limited',
    scopes: ['write'],
    projectRoots: [process.cwd()],
    evidenceRoots: [process.cwd()],
  });
  for (const name of ['begin_client_repair', 'submit_repair_candidate'])
    assert.throws(() => authorizeToolCall(policy, name, {}), /run/);
});

test(
  'official stdio client: model adapter sees failures, explicit approval, wrong patch rollback, two-file fix and reverify',
  { skip: !process.env.GODOT_PATH, timeout: 60000 },
  async () => {
    const input = await fixture();
    const client = new Client({ name: 'client-generated-repair-e2e', version: '1' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('build/src/mcp-server-sdk.js')],
      stderr: 'pipe',
    });
    let proposals = 0,
      approvals = 0;
    try {
      await client.connect(transport);
      const result = await runClientRepair(client, input, {
        propose: async (packet) => {
          // Deterministic model-adapter test double; NOT a live provider benchmark.
          proposals++;
          assert.equal(packet.status, 'NEEDS_REPAIR');
          assert.ok(packet.failure);
          const files = packet.files as Array<{ path: string; sha256: string; content: string }>;
          if (proposals === 2) {
            assert.match(await readFile(path.join(input.projectPath, 'main.gd'), 'utf8'), /health = 0/);
            assert.match(await readFile(path.join(input.projectPath, 'config.gd'), 'utf8'), /LIMIT = 0/);
            assert.equal((packet.previousVerification as { status: string }).status, 'FAIL');
          }
          return {
            source: 'deterministic-test-model-adapter',
            rationale: 'Restore the two asserted values',
            edits: files.map((f) => ({
              path: f.path,
              find: f.content,
              replace: f.content.replace('= 0', proposals === 1 ? '= 1' : '= 100'),
              expectedSha256: f.sha256,
            })),
          };
        },
        approve: async () => {
          approvals++;
          return true;
        },
      });
      assert.equal(proposals, 2);
      assert.equal(approvals, 2);
      assert.equal(result.status, 'PASS');
      assert.equal(result.requestClosed, true);
      assert.deepEqual((result.changedFiles as string[]).sort(), ['config.gd', 'main.gd']);
      const reused = await client.callTool({
        name: 'submit_repair_candidate',
        arguments: {
          repairId: result.repairId,
          approved: true,
          proposal: {
            source: 'test',
            rationale: 'replay',
            edits: [{ path: 'main.gd', find: 'x', replace: 'y', expectedSha256: '0'.repeat(64) }],
          },
        },
      });
      assert.equal(reused.isError, true);
      const declinedInput = await fixture();
      const declined = await runClientRepair(client, declinedInput, {
        propose: async () => ({ source: 'test', rationale: 'not approved', edits: [] }),
        approve: async () => false,
      });
      assert.equal(declined.status, 'DECLINED');
      assert.match(await readFile(path.join(declinedInput.projectPath, 'main.gd'), 'utf8'), /health = 0/);
    } finally {
      await client.close();
    }
  },
);

test(
  'repair tickets reject cross-session use, stale files, expiry and weakening the verification plan',
  { skip: !process.env.GODOT_PATH, timeout: 30000 },
  async () => {
    let clock = Date.now();
    const owner = new ClientRepairCoordinator(() => clock);
    const other = new ClientRepairCoordinator();
    const input = await fixture();
    const packet = await owner.begin(input);
    assert.ok('repairId' in packet);
    if (!('repairId' in packet)) return;
    const file = packet.files[0];
    const candidate = {
      repairId: packet.repairId,
      approved: true as const,
      proposal: {
        source: 'test',
        rationale: 'restore health',
        edits: [{ path: file.path, find: 'health = 0', replace: 'health = 100', expectedSha256: file.sha256 }],
      },
    };
    await assert.rejects(other.submit(candidate), /session/);
    await assert.rejects(owner.submit({ ...candidate, checks: [] } as typeof candidate), /unrecognized_keys/);
    await writeFile(path.join(input.projectPath, 'config.gd'), 'external edit');
    await assert.rejects(owner.submit(candidate), /stale/);
    clock += 16 * 60 * 1000;
    await assert.rejects(owner.submit(candidate), /expired/);
  },
);

test('repair context rejects traversal, internal paths, duplicates and pre-cancellation before launching Godot', async () => {
  const input = await fixture();
  const coordinator = new ClientRepairCoordinator();
  for (const file of ['../main.gd', '.git/config', 'main.gd:stream', 'folder\\main.gd']) {
    await assert.rejects(coordinator.begin({ ...input, allowedRepairFiles: [file] }), /unsafe/);
  }
  await assert.rejects(coordinator.begin({ ...input, allowedRepairFiles: ['main.gd', 'main.gd'] }), /duplicate/);
  const { createTimeoutContext } = await import('../src/timeout.js');
  const abort = new AbortController();
  abort.abort();
  const context = createTimeoutContext(1000, abort.signal);
  try {
    await assert.rejects(coordinator.begin(input, context), /cancel/i);
  } finally {
    context.dispose();
  }
  assert.match(await readFile(path.join(input.projectPath, 'main.gd'), 'utf8'), /health = 0/);
});

test(
  'one-candidate budget closes after a failed approved patch and restores both files',
  { skip: !process.env.GODOT_PATH, timeout: 30000 },
  async () => {
    const input = await fixture();
    const coordinator = new ClientRepairCoordinator();
    const packet = await coordinator.begin({ ...input, maxCandidates: 1 });
    assert.ok('repairId' in packet);
    if (!('repairId' in packet)) return;
    const f = packet.files[0];
    const candidate = {
      repairId: packet.repairId,
      approved: true as const,
      proposal: {
        source: 'ineffective-test-control',
        rationale: 'Keep failing values',
        edits: [{ path: f.path, find: f.content, replace: f.content + '\n', expectedSha256: f.sha256 }],
      },
    };
    const result = await coordinator.submit(candidate);
    assert.equal(result.status, 'FAIL');
    assert.equal(result.requestClosed, true);
    assert.equal(result.remainingCandidates, 0);
    for (const original of packet.files)
      assert.equal(await readFile(path.join(input.projectPath, original.path), 'utf8'), original.content);
    await assert.rejects(coordinator.submit(candidate), /unknown or expired/);
  },
);

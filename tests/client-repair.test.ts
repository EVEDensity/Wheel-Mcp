import test from 'node:test';
import { fixtureStdioEnv } from './helpers/stdio-fixture.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ClientRepairCoordinator, beginClientRepairSchema, submitRepairCandidateSchema } from '../src/client-repair.js';
import { runClientRepair } from '../src/clients/repair-workflow.js';
import { authorizeToolCall, createClientPolicy } from '../src/mcp/access-policy.js';
import { fixtureApproval, enableFixtureApproval } from './helpers/project-approval.js';
import { randomUUID } from 'node:crypto';
import { createTimeoutContext } from '../src/timeout.js';
import { WheelError } from '../src/error-schema.js';

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

test('candidate contract forbids missing approval, oracle changes and unconstrained edits; HTTP requires run plus write', async () => {
  assert.equal(submitRepairCandidateSchema.safeParse({ repairId: 'id', approved: false }).success, false);
  assert.equal(beginClientRepairSchema.safeParse({ diagnosticsScope: 'runtime' }).success, false);
  const policy = createClientPolicy({
    clientId: 'limited',
    scopes: ['write'],
    projectRoots: [process.cwd()],
    evidenceRoots: [process.cwd()],
  });
  for (const name of ['begin_client_repair', 'submit_repair_candidate'])
    await assert.rejects(authorizeToolCall(policy, name, {}), /run/);
});

test(
  'official stdio client: model adapter sees failures, explicit approval, wrong patch rollback, two-file fix and reverify',
  { skip: !process.env.GODOT_PATH, timeout: 60000 },
  async () => {
    const input = await fixture();
    const client = new Client(
      { name: 'client-generated-repair-e2e', version: '1' },
      { capabilities: { elicitation: { form: {} } } },
    );
    enableFixtureApproval(client);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('build/src/mcp-server-sdk.js')],
      stderr: 'pipe',
      env: fixtureStdioEnv(),
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
      assert.equal(result.status, 'PASS', JSON.stringify(result));
      assert.equal(result.requestClosed, true);
      assert.deepEqual((result.changedFiles as string[]).sort(), ['config.gd', 'main.gd']);
      const status = await client.callTool({
        name: 'get_client_repair_status',
        arguments: { repairId: result.repairId, candidateId: result.candidateId },
      });
      assert.notEqual(status.isError, true);
      const observed = status.structuredContent as {
        state: string;
        candidates: Array<{ state: string; persisted: boolean }>;
      };
      assert.equal(observed.state, 'CLOSED');
      assert.equal(observed.candidates[0].state, 'PASS');
      assert.equal(observed.candidates[0].persisted, true);
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
    assert.throws(() => other.status(packet.repairId), /session/);
    assert.equal(owner.status(packet.repairId).state, 'NEEDS_REPAIR');
    await assert.rejects(owner.submit({ ...candidate, checks: [] } as typeof candidate), /unrecognized_keys/);
    await writeFile(path.join(input.projectPath, 'config.gd'), 'external edit');
    await assert.rejects(owner.submit(candidate), /stale/);
    clock += 16 * 60 * 1000;
    await assert.rejects(owner.submit(candidate), /expired/);
  },
);

test('MOCK lost submit response never retries a patch or requests a second proposal', async () => {
  const calls: string[] = [];
  const repairId = randomUUID();
  let proposals = 0;
  const client = {
    callTool: async (request: { name: string }) => {
      calls.push(request.name);
      if (request.name === 'begin_client_repair')
        return {
          content: [],
          structuredContent: { status: 'NEEDS_REPAIR', repairId },
        };
      throw new Error('MOCK transport lost response after submit');
    },
  } as unknown as Client;
  const input = await fixture();
  await assert.rejects(
    runClientRepair(client, input, {
      propose: async () => {
        proposals++;
        return {
          source: 'MOCK',
          rationale: 'MOCK',
          edits: [{ path: 'main.gd', find: '0', replace: '100', expectedSha256: '0'.repeat(64) }],
        };
      },
      approve: async () => true,
    }),
    (error: unknown) => {
      const observed = error as { code: string; repairId: string; candidateId: string; retryable: boolean };
      assert.equal(observed.code, 'UNKNOWN');
      assert.equal(observed.repairId, repairId);
      assert.match(observed.candidateId, /^[a-f0-9-]{36}$/);
      assert.equal(observed.retryable, false);
      return true;
    },
  );
  assert.equal(proposals, 1);
  assert.deepEqual(calls, ['begin_client_repair', 'submit_repair_candidate']);
});

test(
  'real repair ticket with MOCK approval barrier: cancellation, status and duplicate ID fail closed before writes',
  { skip: !process.env.GODOT_PATH, timeout: 60000 },
  async () => {
    const input = await fixture();
    let markReview!: () => void;
    const review = new Promise<void>((resolve) => {
      markReview = resolve;
    });
    const coordinator = new ClientRepairCoordinator(Date.now, async (plan, signal) => {
      markReview();
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        else signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return fixtureApproval(plan, signal);
    });
    const packet = await coordinator.begin(input);
    assert.ok('repairId' in packet);
    if (!('repairId' in packet)) return;
    const candidateId = randomUUID();
    const candidate = {
      repairId: packet.repairId,
      candidateId,
      approved: true as const,
      proposal: {
        source: 'fixed candidate',
        rationale: 'correct both values',
        edits: packet.files.map((file) => ({
          path: file.path,
          find: file.content,
          replace: file.content.replace('= 0', '= 100'),
          expectedSha256: file.sha256,
        })),
      },
    };
    const context = createTimeoutContext(15000);
    try {
      const pending = coordinator.submit(candidate, context);
      await review;
      const running = coordinator.status(packet.repairId, candidateId);
      assert.equal(running.state, 'RUNNING');
      assert.equal(running.candidates[0].persisted, null);
      running.candidates[0].state = 'PASS';
      assert.equal(coordinator.status(packet.repairId, candidateId).candidates[0].state, 'RUNNING');
      await assert.rejects(coordinator.submit(candidate), /already submitted/);
      context.cancel();
      const result = await pending;
      assert.equal(result.status, 'FAIL');
      assert.equal(result.code, 'CANCELLED');
      assert.equal(result.persisted, false);
      assert.equal(coordinator.status(packet.repairId, candidateId).state, 'CLOSED');
      assert.equal(coordinator.status(packet.repairId, candidateId).candidates[0].state, 'CANCELLED');
      for (const file of packet.files)
        assert.equal(await readFile(path.join(input.projectPath, file.path), 'utf8'), file.content);
      await assert.rejects(coordinator.submit(candidate), /already submitted/);
    } finally {
      context.cancel();
      context.dispose();
    }
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
  'real Godot fixed scene/resource candidates retain frozen checks, reject a wrong patch, restore then commit correct files',
  { skip: !process.env.GODOT_PATH, timeout: 90000 },
  async () => {
    const input = await fixture();
    await writeFile(path.join(input.projectPath, 'stats.gd'), 'extends Resource\n@export var health = 0\n');
    await writeFile(path.join(input.projectPath, 'marker.gd'), 'extends Node\n@export var limit = 0\n');
    await writeFile(
      path.join(input.projectPath, 'stats.tres'),
      '[gd_resource type="Resource" load_steps=2 format=3]\n[ext_resource type="Script" path="res://stats.gd" id="1"]\n[resource]\nscript = ExtResource("1")\nhealth = 0\n',
    );
    await writeFile(
      path.join(input.projectPath, 'main.gd'),
      'extends Node\nvar health = preload("res://stats.tres").health\n@onready var limit = $Marker.limit\n',
    );
    await writeFile(
      path.join(input.projectPath, 'main.tscn'),
      '[gd_scene load_steps=3 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[ext_resource type="Script" path="res://marker.gd" id="2"]\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n[node name="Marker" type="Node" parent="."]\nscript = ExtResource("2")\nlimit = 0\n',
    );
    const coordinator = new ClientRepairCoordinator(Date.now, fixtureApproval);
    const packet = await coordinator.begin({ ...input, allowedRepairFiles: ['stats.tres', 'main.tscn'] });
    assert.ok('repairId' in packet);
    if (!('repairId' in packet)) return;
    const originals = structuredClone(packet.files);
    packet.validation[0].expected = 1;
    packet.files[0].sha256 = '0'.repeat(64);
    const proposal = (value: number) => ({
      source: 'fixed native fixture',
      rationale: 'bounded scene/resource exact edits',
      edits: originals.map((file) => ({
        path: file.path,
        find: file.content,
        replace: file.content.replace('= 0', `= ${value}`),
        expectedSha256: file.sha256,
      })),
    });
    const wrongId = randomUUID();
    const wrong = await coordinator.submit({
      repairId: packet.repairId,
      candidateId: wrongId,
      approved: true,
      proposal: proposal(1),
    });
    assert.equal(wrong.status, 'FAIL');
    assert.equal(wrong.persisted, false);
    for (const file of originals)
      assert.equal(await readFile(path.join(input.projectPath, file.path), 'utf8'), file.content);
    assert.equal(coordinator.status(packet.repairId, wrongId).candidates[0].state, 'FAIL');
    for (const candidateId of [undefined, randomUUID()]) {
      await assert.rejects(
        coordinator.submit({
          repairId: packet.repairId,
          candidateId,
          approved: true,
          proposal: {
            ...proposal(1),
            source: 'renamed source',
            rationale: 'new explanation, identical edits',
            edits: proposal(1).edits.reverse(),
          },
        }),
        (error: unknown) => error instanceof WheelError && error.code === 'CONFLICT',
      );
      assert.equal(coordinator.status(packet.repairId).remainingCandidates, 1);
      for (const file of originals)
        assert.equal(await readFile(path.join(input.projectPath, file.path), 'utf8'), file.content);
    }
    const correct = await coordinator.submit({
      repairId: packet.repairId,
      candidateId: randomUUID(),
      approved: true,
      proposal: proposal(100),
    });
    assert.equal(correct.status, 'PASS', JSON.stringify(correct));
    assert.deepEqual(correct.changedFiles.sort(), ['main.tscn', 'stats.tres']);
    assert.equal(correct.validationPlanHash, packet.validationPlanHash);
    for (const file of originals)
      assert.equal(
        await readFile(path.join(input.projectPath, file.path), 'utf8'),
        file.content.replace('= 0', '= 100'),
      );
  },
);

test(
  'real committed candidate with injected evidence-delivery failure is queryable and must not be replayed',
  { skip: !process.env.GODOT_PATH, timeout: 60000 },
  async () => {
    const input = await fixture();
    let packetDir = '';
    let clock = Date.now();
    const coordinator = new ClientRepairCoordinator(
      () => clock,
      async (plan) => {
        // Explicit filesystem fault: a directory blocks only final delivery, not the transaction or engine.
        await mkdir(path.join(packetDir, 'candidate-1', 'verification.json'));
        return fixtureApproval(plan);
      },
    );
    const packet = await coordinator.begin(input);
    assert.ok('repairId' in packet);
    if (!('repairId' in packet)) return;
    packetDir = packet.evidenceDir;
    const candidate = {
      repairId: packet.repairId,
      candidateId: randomUUID(),
      approved: true as const,
      proposal: {
        source: 'fixed native fixture',
        rationale: 'correct both values',
        edits: packet.files.map((file) => ({
          path: file.path,
          find: file.content,
          replace: file.content.replace('= 0', '= 100'),
          expectedSha256: file.sha256,
        })),
      },
    };
    await assert.rejects(coordinator.submit(candidate));
    const observed = coordinator.status(packet.repairId, candidate.candidateId);
    assert.equal(observed.state, 'CLOSED');
    assert.equal(observed.candidates[0].state, 'PASS');
    assert.equal(observed.candidates[0].persisted, true);
    assert.equal(observed.candidates[0].deliveryFailed, true);
    assert.ok(observed.candidates[0].transactions?.every((record) => record.state === 'COMMITTED'));
    for (const file of packet.files)
      assert.equal(
        await readFile(path.join(input.projectPath, file.path), 'utf8'),
        file.content.replace('= 0', '= 100'),
      );
    await assert.rejects(coordinator.submit(candidate), /already submitted/);
    clock += 16 * 60 * 1000;
    assert.throws(() => coordinator.status(packet.repairId), /expired/);
  },
);

test(
  'one-candidate budget closes after a failed approved patch and restores both files',
  { skip: !process.env.GODOT_PATH, timeout: 30000 },
  async () => {
    const input = await fixture();
    const coordinator = new ClientRepairCoordinator(Date.now, fixtureApproval);
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

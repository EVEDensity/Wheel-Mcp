import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  callRuntimeBridge,
  getRuntimeBridge,
  openRuntimeBridge,
  stopRuntimeBridge,
} from '../src/persistent-runtime-bridge.js';
import { createTimeoutContext } from '../src/timeout.js';
import { authorizeToolCall, createClientPolicy } from '../src/mcp/access-policy.js';
import { launchProject, getProcessStatus } from '../src/godot-runtime.js';
import { runRegistry } from '../src/run-registry.js';

const godotPath = process.env.GODOT_PATH ?? '';

test(
  'duplicate session ID cannot replace a live Godot bridge, including during concurrent open',
  { skip: !existsSync(godotPath), timeout: 60000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-session-identity-'));
    await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
    await writeFile(path.join(root, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n');
    const sessionId = `same-session-id-${process.pid}-${Date.now()}`;
    const options = {
      godotPath,
      projectPath: root,
      bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
      evidenceDir: path.join(root, '.harness', 'bridge'),
      runId: sessionId,
      headless: true,
    };
    const opening = openRuntimeBridge(options);
    await assert.rejects(() => openRuntimeBridge(options), /session already exists/);
    const first = await opening;
    try {
      const registered = runRegistry.get(sessionId);
      assert.equal(registered?.kind, 'bridge');
      assert.equal(registered?.pid, first.pid);
      assert.ok(registered?.processIdentity);
      await assert.rejects(() => openRuntimeBridge(options), /session already exists/);
      const tree = await callRuntimeBridge(sessionId, 'get_scene_tree');
      assert.equal((tree.response as Record<string, unknown>).capability, 'RUNTIME_SCENE_TREE');
      assert.equal(first.session_id, sessionId);
    } finally {
      const stopped = await stopRuntimeBridge(sessionId);
      assert.equal(stopped.stopped, true);
      assert.equal(runRegistry.get(sessionId)?.state, 'STOPPED');
      const secondStop = await stopRuntimeBridge(sessionId);
      assert.equal(secondStop.stopped, true);
    }
  },
);

test('a never-created bridge ID is not reported as successfully stopped', async () => {
  await assert.rejects(() => stopRuntimeBridge('never-created-session'), /session not found/);
});

test(
  'a globally reserved session ID cannot overwrite its previous process record',
  { skip: !existsSync(godotPath), timeout: 20000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-duplicate-registry-'));
    await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
    await writeFile(path.join(root, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n');
    const sessionId = `globally-reserved-${process.pid}-${Date.now()}`;
    runRegistry.register({ kind: 'bridge', runId: sessionId, pid: process.pid, projectPath: root, evidenceDir: root });
    try {
      await assert.rejects(
        () =>
          openRuntimeBridge({
            godotPath,
            projectPath: root,
            bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
            evidenceDir: path.join(root, 'attempt'),
            runId: sessionId,
            headless: true,
          }),
        /run already exists/,
      );
      assert.equal(runRegistry.get(sessionId)?.pid, process.pid);
      assert.equal(runRegistry.get(sessionId)?.state, 'RUNNING');
    } finally {
      runRegistry.markTerminal(sessionId, 'STOPPED');
    }
  },
);

test('operation status lookup respects the owning client session', async () => {
  const policy = createClientPolicy({
    clientId: 'owner',
    scopes: ['read', 'run'],
    projectRoots: [],
    evidenceRoots: [],
  });
  policy.ownedBridgeSessions.add('owned');
  await assert.doesNotReject(
    authorizeToolCall(policy, 'get_runtime_operation_status', { sessionId: 'owned', operationId: 'op' }),
  );
  await assert.rejects(
    authorizeToolCall(policy, 'get_runtime_operation_status', { sessionId: 'foreign', operationId: 'op' }),
    /does not own bridge session/,
  );
});

test(
  'a launched Godot run records OS identity and stops through the verified run ID',
  { skip: !existsSync(godotPath) || process.platform !== 'win32', timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-verified-run-'));
    await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
    await writeFile(path.join(root, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n');
    const launched = await launchProject({
      projectPath: root,
      godotPath,
      evidenceDir: path.join(root, '.harness', 'run'),
      headless: true,
    });
    assert.ok(launched.metadata.pid);
    try {
      assert.ok(launched.metadata.run_id);
      assert.ok(launched.metadata.process_identity);
      assert.equal(
        runRegistry.get(launched.metadata.run_id)?.processIdentity?.startToken,
        launched.metadata.process_identity.startToken,
      );
      const stopped = await runRegistry.stop(launched.metadata.run_id, 10000);
      assert.equal(stopped.state, 'STOPPED');
      assert.equal(getProcessStatus(launched.metadata.pid).running, false);
      assert.equal((await runRegistry.stop(launched.metadata.run_id)).state, 'STOPPED');
    } finally {
      if (getProcessStatus(launched.metadata.pid).running) launched.child.kill();
      await launched.close;
    }
  },
);

test(
  'cancelled write stays UNKNOWN until a late Godot result resolves; replaying its operation ID does not write twice',
  { skip: !existsSync(godotPath), timeout: 60000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-operation-status-'));
    await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
    await writeFile(
      path.join(root, 'main.tscn'),
      '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://state.gd" id="1"]\n[node name="Main" type="Node2D"]\nscript = ExtResource("1")\n',
    );
    await writeFile(
      path.join(root, 'state.gd'),
      'extends Node2D\nvar count = 0\nfunc slow_increment():\n\tOS.delay_msec(250)\n\tcount += 1\n\treturn count\n',
    );
    const opened = await openRuntimeBridge({
      projectPath: root,
      godotPath,
      bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
      evidenceDir: path.join(root, '.harness', 'operation'),
      headless: true,
    });
    const bridge = getRuntimeBridge(opened.session_id);
    const params = { nodePath: '.', method: 'slow_increment', args: [] };
    const context = createTimeoutContext(5000);
    try {
      const pending = bridge.request('call_method', params, context, 'increment-once');
      let sent = false;
      for (let index = 0; index < 300; index++) {
        const requests = await readFile(path.join(opened.evidenceDir, 'requests.jsonl'), 'utf8').catch(() => '');
        if (requests.includes('slow_increment')) {
          sent = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      assert.equal(sent, true);
      context.cancel();
      await assert.rejects(pending, (error: { code?: string; details?: { operationId?: string } }) => {
        assert.equal(error.code, 'UNKNOWN');
        assert.equal(error.details?.operationId, 'increment-once');
        return true;
      });
      assert.equal(bridge.getOperationStatus('increment-once').status, 'UNKNOWN');
      let status = bridge.getOperationStatus('increment-once');
      for (let index = 0; index < 100 && status.status !== 'COMPLETED'; index++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        status = bridge.getOperationStatus('increment-once');
      }
      assert.equal(status.status, 'COMPLETED', JSON.stringify(status));
      assert.equal((status.result as Record<string, unknown>).value, 1);
      await bridge.flushLogs();
      const responses = await readFile(path.join(opened.evidenceDir, 'responses.jsonl'), 'utf8');
      assert.match(responses, /"operation_id":"increment-once","late":true/);
      const replay = await bridge.request('call_method', params, undefined, 'increment-once');
      assert.equal((replay as Record<string, unknown>).value, 1);
      const count = await bridge.request('get_property', { nodePath: '.', property: 'count' });
      assert.equal((count as Record<string, unknown>).value, 1);
      await assert.rejects(
        () => bridge.request('call_method', { ...params, nodePath: 'Missing' }, undefined, 'increment-once'),
        /different request content/,
      );
    } finally {
      context.dispose();
      await stopRuntimeBridge(opened.session_id);
    }
  },
);

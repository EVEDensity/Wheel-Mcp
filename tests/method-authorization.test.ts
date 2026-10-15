import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import {
  authorizeToolCall,
  createClientPolicy,
  recordToolOwnership,
  type McpPermission,
} from '../src/mcp/access-policy.js';
import { createStdioPolicy } from '../src/mcp/stdio-policy.js';

function policy(scopes: McpPermission[]) {
  const value = createClientPolicy({
    clientId: scopes.join('-') || 'none',
    scopes,
    projectRoots: [],
    evidenceRoots: [process.cwd()],
  });
  value.ownedBridgeSessions.add('owned-session');
  return value;
}

test('read-only and run-only roles cannot mutate or call arbitrary Godot methods', async () => {
  const read = policy(['read']);
  const run = policy(['read', 'run']);
  const write = policy(['read', 'write']);
  const full = policy(['read', 'run', 'write']);
  const bridge = (method: string) => ({ sessionId: 'owned-session', method, params: {} });

  await assert.doesNotReject(authorizeToolCall(read, 'call_runtime_bridge', bridge('get_property')));
  await assert.rejects(authorizeToolCall(read, 'call_runtime_bridge', bridge('set_property')), /run permission/);
  await assert.rejects(authorizeToolCall(read, 'call_runtime_bridge', bridge('call_method')), /run permission/);
  await assert.rejects(authorizeToolCall(run, 'call_runtime_bridge', bridge('call_method')), /write permission/);
  await assert.rejects(
    authorizeToolCall(run, 'call_runtime_bridge', bridge('wait_physics_frames')),
    /write permission/,
  );
  await assert.rejects(authorizeToolCall(write, 'call_runtime_bridge', bridge('set_property')), /run permission/);
  await assert.doesNotReject(authorizeToolCall(full, 'call_runtime_bridge', bridge('set_property')));
  await assert.rejects(
    () => authorizeToolCall(write, 'call_runtime_method', { sessionId: 'owned-session' }),
    /run permission/,
  );
  await assert.rejects(authorizeToolCall(read, 'open_runtime_bridge', {}), /run permission/);
  await assert.rejects(authorizeToolCall(run, 'write_project_file', {}), /write permission/);
});

test('unclassified tools and bridge methods fail closed even for admin', async () => {
  const admin = policy(['admin']);
  await assert.rejects(authorizeToolCall(admin, 'new_unreviewed_tool', {}), /no explicit permission classification/);
  await assert.rejects(
    () => authorizeToolCall(admin, 'call_runtime_bridge', { sessionId: 'owned-session', method: 'do_anything' }),
    /no explicit permission classification/,
  );
});

test('PID-only ownership results are not process-generation grants', async () => {
  const client = policy(['read', 'run']);
  recordToolOwnership(client, 'launch_project', { content: [{ text: JSON.stringify({ pid: 1234 }) }] });
  client.ownedPids.add(1234); // Explicit stale legacy state, without a run binding.
  for (const name of ['get_process_status', 'stop_project', 'cancel_project'])
    await assert.rejects(authorizeToolCall(client, name, { pid: 1234 }), /does not own process/);
});

test("two clients cannot name each other's run, bridge session or subscription", async () => {
  const alice = policy(['read', 'run', 'write']);
  const bob = policy(['read', 'run', 'write']);
  const evidenceDir = path.join(process.cwd(), 'runs', 'alice');
  const response = (value: Record<string, unknown>, isError = false) => ({
    content: [{ text: JSON.stringify(value) }],
    isError,
  });
  recordToolOwnership(alice, 'launch_project', response({ pid: 2345, run_id: 'run-alice' }));
  recordToolOwnership(alice, 'open_runtime_bridge', response({ session_id: 'bridge-alice' }));
  recordToolOwnership(
    alice,
    'create_event_subscription',
    response({ evidence_dir: evidenceDir, subscription_id: 'sub-alice' }),
  );
  await assert.doesNotReject(authorizeToolCall(alice, 'stop_run', { runId: 'run-alice' }));
  await assert.doesNotReject(authorizeToolCall(alice, 'get_game_state', { sessionId: 'bridge-alice' }));
  await assert.doesNotReject(
    authorizeToolCall(alice, 'poll_event_subscription', {
      evidenceDir,
      subscriptionId: 'sub-alice',
    }),
  );
  await assert.rejects(authorizeToolCall(bob, 'cancel_run', { runId: 'run-alice' }), /does not own run/);
  await assert.rejects(authorizeToolCall(bob, 'get_game_state', { sessionId: 'bridge-alice' }), /does not own bridge/);
  await assert.rejects(authorizeToolCall(bob, 'wait_for_event', { sessionId: 'bridge-alice' }), /does not own bridge/);
  await assert.rejects(
    authorizeToolCall(bob, 'ack_event_subscription', {
      evidenceDir,
      subscriptionId: 'sub-alice',
    }),
    /does not own subscription/,
  );
  recordToolOwnership(bob, 'launch_project', response({ pid: 3456, run_id: 'failed' }, true));
  await assert.rejects(authorizeToolCall(bob, 'stop_run', { runId: 'failed' }), /does not own run/);
});

test('nested screenshot and scene paths stay inside the session evidence boundary, including for admin', async () => {
  const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'mcp-policy-session-a-'));
  const other = await mkdtemp(path.join(os.tmpdir(), 'mcp-policy-session-b-'));
  const makePolicy = (clientId: string, scopes: McpPermission[]) => {
    const value = createClientPolicy({ clientId, scopes, projectRoots: [], evidenceRoots: [evidenceDir] });
    value.ownedBridgeSessions.add('owned-session');
    return value;
  };
  const full = makePolicy('full', ['read', 'run', 'write']);
  const admin = makePolicy('admin', ['admin']);
  for (const client of [full, admin]) {
    client.bridgeEvidenceDirs.set('owned-session', evidenceDir);
    await assert.doesNotReject(
      authorizeToolCall(client, 'call_runtime_bridge', {
        sessionId: 'owned-session',
        method: 'capture_screenshot',
        params: { path: path.join(evidenceDir, 'shot.png') },
      }),
    );
    await assert.rejects(
      authorizeToolCall(client, 'call_runtime_bridge', {
        sessionId: 'owned-session',
        method: 'capture_screenshot',
        params: { path: path.join(other, 'shot.png') },
      }),
      /authorized root/,
    );
    await assert.rejects(
      authorizeToolCall(client, 'call_runtime_bridge', {
        sessionId: 'owned-session',
        method: 'reload_scene',
        params: { scenePath: 'res://../other.tscn' },
      }),
      /contained res:\/\//,
    );
    await assert.rejects(
      authorizeToolCall(client, 'compare_screenshots', {
        firstPath: path.join(evidenceDir, 'left.png'),
        secondPath: path.join(other, 'outside.png'),
      }),
      /authorized root/,
    );
  }
});

test('admin paths cannot escape an allowed root through a directory link', async () => {
  const allowed = await mkdtemp(path.join(os.tmpdir(), 'mcp-policy-allowed-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'mcp-policy-outside-'));
  await symlink(outside, path.join(allowed, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const admin = createClientPolicy({
    clientId: 'admin',
    scopes: ['admin'],
    projectRoots: [allowed],
    evidenceRoots: [allowed],
  });
  await assert.rejects(
    authorizeToolCall(admin, 'compare_screenshots', {
      firstPath: path.join(allowed, 'link', 'foreign.png'),
      secondPath: path.join(allowed, 'local.png'),
    }),
    /authorized root/,
  );
});

test('nested scenario and repair paths cannot escape authorized project or evidence roots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-policy-project-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'mcp-policy-foreign-'));
  const client = createClientPolicy({
    clientId: 'full',
    scopes: ['read', 'run', 'write'],
    projectRoots: [root],
    evidenceRoots: [root],
  });
  await assert.rejects(
    authorizeToolCall(client, 'execute_scenario', {
      scenario: { project: outside, steps: [] },
    }),
    /authorized root/,
  );
  await assert.rejects(
    authorizeToolCall(client, 'execute_scenario', {
      scenario: { project: root, steps: [{ launch: { project: outside } }] },
    }),
    /authorized root/,
  );
  await assert.rejects(
    authorizeToolCall(client, 'execute_scenario', {
      scenario: { project: root, steps: [{ screenshot: { name: 'x/../../../foreign' } }] },
    }),
    /safe basename/,
  );
  await assert.rejects(
    authorizeToolCall(client, 'dev_loop', {
      edits: [{ path: '../secret.txt' }],
    }),
    /project-relative/,
  );
  await assert.rejects(
    authorizeToolCall(client, 'submit_repair_candidate', {
      proposal: { edits: [{ path: '../secret.txt' }] },
    }),
    /project-relative/,
  );
});

test('Godot executable, bridge script and extra arguments require server approval', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-policy-entry-'));
  const godot = path.join(root, 'godot.exe');
  const otherGodot = path.join(root, 'other.exe');
  const bridge = path.join(root, 'bridge.gd');
  const otherBridge = path.join(root, 'other.gd');
  await Promise.all([godot, otherGodot, bridge, otherBridge].map((file) => writeFile(file, 'fixture')));
  const client = createClientPolicy({
    clientId: 'client',
    scopes: ['read', 'run', 'write'],
    projectRoots: [root],
    evidenceRoots: [root],
    approvedGodotPaths: [godot],
    approvedBridgePaths: [bridge],
  });
  await assert.doesNotReject(
    authorizeToolCall(client, 'open_runtime_bridge', { godotPath: godot, bridgePath: bridge, projectPath: root }),
  );
  await assert.rejects(
    authorizeToolCall(client, 'open_runtime_bridge', { godotPath: otherGodot, bridgePath: bridge, projectPath: root }),
    /approved by server/,
  );
  await assert.rejects(
    authorizeToolCall(client, 'open_runtime_bridge', { godotPath: godot, bridgePath: otherBridge, projectPath: root }),
    /approved by server/,
  );
  await assert.rejects(
    authorizeToolCall(client, 'launch_project', {
      godotPath: godot,
      projectPath: root,
      extraArgs: ['--script', otherBridge],
    }),
    /extraArgs are disabled/,
  );
});

test('stdio local policy confines paths and does not treat local access as unlimited write authority', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-stdio-policy-'));
  const foreign = await mkdtemp(path.join(os.tmpdir(), 'mcp-stdio-foreign-'));
  const policy = createStdioPolicy({
    MCP_STDIO_SCOPES: 'read',
    MCP_STDIO_PROJECT_ROOTS: root,
    MCP_STDIO_EVIDENCE_ROOTS: root,
    MCP_STDIO_APPROVED_GODOT_PATHS: process.execPath,
  });
  await assert.doesNotReject(authorizeToolCall(policy, 'read_project_file', { projectPath: root }));
  await assert.rejects(authorizeToolCall(policy, 'read_project_file', { projectPath: foreign }), /authorized root/);
  await assert.rejects(authorizeToolCall(policy, 'write_project_file', { projectPath: root }), /write permission/);
  await assert.rejects(
    authorizeToolCall(policy, 'get_runtime_scene_tree', { godotPath: process.execPath }),
    /run permission/,
  );
  await assert.rejects(authorizeToolCall(policy, 'launch_project', { godotPath: process.execPath }), /run permission/);
});

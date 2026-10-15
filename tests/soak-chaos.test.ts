import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, mkdir, rename, lstat, readdir, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { startEditorFixture, waitUntil } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';
import { getProcessStatus } from '../src/godot-runtime.js';
import { readProcessIdentity, stopIdentifiedProcess } from '../src/process-identity.js';
import { EditorBridge } from '../src/editor/editor-bridge.js';
import { EvidenceLog } from '../src/evidence-log.js';
import { ProjectTransactions } from '../src/project/transactions.js';

const godot = process.env.GODOT_PATH ?? '';
const native = { skip: process.platform !== 'win32' || !existsSync(godot), timeout: 90000 };
function body(r: any): any {
  return r.structuredContent ?? JSON.parse(r.content.find((c: any) => c.type === 'text')?.text ?? '{}');
}
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

test('T31 REAL MCP client process death converges stdin EOF to owned server/runtime cleanup', native, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-soak-client-death-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
  await writeFile(path.join(root, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n');
  const original = await readFile(path.join(root, 'main.tscn'));
  const nativeGodot = godot.replace(/_console\.exe$/i, '.exe');
  const helper = pathToFileURL(path.resolve('build/tests/helpers/editor-mcp.js')).href;
  const script = `import { wireEditor } from ${JSON.stringify(helper)};
    const root=${JSON.stringify(root)}, godot=${JSON.stringify(nativeGodot)};
    const c=await wireEditor(root,{transport:'stdio',godotPath:godot});
    const result=await c.call('open_runtime_bridge',{godotPath:godot,headless:true,
      bridgePath:${JSON.stringify(path.resolve('godot-plugin/runtime_bridge.gd'))},evidenceDir:root+'/.harness/runtime'});
    if(result.isError) throw new Error(JSON.stringify(result));
    process.send({runtimePid:result.structuredContent.pid,serverPid:c.client.transport.pid});
    setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, GODOT_HARNESS_RUN_REGISTRY_PATH: path.join(root, '.harness/registry.json') },
  });
  let stderr = '';
  child.stderr?.on('data', (b: Buffer) => {
    stderr = (stderr + b.toString()).slice(-4096);
  });
  const owned: Array<{ pid: number; identity: NonNullable<Awaited<ReturnType<typeof readProcessIdentity>>> }> = [];
  try {
    assert.ok(child.pid);
    const clientIdentity = await readProcessIdentity(child.pid);
    assert.ok(clientIdentity);
    owned.push({ pid: child.pid, identity: clientIdentity });
    const message = await new Promise<{ runtimePid: number; serverPid: number }>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Real client startup timeout: ' + stderr)), 20000);
      const onMessage = (value: any) => finish(undefined, value);
      const onClose = () => finish(new Error('Real client exited early: ' + stderr));
      const onError = (error: Error) => finish(error);
      function finish(error?: Error, value?: any) {
        clearTimeout(timer);
        child.off('message', onMessage);
        child.off('close', onClose);
        child.off('error', onError);
        if (error) reject(error);
        else resolve(value);
      }
      child.once('message', onMessage);
      child.once('close', onClose);
      child.once('error', onError);
    });
    for (const pid of [message.serverPid, message.runtimePid]) {
      assert.ok(Number.isSafeInteger(pid) && pid > 0);
      const identity = await readProcessIdentity(pid);
      assert.ok(identity);
      owned.push({ pid, identity });
    }
    assert.equal(await stopIdentifiedProcess(child.pid, clientIdentity), 'STOPPED');
    await waitUntil(async () => (owned.every((a) => !getProcessStatus(a.pid).running) ? true : undefined), 15000);
    assert.deepEqual(await readFile(path.join(root, 'main.tscn')), original);
  } finally {
    // Cleanup never guesses actor PIDs or kills a new process that reused one.
    for (const actor of owned)
      if (getProcessStatus(actor.pid).running) await stopIdentifiedProcess(actor.pid, actor.identity);
  }
});

test(
  'T31 REAL TCP split frame has no early dispatch; dropped partial request cannot change saved scene',
  native,
  async () => {
    const f = await startEditorFixture(godot);
    const original = await readFile(path.join(f.root, 'main.tscn'));
    const socket = net.createConnection({ host: '127.0.0.1', port: f.endpoint.port });
    let received = '';
    socket.setEncoding('utf8');
    socket.on('data', (s) => {
      received += s;
    });
    socket.on('error', () => {});
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });
      const hello =
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'split-auth',
          method: 'editor.hello',
          params: {
            protocolVersion: f.endpoint.protocolVersion,
            plane: 'editor',
            projectId: f.config.projectId,
            projectPath: f.config.projectPath,
            sessionId: f.endpoint.sessionId,
            clientId: 'local-client',
            token: f.token,
          },
        }) + '\n';
      const split = Math.floor(hello.length / 2);
      socket.write(hello.slice(0, split));
      await delay(100);
      assert.equal(received, '', 'An incomplete authenticated frame must not dispatch');
      socket.write(hello.slice(split));
      const reply = await waitUntil(async () =>
        received.includes('\n') ? JSON.parse(received.split('\n')[0]) : undefined,
      );
      assert.equal(reply.id, 'split-auth');
      assert.equal(reply.result.plane, 'editor');
      assert.ok(!received.includes(f.token), 'Credential must never appear in the reply');
      // Drop a deliberately incomplete mutation frame before newline/authenticated dispatch.
      socket.write('{"jsonrpc":"2.0","id":"dropped-write","method":"scene.apply","params":');
      socket.destroy();
      const bridge = await EditorBridge.connect({ projectPath: f.root, ownerId: 'local-client' });
      try {
        assert.equal((await bridge.snapshot()).sessionId, f.endpoint.sessionId);
      } finally {
        bridge.close();
      }
      assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), original);
    } finally {
      socket.destroy();
      await f.stop();
    }
  },
);

test(
  'T31 REAL native editor death fails closed; explicit owner-verified fixture recovery preserves saved bytes',
  native,
  async () => {
    const f = await startEditorFixture(godot, { writeEnabled: true });
    const c = await wireEditor(f.root, { transport: 'stdio' });
    const original = await readFile(path.join(f.root, 'main.tscn'));
    const endpointFile = path.join(f.root, '.harness/editor-endpoint.json');
    const endpointBytes = await readFile(endpointFile);
    let reopened: Awaited<ReturnType<typeof startEditorFixture>> | undefined;
    try {
      assert.notEqual((await c.call('get_editor_state')).isError, true);
      const pid = f.endpoint.editorPid;
      const identity = await readProcessIdentity(pid);
      assert.ok(identity);
      assert.equal(await stopIdentifiedProcess(pid, identity), 'STOPPED');
      await f.exited;
      assert.equal(getProcessStatus(pid).running, false);
      const result = await c.call('get_editor_state', { timeoutMs: 1500 });
      assert.equal(result.isError, true);
      assert.equal(body(result).code, 'ENGINE_UNAVAILABLE');
      assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), original);
      // Published contract intentionally refuses automatic crash takeover. This is an explicit TEST OWNER
      // maintenance step on our isolated fixture, NOT product auto-recovery and NOT recursive deletion.
      assert.equal(getProcessStatus(f.pid!).running, false);
      assert.deepEqual(await readFile(endpointFile), endpointBytes);
      const endpoint = JSON.parse(endpointBytes.toString());
      assert.equal(endpoint.editorPid, pid);
      assert.equal(endpoint.sessionId, f.endpoint.sessionId);
      const info = await lstat(endpointFile);
      assert.equal(info.isSymbolicLink(), false);
      assert.equal(info.isFile(), true);
      assert.equal(info.nlink, 1);
      const lease = path.join(f.root, '.harness/editor-lease');
      assert.equal((await lstat(lease)).isSymbolicLink(), false);
      assert.deepEqual(await readdir(lease), []);
      assert.equal(getProcessStatus(pid).running, false);
      await unlink(endpointFile);
      await rmdir(lease);
      reopened = await startEditorFixture(godot, { existingRoot: f.root, writeEnabled: true });
      assert.notEqual(reopened.endpoint.sessionId, f.endpoint.sessionId);
      const state = await c.call('get_editor_state');
      assert.notEqual(state.isError, true);
      assert.equal(body(state).sessionId, reopened.endpoint.sessionId);
      assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), original);
    } finally {
      await c.close();
      await reopened?.stop();
      await f.stop();
    }
  },
);

test(
  'T31 REAL native runtime death returns ENGINE_UNAVAILABLE; new stdio server cannot revive stale session',
  native,
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-soak-runtime-death-'));
    await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
    await writeFile(path.join(root, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n');
    const original = await readFile(path.join(root, 'main.tscn'));
    // Direct native executable, not a Windows console supervisor PID.
    const nativeGodot = godot.replace(/_console\.exe$/i, '.exe');
    const c = await wireEditor(root, { transport: 'stdio', godotPath: nativeGodot });
    let pid = 0;
    let identity: Awaited<ReturnType<typeof readProcessIdentity>> = null;
    try {
      const opened = await c.call('open_runtime_bridge', {
        godotPath: nativeGodot,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        headless: true,
        evidenceDir: path.join(root, '.harness/runtime'),
      });
      assert.notEqual(opened.isError, true);
      const sessionId = body(opened).session_id;
      pid = body(opened).pid;
      identity = await readProcessIdentity(pid);
      assert.ok(identity);
      assert.equal(await stopIdentifiedProcess(pid, identity), 'STOPPED');
      assert.equal(getProcessStatus(pid).running, false);
      await delay(50);
      const result = await c.call('get_game_state', { sessionId, nodePath: '.', properties: [] });
      assert.equal(result.isError, true);
      assert.equal(body(result).code, 'ENGINE_UNAVAILABLE');
      await c.close();
      const restart = await wireEditor(root, { transport: 'stdio', godotPath: nativeGodot });
      try {
        const stale = await restart.call('get_game_state', { sessionId, nodePath: '.', properties: [] });
        assert.equal(stale.isError, true);
        assert.equal(body(stale).code, 'FORBIDDEN');
        assert.notEqual((await restart.call('get_project_info')).isError, true);
        assert.deepEqual(await readFile(path.join(root, 'main.tscn')), original);
      } finally {
        await restart.close();
      }
    } finally {
      await c.close();
      if (pid && identity && getProcessStatus(pid).running) await stopIdentifiedProcess(pid, identity);
    }
  },
);

test('T31 REAL filesystem log obstruction reports write failure and preserves earlier evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-soak-log-obstruction-'));
  const log = await EvidenceLog.create(root);
  log.append('stderr', 'critical-before-fault\n');
  await log.drain();
  await rename(path.join(root, 'stderr.log'), path.join(root, 'stderr.before-fault.log'));
  await mkdir(path.join(root, 'stderr.log'));
  log.append('stderr', 'must-not-report-success\n');
  await assert.rejects(log.drain());
  assert.equal(await readFile(path.join(root, 'stderr.before-fault.log'), 'utf8'), 'critical-before-fault\n');
});

test('T31 SIMULATED read-only mutation failure rolls back prior bytes; not a real full disk or ACL change', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-soak-readonly-injection-'));
  const originals = ['one = 1\n', 'two = 2\n'];
  for (const [i, bytes] of originals.entries()) await writeFile(path.join(root, `${i}.gd`), bytes);
  const tx = new ProjectTransactions({
    projectPath: root,
    verifyApproval: async (p) => ({ actor: 'TEST DOUBLE', receipt: 'MOCK', planHash: p.planHash }),
    beforeMutation: async (i) => {
      if (i === 1) throw Object.assign(new Error('SIMULATED readonly volume'), { code: 'EACCES' });
    },
  });
  const p = await tx.prepare(
    originals.map((bytes, i) => ({
      kind: 'replace' as const,
      path: `${i}.gd`,
      content: 'modified\n',
      expectedSha256: sha(bytes),
    })),
  );
  await tx.approve(p.operationId);
  await assert.rejects(tx.apply(p.operationId, async () => true));
  assert.equal((await tx.inspect(p.operationId)).state, 'ROLLED_BACK');
  for (const [i, bytes] of originals.entries()) assert.equal(await readFile(path.join(root, `${i}.gd`), 'utf8'), bytes);
});

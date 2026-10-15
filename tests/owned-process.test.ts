import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createMcpServer } from '../src/mcp-server-sdk.js';
import { createClientPolicy, recordToolOwnership } from '../src/mcp/access-policy.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { runRegistry } from '../src/run-registry.js';
import { readProcessIdentity, stopIdentifiedProcess } from '../src/process-identity.js';
import { getProcessStatus } from '../src/godot-runtime.js';

test(
  'MCP stale PID grant cannot stop, cancel or inspect a foreign process generation',
  { timeout: 20000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-owned-pid-'));
    const ownRoot = path.join(root, 'own'),
      foreignRoot = path.join(root, 'foreign');
    await mkdir(ownRoot);
    await mkdir(foreignRoot);
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
    assert.ok(child.pid);
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    const identity = await readProcessIdentity(child.pid);
    assert.ok(identity);
    const old = `old-${randomUUID()}`,
      foreign = `foreign-${randomUUID()}`;
    runRegistry.register({ runId: old, pid: child.pid, projectPath: ownRoot, evidenceDir: ownRoot });
    // Explicit simulated old OS generation; the foreign child and RPC dispatch are REAL.
    runRegistry.attachIdentity(old, { ...identity, startToken: 'SIMULATED-OLDER-GENERATION' });
    runRegistry.markTerminal(old, 'STOPPED', 0);
    runRegistry.register({ runId: foreign, pid: child.pid, projectPath: foreignRoot, evidenceDir: foreignRoot });
    runRegistry.attachIdentity(foreign, identity);
    const policy = createClientPolicy({
      clientId: 'old-client',
      scopes: ['read', 'run'],
      projectRoots: [ownRoot],
      evidenceRoots: [ownRoot],
    });
    recordToolOwnership(policy, 'launch_project', {
      content: [{ text: JSON.stringify({ pid: child.pid, run_id: old }) }],
    });
    const server = createMcpServer(policy),
      client = new Client({ name: 'stale-pid-regression', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    try {
      for (const name of ['stop_project', 'cancel_project', 'get_process_status']) {
        const response = await client.callTool({ name, arguments: { pid: child.pid } });
        assert.equal(response.isError, true);
        assert.equal((response.structuredContent as { code: string }).code, 'CONFLICT', JSON.stringify(response));
        assert.equal(getProcessStatus(child.pid).running, true);
        assert.equal(runRegistry.get(foreign)?.state, 'RUNNING');
      }
      assert.equal(runRegistry.get(old)?.state, 'STOPPED');
    } finally {
      await client.close();
      await server.close();
      assert.equal(await stopIdentifiedProcess(child.pid, identity), 'STOPPED');
      await closed;
      runRegistry.markTerminal(foreign, 'STOPPED', 0);
    }
  },
);

test('MCP owned PID operations use the bound run, not global PID lookup', { timeout: 20000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-owned-run-'));
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  assert.ok(child.pid);
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  const identity = await readProcessIdentity(child.pid);
  assert.ok(identity);
  const runId = `owned-${randomUUID()}`;
  runRegistry.register({ runId, pid: child.pid, projectPath: root, evidenceDir: root });
  runRegistry.attachIdentity(runId, identity);
  const policy = createClientPolicy({
    clientId: 'owner',
    scopes: ['read', 'run'],
    projectRoots: [root],
    evidenceRoots: [root],
  });
  recordToolOwnership(policy, 'launch_project', {
    content: [{ text: JSON.stringify({ pid: child.pid, run_id: runId }) }],
  });
  const server = createMcpServer(policy),
    client = new Client({ name: 'bound-run-regression', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  const oldLookup = runRegistry.stopByPid;
  // TEST ONLY tripwire: dispatch must never reselect a newer global PID record.
  runRegistry.stopByPid = async () => {
    throw new Error('Unsafe global PID lookup invoked');
  };
  try {
    const status = await client.callTool({ name: 'get_process_status', arguments: { pid: child.pid } });
    assert.notEqual(status.isError, true);
    const stopped = await client.callTool({ name: 'stop_project', arguments: { pid: child.pid } });
    assert.notEqual(stopped.isError, true, JSON.stringify(stopped));
    assert.equal((stopped.structuredContent as { run_id: string }).run_id, runId);
    await closed;
    assert.equal(getProcessStatus(child.pid).running, false);
  } finally {
    runRegistry.stopByPid = oldLookup;
    await client.close();
    await server.close();
    if (getProcessStatus(child.pid).running) await stopIdentifiedProcess(child.pid, identity);
    await closed;
    runRegistry.markTerminal(runId, 'STOPPED', 0);
  }
});

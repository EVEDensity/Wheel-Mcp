import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../src/mcp-server-sdk.js';
import { executeDevelopmentLoop, ProjectEdits } from '../src/development-loop.js';
import { ProjectTransactions } from '../src/project/transactions.js';
import { fixtureApproval } from './helpers/project-approval.js';
import { createClientPolicy, type McpClientPolicy } from '../src/mcp/access-policy.js';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const data = (result: Awaited<ReturnType<Client['callTool']>>) => result.structuredContent as Record<string, unknown>;
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-write-review-'));
  await writeFile(path.join(root, 'main.gd'), 'value = 1\n');
  return root;
}
async function connection(handler?: (message: string) => Promise<ElicitResult>, policy?: McpClientPolicy) {
  const server = createMcpServer(policy);
  const client = new Client(
    { name: 'approval-test-double', version: '1' },
    {
      capabilities: handler ? { elicitation: { form: {} } } : {},
    },
  );
  if (handler) client.setRequestHandler(ElicitRequestSchema, (request) => handler(request.params.message));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  // These isolated T10 approval fixtures intentionally contain raw, non-project text.
  // Engine validation and default-mode behavior are separately exercised in T14.
  const originalCall = client.callTool.bind(client);
  client.callTool = ((request, ...rest) =>
    originalCall(
      {
        ...request,
        arguments:
          request.name === 'write_project_file' ? { ...request.arguments, validationMode: 'raw' } : request.arguments,
      },
      ...rest,
    )) as Client['callTool'];
  return {
    server,
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

test('MCP project write without human confirmation capability fails closed, not via approved=true', async () => {
  const root = await fixture();
  const wire = await connection();
  try {
    const result = await wire.client.callTool({
      name: 'write_project_file',
      arguments: {
        projectPath: root,
        filePath: 'main.gd',
        content: 'value = 2\n',
        approved: true,
      },
    });
    assert.equal(result.isError, true);
    assert.equal(data(result).code, 'FORBIDDEN');
    assert.equal(await readFile(path.join(root, 'main.gd'), 'utf8'), 'value = 1\n');
  } finally {
    await wire.close();
  }
});

for (const response of [
  { action: 'decline' },
  { action: 'cancel' },
  { action: 'accept', content: { confirm: false } },
] as ElicitResult[]) {
  test(`host confirmation ${JSON.stringify(response)} never writes`, async () => {
    const root = await fixture();
    const wire = await connection(async () => response);
    try {
      const result = await wire.client.callTool({
        name: 'write_project_file',
        arguments: {
          projectPath: root,
          filePath: 'main.gd',
          content: 'value = 2\n',
        },
      });
      assert.equal(result.isError, true);
      assert.equal(data(result).code, 'FORBIDDEN');
      assert.equal(await readFile(path.join(root, 'main.gd'), 'utf8'), 'value = 1\n');
    } finally {
      await wire.close();
    }
  });
}

test('MCP approved write binds original hashes, provides safe retry identity and does not re-elicit on replay', async () => {
  const root = await fixture();
  let confirmations = 0;
  const wire = await connection(async (message) => {
    confirmations++;
    assert.match(message, /value = 1/);
    assert.match(message, /value = 2/);
    assert.match(message, new RegExp(sha('value = 1\n')));
    assert.equal(await readFile(path.join(root, 'main.gd'), 'utf8'), 'value = 1\n');
    return { action: 'accept', content: { confirm: true } };
  });
  const args = {
    projectPath: root,
    filePath: 'main.gd',
    content: 'value = 2\n',
    operationId: 'retry-write',
    expectedSha256: sha('value = 1\n'),
  };
  try {
    const first = await wire.client.callTool({ name: 'write_project_file', arguments: args });
    assert.notEqual(first.isError, true);
    assert.equal(data(first).transactionState, 'COMMITTED');
    assert.equal(data(first).validation, 'NOT_RUN');
    const retry = await wire.client.callTool({ name: 'write_project_file', arguments: args });
    assert.notEqual(retry.isError, true);
    assert.equal(confirmations, 1);
    const different = await wire.client.callTool({
      name: 'write_project_file',
      arguments: { ...args, content: 'different' },
    });
    assert.equal(different.isError, true);
    assert.equal(await readFile(path.join(root, 'main.gd'), 'utf8'), 'value = 2\n');
  } finally {
    await wire.close();
  }
});

test('edit during approval is preserved, and an oversized diff cannot bypass complete review', async () => {
  const root = await fixture();
  let requests = 0;
  const wire = await connection(async () => {
    requests++;
    await writeFile(path.join(root, 'main.gd'), 'external\n');
    return { action: 'accept', content: { confirm: true } };
  });
  try {
    const changed = await wire.client.callTool({
      name: 'write_project_file',
      arguments: { projectPath: root, filePath: 'main.gd', content: 'value = 2\n' },
    });
    assert.equal(changed.isError, true);
    assert.equal(data(changed).code, 'CONFLICT');
    assert.equal(await readFile(path.join(root, 'main.gd'), 'utf8'), 'external\n');
    const large = await wire.client.callTool({
      name: 'write_project_file',
      arguments: { projectPath: root, filePath: 'large.gd', content: '大'.repeat(12000) },
    });
    assert.equal(large.isError, true);
    assert.equal(data(large).code, 'FORBIDDEN');
    assert.equal(requests, 1);
    await assert.rejects(readFile(path.join(root, 'large.gd')), /ENOENT/);
  } finally {
    await wire.close();
  }
});

test('dev_loop with no approval provider never writes or starts Godot', async () => {
  const root = await fixture();
  const result = await executeDevelopmentLoop({
    projectPath: root,
    bridgePath: 'not-present',
    evidenceDir: path.join(root, 'evidence'),
    edits: [{ path: 'main.gd', find: '1', replace: '2' }],
    checks: [{ id: 'value', method: 'get_property', op: 'exists' }],
  });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.code, 'FORBIDDEN');
  assert.equal(result.attempts.length, 0);
  assert.equal(result.transactions[0].state, 'PREPARED');
  assert.deepEqual(result.changedFiles, []);
  assert.deepEqual(result.plannedFiles, ['main.gd']);
  assert.equal(result.persisted, false);
  assert.equal(await readFile(path.join(root, 'main.gd'), 'utf8'), 'value = 1\n');
});

test('failed candidate restores the base before the next composed repair is separately approved and validated', async () => {
  const root = await fixture();
  const previews: string[] = [];
  const editor = new ProjectEdits(root, path.join(root, 'evidence'), async (plan) => {
    previews.push(plan.diffPreview);
    assert.equal(await readFile(path.join(root, 'main.gd'), 'utf8'), 'value = 1\n');
    return fixtureApproval(plan);
  });
  await editor.apply([{ path: 'main.gd', find: '1', replace: '2' }]);
  assert.equal(await editor.validate(async () => false), false);
  await editor.apply([{ path: 'main.gd', find: '2', replace: '3', expectedSha256: sha('value = 2\n') }]);
  assert.equal(
    await editor.validate(async () => {
      assert.equal(await readFile(path.join(root, 'main.gd'), 'utf8'), 'value = 3\n');
      return true;
    }),
    true,
  );
  assert.equal(previews.length, 2);
  assert.match(previews[1], /- value = 1/);
  assert.match(previews[1], /\+ value = 3/);
  assert.deepEqual(
    editor.transactions.map((t) => t.state),
    ['ROLLED_BACK', 'COMMITTED'],
  );
  assert.equal(await readFile(path.join(root, 'main.gd'), 'utf8'), 'value = 3\n');
});

test('journal mutation cannot retain an old approved plan hash', async () => {
  const root = await fixture();
  const tx = new ProjectTransactions({ projectPath: root, verifyApproval: fixtureApproval });
  const plan = await tx.prepare([{ kind: 'create', path: 'new.gd', content: 'new\n' }]);
  await tx.approve(plan.operationId);
  const file = path.join(root, '.harness', 'transactions', plan.operationId, 'journal.json');
  const journal = JSON.parse(await readFile(file, 'utf8'));
  journal.mutations[0].path = 'other.gd';
  await writeFile(file, JSON.stringify(journal));
  await assert.rejects(
    tx.apply(plan.operationId, async () => true),
    /plan hash/,
  );
  await assert.rejects(readFile(path.join(root, 'other.gd')), /ENOENT/);
});

test('another transaction owner cannot reuse a prepared or approved operation ID', async () => {
  const root = await fixture();
  const owner = new ProjectTransactions(
    Object.assign({ projectPath: root, verifyApproval: fixtureApproval }, { ownerId: 'owner-A' }),
  );
  const other = new ProjectTransactions(
    Object.assign({ projectPath: root, verifyApproval: fixtureApproval }, { ownerId: 'owner-B' }),
  );
  const operations = [
    { kind: 'replace' as const, path: 'main.gd', content: 'value = 2\n', expectedSha256: sha('value = 1\n') },
  ];
  const plan = await owner.prepare(operations, 'private-plan');
  await owner.approve(plan.operationId);
  await assert.rejects(other.prepare(operations, 'private-plan'), /owner|another request/);
  await assert.rejects(
    other.apply(plan.operationId, async () => true),
    /owner/,
  );
  assert.equal(await readFile(path.join(root, 'main.gd'), 'utf8'), 'value = 1\n');
});

test('MCP transport identity cannot reuse another client approval, but completed foreign journals do not block new plans', async () => {
  const root = await fixture();
  const owner = new ProjectTransactions({ projectPath: root, ownerId: 'client-A', verifyApproval: fixtureApproval });
  const plan = await owner.prepare(
    [{ kind: 'replace', path: 'main.gd', content: 'value = 2\n', expectedSha256: sha('value = 1\n') }],
    'owned-id',
  );
  await owner.approve(plan.operationId);
  const wire = await connection(
    async () => ({ action: 'accept', content: { confirm: true } }),
    createClientPolicy({
      clientId: 'client-B',
      scopes: ['write'],
      projectRoots: [root],
      evidenceRoots: [root],
    }),
  );
  try {
    const denied = await wire.client.callTool({
      name: 'write_project_file',
      arguments: {
        projectPath: root,
        filePath: 'main.gd',
        content: 'value = 2\n',
        expectedSha256: sha('value = 1\n'),
        operationId: 'owned-id',
        ownerId: 'client-A',
      },
    });
    assert.equal(denied.isError, true);
    assert.equal(data(denied).code, 'FORBIDDEN');
    assert.equal(await readFile(path.join(root, 'main.gd'), 'utf8'), 'value = 1\n');
    assert.equal(await owner.apply(plan.operationId, async () => true), 'COMMITTED');
    const accepted = await wire.client.callTool({
      name: 'write_project_file',
      arguments: {
        projectPath: root,
        filePath: 'other.gd',
        content: 'other\n',
      },
    });
    assert.notEqual(accepted.isError, true);
    const other = new ProjectTransactions({ projectPath: root, ownerId: 'client-B' });
    assert.equal((await other.list()).length, 1);
    await assert.rejects(other.inspect(plan.operationId), /another owner/);
  } finally {
    await wire.close();
  }
});

test('foreign interrupted transactions block new writes until their authenticated owner recovers', async () => {
  const root = await fixture();
  const owner = new ProjectTransactions({
    projectPath: root,
    ownerId: 'client-A',
    verifyApproval: fixtureApproval,
    checkpoint: async (name) => {
      if (name === 'WRITE_0') throw new Error('crash');
    },
  });
  const plan = await owner.prepare([
    { kind: 'replace', path: 'main.gd', content: 'value = 2\n', expectedSha256: sha('value = 1\n') },
  ]);
  await owner.approve(plan.operationId);
  await assert.rejects(
    owner.apply(plan.operationId, async () => true),
    /crash/,
  );
  const other = new ProjectTransactions({ projectPath: root, ownerId: 'client-B' });
  await assert.rejects(other.recoverPending(), /another owner/);
  assert.equal(await readFile(path.join(root, 'main.gd'), 'utf8'), 'value = 2\n');
  const restored = new ProjectTransactions({ projectPath: root, ownerId: 'client-A' });
  await restored.recoverPending();
  assert.equal(await readFile(path.join(root, 'main.gd'), 'utf8'), 'value = 1\n');
  assert.deepEqual(await other.recoverPending(), []);
});

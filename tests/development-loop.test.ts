import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ProjectEdits, evaluateCheck, developmentLoopSchema, executeDevelopmentLoop } from '../src/development-loop.js';
import { createTimeoutContext } from '../src/timeout.js';
import { authorizeToolCall, createClientPolicy } from '../src/mcp/access-policy.js';
test('exact edits validate the entire batch before writes; rollback preserves concurrent edits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'loop-edit-'));
  const evidence = path.join(root, 'e');
  await writeFile(path.join(root, 'a.gd'), 'value = 1');
  const edits = new ProjectEdits(root, evidence);
  await assert.rejects(
    edits.apply([
      { path: 'a.gd', find: '1', replace: '2' },
      { path: 'a.gd', find: 'missing', replace: '3' },
    ]),
    /exactly once/,
  );
  assert.equal(await readFile(path.join(root, 'a.gd'), 'utf8'), 'value = 1');
  for (const p of ['../a.gd', '.git/config', '.GIT/config', 'a.gd:stream', 'a.gd.'])
    await assert.rejects(edits.apply([{ path: p, find: '1', replace: '2' }]));
  await assert.rejects(
    edits.apply([{ path: 'a.gd', find: '1', replace: '2', expectedSha256: '0'.repeat(64) }]),
    /hash/,
  );
  await edits.apply([{ path: 'a.gd', find: '1', replace: '2' }]);
  assert.deepEqual(await edits.rollback(), []);
  assert.equal(await readFile(path.join(root, 'a.gd'), 'utf8'), 'value = 1');
  const next = new ProjectEdits(root, evidence);
  await next.apply([{ path: 'a.gd', find: '1', replace: '2' }]);
  await writeFile(path.join(root, 'a.gd'), 'external');
  assert.equal((await next.rollback()).length, 1);
  assert.equal(await readFile(path.join(root, 'a.gd'), 'utf8'), 'external');
});
test('assertions fail closed and dev_loop requires non-vacuous checks', () => {
  assert.equal(evaluateCheck({ value: { x: 4 } }, { path: 'value.x', op: 'greater', expected: 3 }), true);
  assert.equal(evaluateCheck({}, { path: 'value', op: 'equals', expected: undefined }), false);
  assert.equal(evaluateCheck({}, { path: '__proto__', op: 'exists' }), false);
  assert.equal(
    developmentLoopSchema.safeParse({ projectPath: 'a', bridgePath: 'b', evidenceDir: 'e', checks: [] }).success,
    false,
  );
  assert.equal(
    developmentLoopSchema.safeParse({
      projectPath: 'a',
      bridgePath: 'b',
      evidenceDir: 'e',
      checks: [{ id: 'x', method: 'get_property', op: 'equals' }],
    }).success,
    false,
  );
});
test('HTTP dev_loop needs both write and run and isolates baseline evidence', () => {
  const root = path.resolve('runs');
  const args = { projectPath: root, bridgePath: root, evidenceDir: root };
  const policy = createClientPolicy({ clientId: 'x', scopes: ['write'], projectRoots: [root], evidenceRoots: [root] });
  assert.throws(() => authorizeToolCall(policy, 'dev_loop', args), /run/);
  const full = createClientPolicy({
    clientId: 'x',
    scopes: ['write', 'run'],
    projectRoots: [root],
    evidenceRoots: [root],
  });
  assert.throws(
    () => authorizeToolCall(full, 'dev_loop', { ...args, baselinePath: path.resolve('package.json') }),
    /authorized root/,
  );
});
test('already cancelled loop does not edit or launch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'loop-cancel-'));
  await writeFile(path.join(root, 'a.gd'), 'before');
  const context = createTimeoutContext(10000);
  context.cancel();
  try {
    const r = await executeDevelopmentLoop(
      {
        projectPath: root,
        bridgePath: 'missing',
        evidenceDir: root,
        edits: [{ path: 'a.gd', find: 'before', replace: 'after' }],
        checks: [{ id: 'value', method: 'get_property', op: 'exists' }],
      },
      context,
    );
    assert.equal(r.status, 'FAIL');
    assert.equal(r.metrics.attemptCount, 0);
    assert.equal(await readFile(path.join(root, 'a.gd'), 'utf8'), 'before');
  } finally {
    context.dispose();
  }
});

import test from 'node:test';
import { fixtureStdioEnv } from './helpers/stdio-fixture.js';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ProjectEdits, evaluateCheck, developmentLoopSchema, executeDevelopmentLoop } from '../src/development-loop.js';
import { createTimeoutContext } from '../src/timeout.js';
import { authorizeToolCall, createClientPolicy } from '../src/mcp/access-policy.js';
import { fixtureApproval, enableFixtureApproval } from './helpers/project-approval.js';
test('exact edits validate the entire batch before writes; rollback preserves concurrent edits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'loop-edit-'));
  const evidence = path.join(root, 'e');
  await writeFile(path.join(root, 'a.gd'), 'value = 1');
  const edits = new ProjectEdits(root, evidence, fixtureApproval);
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
  assert.equal(await readFile(path.join(root, 'a.gd'), 'utf8'), 'value = 1', 'apply only composes the candidate');
  assert.equal(
    await edits.validate(async () => {
      assert.equal(await readFile(path.join(root, 'a.gd'), 'utf8'), 'value = 2');
      return false;
    }),
    false,
  );
  assert.deepEqual(await edits.rollback(), []);
  assert.equal(await readFile(path.join(root, 'a.gd'), 'utf8'), 'value = 1');
  const next = new ProjectEdits(root, evidence, fixtureApproval);
  await next.apply([{ path: 'a.gd', find: '1', replace: '2' }]);
  await assert.rejects(
    next.validate(async () => {
      await writeFile(path.join(root, 'a.gd'), 'external');
      return false;
    }),
    /concurrent/,
  );
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
test('HTTP dev_loop needs both write and run and isolates baseline evidence', async () => {
  const root = path.resolve('runs');
  const bridgePath = path.resolve('godot-plugin/runtime_bridge.gd');
  const args = { projectPath: root, bridgePath, godotPath: process.execPath, evidenceDir: root };
  const policy = createClientPolicy({ clientId: 'x', scopes: ['write'], projectRoots: [root], evidenceRoots: [root] });
  await assert.rejects(authorizeToolCall(policy, 'dev_loop', args), /run/);
  const full = createClientPolicy({
    clientId: 'x',
    scopes: ['write', 'run'],
    projectRoots: [root],
    evidenceRoots: [root],
    approvedGodotPaths: [process.execPath],
    approvedBridgePaths: [bridgePath],
  });
  await assert.rejects(
    authorizeToolCall(full, 'dev_loop', { ...args, baselinePath: path.resolve('package.json') }),
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
test(
  'official stdio MCP client -> dev_loop -> Godot: repair, render, baseline, wrong repair rollback, diagnostics',
  { skip: !process.env.GODOT_PATH, timeout: 180000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'loop-real-'));
    const project = path.join(root, 'game');
    await mkdir(project);
    await writeFile(
      path.join(project, 'project.godot'),
      '[application]\nconfig/name="Repair loop test"\nrun/main_scene="res://main.tscn"\n[display]\nwindow/size/viewport_width=320\nwindow/size/viewport_height=180\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n',
    );
    await writeFile(
      path.join(project, 'main.tscn'),
      '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="Main" type="ColorRect"]\nscript = ExtResource("1")\noffset_right = 320.0\noffset_bottom = 180.0\ncolor = Color(0.2, 0.4, 0.7, 1)\n',
    );
    await writeFile(path.join(project, 'main.gd'), 'extends ColorRect\nvar health = 0\n');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('build/src/mcp-server-sdk.js')],
      stderr: 'pipe',
      env: fixtureStdioEnv(),
    });
    transport.stderr?.on('data', () => {});
    const client = new Client({ name: 'repair-test', version: '1' }, { capabilities: { elicitation: { form: {} } } });
    enableFixtureApproval(client);
    const args = {
      projectPath: project,
      godotPath: process.env.GODOT_PATH,
      bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
      evidenceDir: path.join(root, 'evidence'),
      timeoutMs: 60000,
      checks: [
        {
          id: 'health',
          method: 'get_property',
          params: { nodePath: '.', property: 'health' },
          path: 'value',
          op: 'equals',
          expected: 100,
        },
      ],
    };
    const call = async (extra: Record<string, unknown>) => {
      const r = await client.callTool({ name: 'dev_loop', arguments: { ...args, ...extra } }, undefined, {
        timeout: 90000,
      });
      return { wire: r, value: JSON.parse((r.content as Array<{ text: string }>)[0].text) };
    };
    try {
      await client.connect(transport);
      const repaired = await call({
        screenshot: true,
        repairs: [
          {
            id: 'health-fix',
            whenFailedCheckId: 'health',
            edits: [{ path: 'main.gd', find: 'health = 0', replace: 'health = 100' }],
          },
        ],
      });
      assert.equal(repaired.value.status, 'PASS', JSON.stringify(repaired.value));
      assert.equal(repaired.value.metrics.retryCount, 1);
      assert.equal(repaired.value.attempts[0].status, 'FAIL');
      assert.equal(repaired.value.cleanup, true);
      const shot = repaired.value.attempts[1].checks.find((c: { id: string }) => c.id === 'screenshot').actual;
      assert.equal(shot.width, 320);
      assert.equal(shot.height, 180);
      const healthy = await call({ baselinePath: repaired.value.screenshotPath });
      assert.equal(healthy.value.status, 'PASS');
      assert.equal(healthy.value.metrics.retryCount, 0);
      const broken = await call({
        edits: [{ path: 'main.gd', find: 'health = 100', replace: 'health = 0' }],
        repairs: [
          {
            id: 'wrong',
            whenFailedCheckId: 'health',
            edits: [{ path: 'main.gd', find: 'health = 0', replace: 'health = 3' }],
          },
        ],
      });
      assert.equal(broken.value.status, 'FAIL');
      assert.equal(broken.wire.isError, true);
      assert.equal(broken.value.rolledBack, true);
      assert.equal(broken.value.metrics.retryCount, 1);
      assert.match(await readFile(path.join(project, 'main.gd'), 'utf8'), /health = 100/);
      const diagnostic = await call({
        edits: [
          {
            path: 'main.gd',
            find: 'var health = 100',
            replace: 'var health = 100\nfunc _ready():\n    push_error("seeded runtime fault")',
          },
        ],
      });
      assert.equal(diagnostic.value.status, 'FAIL');
      assert.ok(diagnostic.value.errorCount > 0);
      assert.equal(diagnostic.value.rolledBack, true);
    } finally {
      await client.close();
    }
  },
);

test(
  'in-flight cancellation and timeout stop Godot, roll back edits and release the project lease',
  { skip: !process.env.GODOT_PATH, timeout: 45000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'loop-inflight-'));
    await writeFile(
      path.join(root, 'project.godot'),
      '[application]\nconfig/name="Cancel test"\nrun/main_scene="res://main.tscn"\n',
    );
    await writeFile(path.join(root, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n');
    await writeFile(path.join(root, 'code.gd'), 'before');
    const input = {
      projectPath: root,
      godotPath: process.env.GODOT_PATH,
      bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
      evidenceDir: path.join(root, 'evidence'),
      waitEvent: 'never-emitted',
      checks: [{ id: 'tree', method: 'get_scene_tree' as const, op: 'exists' as const }],
      edits: [{ path: 'code.gd', find: 'before', replace: 'after' }],
      timeoutMs: 15000,
    };
    const context = createTimeoutContext(20000);
    try {
      const pending = executeDevelopmentLoop(input, context, fixtureApproval);
      let pid: number | undefined;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const dirs = await readdir(input.evidenceDir).catch(() => []);
        for (const dir of dirs) {
          try {
            pid = JSON.parse(
              await readFile(path.join(input.evidenceDir, dir, 'attempt-0', 'persistent.json'), 'utf8'),
            ).pid;
          } catch {
            /* The manifest is written asynchronously after connection. */
          }
        }
        if (pid) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      assert.ok(pid, 'Godot must actually start before cancellation');
      await assert.rejects(executeDevelopmentLoop(input), /already owns/);
      context.cancel();
      const cancelled = await pending;
      assert.equal(cancelled.status, 'FAIL');
      assert.equal(cancelled.cleanup, true);
      assert.equal(cancelled.rolledBack, true);
      assert.equal(cancelled.metrics.retryCount, 0);
      assert.equal(await readFile(path.join(root, 'code.gd'), 'utf8'), 'before');
      assert.throws(() => process.kill(pid!, 0));
      const timed = await executeDevelopmentLoop({ ...input, timeoutMs: 1500 }, undefined, fixtureApproval);
      assert.equal(timed.status, 'FAIL');
      assert.equal(timed.cleanup, true);
      assert.equal(timed.rolledBack, true);
      assert.equal(await readFile(path.join(root, 'code.gd'), 'utf8'), 'before');
    } finally {
      context.cancel();
      context.dispose();
    }
  },
);

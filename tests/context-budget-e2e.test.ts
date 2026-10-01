import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, lstat, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildContextPack } from '../src/context-pack.js';
import { readResponsePage } from '../src/response-budget.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp-server-sdk.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createTimeoutContext } from '../src/timeout.js';
import { createClientPolicy } from '../src/mcp/access-policy.js';

test('anchors select local lexical excerpts, report ambiguity and never infer task semantics', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-context-anchors-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  const lines = [
    'extends Node',
    ...Array.from({ length: 120 }, (_, n) => `# filler ${n}`),
    'func repair_target():',
    '\tpass',
  ];
  await writeFile(path.join(root, 'target.gd'), lines.join('\n'));
  await writeFile(
    path.join(root, 'scene.tscn'),
    '[gd_scene format=3]\n[node name="Root" type="Node"]\n[node name="Same" parent="." type="Node"]\n[node name="Same" parent="Other" type="Node"]\n',
  );
  const pack = await buildContextPack({
    projectPath: root,
    fields: ['snippets'],
    taskIntent: '修复目标函数',
    anchors: [{ file: 'target.gd', kind: 'symbol', name: 'repair_target' }],
  });
  const snippets = pack.snippets as {
    content: string;
    startLine: number;
    anchorLine: number;
    complete: boolean;
    trimmingReason: string;
  }[];
  assert.equal(snippets[0].anchorLine, 122);
  assert.equal(snippets[0].startLine, 114);
  assert.ok(snippets[0].content.includes('func repair_target():'));
  assert.ok(!snippets[0].content.includes('filler 0\n'));
  assert.equal(snippets[0].complete, false);
  assert.equal(snippets[0].trimmingReason, 'anchor-window');
  assert.equal(pack.godot, undefined, 'omitted Godot must not require an executable');
  assert.equal(pack.git, undefined);
  assert.deepEqual(pack.recent_errors, [], 'failure evidence remains mandatory');
  const ambiguous = await buildContextPack({
    projectPath: root,
    fields: ['snippets'],
    anchors: [{ file: 'scene.tscn', kind: 'node', name: 'Same' }],
  });
  assert.equal((ambiguous.selection as { insufficient: boolean }).insufficient, true);
  assert.equal((ambiguous.selection as { anchors: { status: string }[] }).anchors[0].status, 'ambiguous');
  assert.deepEqual(ambiguous.snippets, [], 'ambiguous anchors must not silently return the prefix');
  const missing = await buildContextPack({
    projectPath: root,
    fields: [],
    anchors: [{ file: 'missing.gd', kind: 'symbol', name: 'nope' }],
  });
  assert.equal((missing.selection as { anchors: { status: string }[] }).anchors[0].status, 'missing-file');
  await assert.rejects(
    buildContextPack({
      projectPath: root,
      fields: ['snippets'],
      anchors: [{ file: '../outside.gd', kind: 'symbol', name: 'nope' }],
    }),
    /unsafe/,
  );
  await assert.rejects(buildContextPack({ projectPath: root, fields: ['unknown'] as never }), {
    code: 'INVALID_ARGUMENT',
  });
  await assert.rejects(buildContextPack({ projectPath: root, taskIntent: ' ' }), { code: 'INVALID_ARGUMENT' });
  const timeout = createTimeoutContext(10000);
  timeout.cancel();
  try {
    await assert.rejects(buildContextPack({ projectPath: root, fields: [], timeout }), { code: 'CANCELLED' });
  } finally {
    timeout.dispose();
  }
});

test('SDK and CLI both expose anchors and field selection without requiring Godot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-context-anchors-public-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  await writeFile(path.join(root, 'target.gd'), 'extends Node\nfunc target():\n\tpass\n');
  const anchors = [{ file: 'target.gd', kind: 'symbol', name: 'target' }];
  const server = createMcpServer();
  const client = new Client({ name: 'context-anchors', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const result = await client.callTool({
      name: 'get_context_pack',
      arguments: { projectPath: root, anchors, fields: ['snippets'], taskIntent: 'Inspect target' },
    });
    assert.equal(result.isError, undefined);
    assert.equal(
      ((result.structuredContent as Record<string, unknown>).snippets as { anchorLine: number }[])[0].anchorLine,
      2,
    );
    assert.ok(!Object.hasOwn(result.structuredContent!, 'godot'));
    const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
    const output = await promisify(execFile)(
      process.execPath,
      [
        cli,
        'context-pack',
        '--project',
        root,
        '--anchors',
        JSON.stringify(anchors),
        '--fields',
        '["snippets"]',
        '--task-intent',
        'Inspect target',
      ],
      { windowsHide: true },
    );
    const body = JSON.parse(output.stdout);
    assert.equal(body.snippets[0].anchorLine, 2);
    assert.equal(body.selection.taskIntent, 'Inspect target');
    assert.ok(!Object.hasOwn(body, 'godot'));
  } finally {
    await client.close();
    await server.close();
  }
});

test('long preceding lines cannot push the requested anchor out of the excerpt budget', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-context-long-anchor-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  await writeFile(
    path.join(root, 'target.gd'),
    'extends Node\n# ' + '中文🌏'.repeat(5000) + '\nfunc target():\n\tpass\n',
  );
  const pack = await buildContextPack({
    projectPath: root,
    fields: ['snippets'],
    anchors: [{ file: 'target.gd', kind: 'symbol', name: 'target' }],
  });
  const excerpt = (pack.snippets as { startLine: number; content: string; anchorLine: number }[])[0];
  assert.equal(excerpt.startLine, 3);
  assert.equal(excerpt.anchorLine, 3);
  assert.ok(excerpt.content.startsWith('func target():'));
  assert.ok(Buffer.byteLength(excerpt.content) <= 16384);
});

test('context prioritizes explicit goals, error locations and dependency recency; unavailable tokenizer never promises token limits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-context-order-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  await writeFile(
    path.join(root, 'target.gd'),
    'extends Node\nconst A = preload("res://old.gd")\nconst B = preload("res://new.gd")\n',
  );
  for (const file of ['old.gd', 'new.gd', 'error.gd', 'unrelated.gd'])
    await writeFile(path.join(root, file), 'extends Node\n# 中文🌏\n');
  await utimes(path.join(root, 'old.gd'), new Date('2020-01-01'), new Date('2020-01-01'));
  const pack = await buildContextPack({
    projectPath: root,
    fields: ['snippets'],
    targets: ['target.gd'],
    errorStack: 'at res://error.gd:2\nignore res://../outside.gd:4',
    maxTokens: 1,
  });
  assert.deepEqual((pack.project as { files: string[] }).files, ['target.gd', 'error.gd', 'new.gd', 'old.gd']);
  assert.ok(!JSON.stringify(pack.project).includes('unrelated.gd'));
  const budget = pack.budget as {
    tokenizer: string;
    tokenLimitEnforced: boolean;
    requestedMaxTokens: number;
    estimatedTokens: number;
    tokenEstimateExceedsRequest: boolean;
  };
  assert.equal(budget.tokenizer, 'unavailable');
  assert.equal(budget.tokenLimitEnforced, false);
  assert.equal(budget.requestedMaxTokens, 1);
  assert.equal(budget.tokenEstimateExceedsRequest, true);
  assert.equal(budget.estimatedTokens, Math.ceil(Buffer.byteLength(JSON.stringify(pack)) / 4));
  assert.equal(
    (pack.selection as { insufficient: boolean }).insufficient,
    true,
    'unresolved error locations cannot imply complete context',
  );
  await assert.rejects(buildContextPack({ projectPath: root, maxTokens: 0 }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(buildContextPack({ projectPath: root, errorStack: 'x'.repeat(8193) }), {
    code: 'INVALID_ARGUMENT',
  });
});

test('the same task remains selected and byte-bounded after adding a thousand unrelated files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-context-large-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  await writeFile(path.join(root, 'target.gd'), 'extends Node\nfunc target():\n\tpass\n# ' + '中文🌏'.repeat(4000));
  const options = { projectPath: root, fields: ['snippets'] as const, targets: ['target.gd'], maxBytes: 1024 };
  async function collect() {
    let page = await buildContextPack({ ...options, fields: [...options.fields] });
    const chunks: string[] = [];
    for (;;) {
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1024);
      if (page.encoding !== 'json') return page;
      chunks.push(String(page.chunk));
      const next = page.continuation as { ref: string; cursor: number } | null;
      if (!next) return JSON.parse(chunks.join('')) as Record<string, unknown>;
      page = readResponsePage(next.ref, next.cursor);
    }
  }
  const small = await collect();
  await mkdir(path.join(root, 'unrelated'));
  for (let i = 0; i < 1000; i++)
    await writeFile(path.join(root, 'unrelated', `${i}.gd`), `extends Node\n# unrelated ${i}\n`);
  const large = await collect();
  assert.deepEqual((large.project as { files: string[] }).files, ['target.gd']);
  assert.deepEqual(large.snippets, small.snippets);
  assert.ok(!JSON.stringify(large).includes('unrelated/'));
});

test('official context access cannot cross the caller project permission boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-context-permission-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'wheel-context-outside-'));
  for (const dir of [root, outside]) await writeFile(path.join(dir, 'project.godot'), '[application]\n');
  const policy = createClientPolicy({
    clientId: 'context-reader',
    scopes: ['read'],
    projectRoots: [root],
    evidenceRoots: [root],
  });
  const server = createMcpServer(policy);
  const client = new Client({ name: 'context-reader', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const denied = await client.callTool({ name: 'get_context_pack', arguments: { projectPath: outside, fields: [] } });
    assert.equal(denied.isError, true);
    assert.equal((denied.structuredContent as Record<string, unknown>).code, 'FORBIDDEN');
    const allowed = await client.callTool({
      name: 'get_context_pack',
      arguments: { projectPath: root, fields: [], maxTokens: 1, taskIntent: 'Inspect only this project' },
    });
    assert.equal(allowed.isError, undefined);
    const engineDenied = await client.callTool({
      name: 'get_context_pack',
      arguments: { projectPath: root, fields: ['godot'] },
    });
    assert.equal(engineDenied.isError, true);
    assert.equal((engineDenied.structuredContent as Record<string, unknown>).code, 'FORBIDDEN');
    assert.equal(
      ((allowed.structuredContent as Record<string, unknown>).budget as Record<string, unknown>).tokenLimitEnforced,
      false,
    );
  } finally {
    await client.close();
    await server.close();
  }
});

test('task context enforces UTF-8 JSON bytes and does not return unrelated project inventory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-context-budget-'));
  await writeFile(
    path.join(root, 'project.godot'),
    '[application]\nconfig/name="预算测试"\nrun/main_scene="res://main.tscn"\n',
  );
  await writeFile(path.join(root, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node"]\n');
  await writeFile(path.join(root, 'target.gd'), 'extends Node\n# ' + '中文预算🌏'.repeat(2000));
  await writeFile(path.join(root, 'unrelated.gd'), 'extends Node\n# unrelated-private-context');
  const options = { projectPath: root, godotPath: process.env.GODOT_PATH, targets: ['target.gd'], maxBytes: 1024 };
  const result = (await buildContextPack(options)) as unknown as Record<string, unknown>;
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 1024, 'context exceeded its requested byte budget');
  const chunks: string[] = [];
  let page = result;
  if (typeof page.chunk === 'string') {
    for (;;) {
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1024, 'continuation exceeded context budget');
      chunks.push(String(page.chunk));
      const next = page.continuation as { ref: string; cursor: number } | null;
      if (!next) break;
      page = readResponsePage(next.ref, next.cursor);
    }
  }
  const whole = chunks.length ? JSON.parse(chunks.join('')) : result;
  assert.ok(!JSON.stringify(whole).includes('unrelated.gd'));
  assert.ok(!JSON.stringify(whole).includes('unrelated-private-context'));
  assert.notEqual(whole.active_run, null, 'null must not imply that no actual run exists');
});
test('missing evidence directory is explicit absence, without creating it or failing context', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-context-no-logs-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  const evidenceDir = path.join(root, 'not-created');
  const pack = await buildContextPack({ projectPath: root, godotPath: process.env.GODOT_PATH, evidenceDir });
  assert.deepEqual(pack.recent_errors, []);
  assert.ok((pack.errorSegments as { status: string }[]).every((segment) => segment.status === 'missing'));
  await assert.rejects(lstat(evidenceDir), { code: 'ENOENT' });
});
test('non-file log candidates are refused rather than treated as missing evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-context-invalid-log-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  await mkdir(path.join(root, 'stderr.log'));
  await assert.rejects(buildContextPack({ projectPath: root, godotPath: process.env.GODOT_PATH, evidenceDir: root }), {
    code: 'FORBIDDEN',
  });
});

test('missing targets are insufficient context; cyclic dependencies and large logs stay bounded', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-context-cycle-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  await writeFile(path.join(root, 'a.gd'), 'extends Node\nconst OTHER = preload("res://b.gd")\n');
  await writeFile(path.join(root, 'b.gd'), 'extends Node\nconst OTHER = preload("res://a.gd")\n');
  await writeFile(path.join(root, 'stderr.log'), '错误证据🌏'.repeat(100000));
  const options = {
    projectPath: root,
    godotPath: process.env.GODOT_PATH,
    targets: ['a.gd'],
    dependencyDepth: 8,
    evidenceDir: root,
    maxErrorBytes: 1001,
  };
  const pack = await buildContextPack(options);
  assert.deepEqual((pack.project as { files: string[] }).files, ['a.gd', 'b.gd']);
  assert.ok((pack.recent_errors as string[]).reduce((sum, value) => sum + Buffer.byteLength(value), 0) <= 1001);
  assert.equal((pack.errorSegments as { status: string }[])[0].status, 'partial');
  const missing = await buildContextPack({ ...options, targets: ['missing.gd'], evidenceDir: undefined });
  assert.equal((missing.selection as { insufficient: boolean }).insufficient, true);
  assert.deepEqual((missing.project as { files: string[] }).files, []);
  await assert.rejects(buildContextPack({ ...options, targets: ['../outside.gd'] }), /unsafe/);
  await assert.rejects(buildContextPack({ ...options, maxBytes: 100 }), { code: 'INVALID_ARGUMENT' });
});

test('official SDK exposes context budget/target inputs and every continuation respects the same limit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-context-sdk-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  await writeFile(path.join(root, 'target.gd'), 'extends Node\n# ' + '预算🌏'.repeat(10000));
  const server = createMcpServer();
  const client = new Client({ name: 'context-budget', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    let result = await client.callTool({
      name: 'get_context_pack',
      arguments: { projectPath: root, godotPath: process.env.GODOT_PATH, targets: ['target.gd'], maxBytes: 1024 },
    });
    assert.equal(result.isError, undefined);
    const chunks: string[] = [];
    for (;;) {
      const body = result.structuredContent as Record<string, unknown>;
      assert.ok(Buffer.byteLength(JSON.stringify(body)) <= 1024);
      assert.equal(typeof body.chunk, 'string');
      chunks.push(String(body.chunk));
      const next = body.continuation;
      if (!next) break;
      result = await client.callTool({ name: 'get_response_page', arguments: next as Record<string, unknown> });
      assert.equal(result.isError, undefined);
    }
    const whole = JSON.parse(chunks.join(''));
    assert.deepEqual(whole.project.files, ['target.gd']);
    assert.equal(whole.snippets[0].complete, false);
    assert.equal(whole.snippets[0].trimmingReason, 'snippet-byte-budget');
  } finally {
    await client.close();
    await server.close();
  }
});

test('CLI returns compact bounded context and refuses unusable one-shot continuation references', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-context-cli-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  await writeFile(path.join(root, 'target.gd'), 'extends Node\n');
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const args = [
    cli,
    'context-pack',
    '--project',
    root,
    '--godot',
    process.env.GODOT_PATH!,
    '--targets',
    '["target.gd"]',
  ];
  const normal = await promisify(execFile)(process.execPath, [...args, '--max-bytes', '32768'], { windowsHide: true });
  assert.deepEqual(JSON.parse(normal.stdout).project.files, ['target.gd']);
  assert.ok(Buffer.byteLength(normal.stdout.trim()) <= 32768);
  await writeFile(path.join(root, 'target.gd'), 'extends Node\n# ' + '中文🌏'.repeat(10000));
  await assert.rejects(
    promisify(execFile)(process.execPath, [...args, '--max-bytes', '1024'], { windowsHide: true }),
    (error) => {
      const stderr = (error as { stderr: string }).stderr;
      assert.equal(JSON.parse(stderr).code, 'UNSUPPORTED');
      assert.ok(!stderr.includes('"continuation"'));
      return true;
    },
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from 'node:http';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../src/mcp-server-sdk.js';
import { createProjectApproval } from '../src/mcp/project-approval.js';
import { createPreapprovedWriteVerifier } from '../src/mcp/preapproved-writes.js';
import { ProjectTransactions, type TransactionPlan } from '../src/project/transactions.js';
import { startStreamableHttpServer, type StreamableHttpConfig } from '../src/transports/streamable-http.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const intent = 'ENGINE: isolated correct-res:// candidate import/parse/load; no gameplay or render guarantee';

async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'wheel-preapproved-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const project = path.join(base, 'project');
  await mkdir(project);
  const root = await realpath(project);
  await writeFile(path.join(root, 'main.gd'), 'extends Node\n');
  const files = [
    { path: 'main.gd', beforeSha256: sha('extends Node\n'), afterSha256: sha('extends Node\n# exact\n') },
    { path: 'new.gd', beforeSha256: null, afterSha256: sha('extends Node3D\n') },
  ];
  const manifest = {
    version: 1,
    grantId: 'local-test-grant',
    projectPath: root,
    operations: [{ operationId: 'exact-op', files }],
  };
  const manifestPath = path.join(base, 'preapproved.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  const plan: TransactionPlan = {
    intent: intent + '\nPREVIEW PROJECT SHA-256: ' + sha('project'),
    operationId: 'exact-op',
    projectPath: root,
    ownerId: 'stdio-local',
    planHash: sha('actual transaction'),
    changes: files.map((file) => ({ ...file, beforeBytes: 0, afterBytes: 14 })),
    impact: files.map((file) => file.path),
    diffPreview: '',
    diffPreviewTruncated: false,
  };
  return { root, base, manifestPath, manifest, plan };
}

test('exact preapproval binds actual planHash, has a local receipt, and compares all files independent of order', async (t) => {
  const f = await fixture(t);
  const verify = createPreapprovedWriteVerifier({ manifestPath: f.manifestPath }, 'stdio-local');
  const approval = await verify({ ...f.plan, changes: [...f.plan.changes].reverse(), diffPreviewTruncated: true });
  assert.equal(approval?.planHash, f.plan.planHash);
  assert.equal(approval?.actor, 'preapproved-local:stdio-local');
  assert.equal(approval?.receipt, 'preapproved-local:local-test-grant:exact-op');
  assert.doesNotMatch(approval!.receipt, /human|elicitation/);
  assert.equal(
    (await verify({ ...f.plan, planHash: sha('another actual binding') }))?.planHash,
    sha('another actual binding'),
  );
});

test('hash, path, operation, root, count, deletion and raw tampering fail closed', async (t) => {
  const f = await fixture(t);
  const verify = createPreapprovedWriteVerifier({ manifestPath: f.manifestPath }, 'stdio-local');
  const change = (values: Partial<TransactionPlan['changes'][number]>) => [
    { ...f.plan.changes[0], ...values },
    f.plan.changes[1],
  ];
  const attempts: Partial<TransactionPlan>[] = [
    { changes: change({ beforeSha256: sha('wrong before') }) },
    { changes: change({ afterSha256: sha('wrong after') }) },
    { changes: change({ path: 'other.gd' }) },
    { changes: change({ path: '../main.gd' }) },
    { changes: change({ path: 'res://main.gd' }) },
    { changes: change({ path: 'main\\gd' }) },
    { changes: change({ path: '.harness/main.gd' }) },
    { changes: change({ afterSha256: null }) },
    { operationId: 'ungranted-op' },
    { projectPath: f.base },
    { projectPath: path.join(f.base, 'missing') },
    { changes: [f.plan.changes[0]] },
    { changes: [...f.plan.changes, { ...f.plan.changes[1], path: 'extra.gd' }] },
    { changes: [f.plan.changes[0], f.plan.changes[0]] },
    { intent: 'RAW TEXT: validation NOT_RUN; may break project; exact risk approval required' },
    { intent: 'godot-validation:' + sha('legacy validation') },
    { intent: undefined },
    { intent: 'ENGINE: spoofed' },
    { planHash: 'invalid' },
  ];
  for (const attempt of attempts) await assert.rejects(verify({ ...f.plan, ...attempt }), { code: 'FORBIDDEN' });
});

test('unsafe, duplicate, malformed, inside-project or deleted-file manifests are rejected at startup', async (t) => {
  const f = await fixture(t);
  const invalid = [
    { ...f.manifest, version: 2 },
    { ...f.manifest, projectPath: 'relative-project' },
    { ...f.manifest, extra: 'unknown' },
    { ...f.manifest, operations: [...f.manifest.operations, f.manifest.operations[0]] },
    {
      ...f.manifest,
      operations: [
        { operationId: 'exact-op', files: [{ ...f.manifest.operations[0].files[0], path: '../escape.gd' }] },
      ],
    },
    {
      ...f.manifest,
      operations: [{ operationId: 'exact-op', files: [{ ...f.manifest.operations[0].files[0], afterSha256: null }] }],
    },
    {
      ...f.manifest,
      operations: [
        { operationId: 'exact-op', files: [f.manifest.operations[0].files[0], f.manifest.operations[0].files[0]] },
      ],
    },
  ];
  for (const manifest of invalid) {
    await writeFile(f.manifestPath, JSON.stringify(manifest));
    assert.throws(() => createPreapprovedWriteVerifier({ manifestPath: f.manifestPath }, 'stdio-local'), {
      code: 'FORBIDDEN',
    });
  }
  const inside = path.join(f.root, 'grant.json');
  await writeFile(inside, JSON.stringify(f.manifest));
  assert.throws(() => createPreapprovedWriteVerifier({ manifestPath: inside }, 'stdio-local'), { code: 'FORBIDDEN' });
  assert.throws(() => createPreapprovedWriteVerifier({ manifestPath: 'relative.json' }, 'stdio-local'), {
    code: 'FORBIDDEN',
  });
});

test('a running verifier does not inherit later manifest extensions and cancellation remains intact', async (t) => {
  const f = await fixture(t);
  const verify = createPreapprovedWriteVerifier({ manifestPath: f.manifestPath }, 'stdio-local');
  await writeFile(
    f.manifestPath,
    JSON.stringify({ ...f.manifest, operations: [{ ...f.manifest.operations[0], operationId: 'added-op' }] }),
  );
  await assert.rejects(verify({ ...f.plan, operationId: 'added-op' }), { code: 'FORBIDDEN' });
  assert.ok(await verify(f.plan));
  const controller = new AbortController();
  const reason = new Error('host cancellation');
  controller.abort(reason);
  await assert.rejects(verify(f.plan, controller.signal), (error) => error === reason);
});

test('transaction approval persists a distinct local receipt and retains CAS protection', async (t) => {
  const f = await fixture(t);
  const tx = new ProjectTransactions({
    projectPath: f.root,
    ownerId: 'stdio-local',
    intent,
    verifyApproval: createPreapprovedWriteVerifier({ manifestPath: f.manifestPath }, 'stdio-local'),
  });
  const plan = await tx.prepare(
    [
      { kind: 'replace', path: 'main.gd', expectedSha256: sha('extends Node\n'), content: 'extends Node\n# exact\n' },
      { kind: 'create', path: 'new.gd', content: 'extends Node3D\n' },
    ],
    'exact-op',
  );
  const approval = await tx.approve(plan.operationId);
  assert.equal(approval.planHash, plan.planHash);
  assert.match(approval.receipt, /^preapproved-local:/);
  await writeFile(path.join(f.root, 'main.gd'), 'external edit\n');
  await assert.rejects(
    tx.apply(plan.operationId, async () => true),
    /changed|hash|conflict/i,
  );
});

test('default factory and approval ignore stdio environment grants and preserve real elicitation', async (t) => {
  const f = await fixture(t);
  const old = process.env.MCP_STDIO_PREAPPROVED_WRITES;
  process.env.MCP_STDIO_PREAPPROVED_WRITES = path.join(f.base, 'does-not-exist.json');
  const server = createMcpServer();
  const client = new Client(
    { name: 'preapproval-default-test', version: '1' },
    { capabilities: { elicitation: { form: {} } } },
  );
  let confirmations = 0;
  client.setRequestHandler(ElicitRequestSchema, async () => {
    confirmations++;
    return { action: 'accept', content: { confirm: true } };
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const approval = await createProjectApproval(server, 'local-client')(f.plan);
    assert.equal(confirmations, 1);
    assert.match(approval!.receipt, /^elicitation:/);
    assert.equal(approval!.actor, 'local-client');
  } finally {
    if (old === undefined) delete process.env.MCP_STDIO_PREAPPROVED_WRITES;
    else process.env.MCP_STDIO_PREAPPROVED_WRITES = old;
    await client.close();
    await server.close();
  }
});

test('MCP configured manifest is never bypassed by raw writes or tool-supplied approval settings', async (t) => {
  const f = await fixture(t);
  const server = createMcpServer(undefined, { preapprovedWrites: { manifestPath: f.manifestPath } });
  const client = new Client({ name: 'preapproval-wire-test', version: '1' }, { capabilities: {} });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const result = await client.callTool({
      name: 'write_project_file',
      arguments: {
        projectPath: f.root,
        filePath: 'main.gd',
        content: 'extends Node\n# exact\n',
        operationId: 'exact-op',
        expectedSha256: sha('extends Node\n'),
        validationMode: 'raw',
        approved: true,
        preapprovedWrites: { manifestPath: f.manifestPath },
      },
    });
    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as { code: string }).code, 'FORBIDDEN');
  } finally {
    await client.close();
    await server.close();
  }
});

test('only the real stdio entrypoint loads the trusted environment manifest', async (t) => {
  const f = await fixture(t);
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('build/src/mcp-server-sdk.js')],
    cwd: f.root,
    stderr: 'pipe',
    env: {
      ...env,
      MCP_TOOL_PROFILE: 'all',
      MCP_STDIO_SCOPES: 'read,write',
      MCP_STDIO_PROJECT_ROOTS: f.root,
      MCP_STDIO_EVIDENCE_ROOTS: f.root,
      MCP_STDIO_PREAPPROVED_WRITES: f.manifestPath,
    },
  });
  const client = new Client({ name: 'preapproved-stdio-entry', version: '1' }, { capabilities: {} });
  try {
    await client.connect(transport);
    assert.ok((await client.listTools()).tools.some((tool) => tool.name === 'write_project_file'));
    const result = await client.callTool({
      name: 'write_project_file',
      arguments: {
        projectPath: f.root,
        filePath: 'main.gd',
        content: 'extends Node\n# exact\n',
        operationId: 'exact-op',
        expectedSha256: sha('extends Node\n'),
        validationMode: 'raw',
      },
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /only engine-validated writes may use this grant/);
  } finally {
    await client.close();
    await transport.close();
  }
});

test('HTTP server factory does not inherit a stdio manifest from its environment', async (t) => {
  const f = await fixture(t);
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => reservation.close((error) => (error ? reject(error) : resolve())));
  const config: StreamableHttpConfig = {
    host: '127.0.0.1',
    port,
    path: '/mcp',
    allowedOrigins: [`http://127.0.0.1:${port}`],
    allowedHosts: [`127.0.0.1:${port}`],
    requestTimeoutMs: 5000,
    shutdownTimeoutMs: 1000,
    clients: [
      {
        token: 'local-http-test',
        clientId: 'http-local',
        scopes: ['read'],
        projectRoots: [f.root],
        evidenceRoots: [f.root],
      },
    ],
    rateLimitWindowMs: 50,
    rateLimitMaxRequests: 100,
    rateLimitMaxRequestsPerClient: 100,
    maxConcurrentRequests: 10,
    maxConcurrentRequestsPerClient: 10,
  };
  const old = process.env.MCP_STDIO_PREAPPROVED_WRITES;
  process.env.MCP_STDIO_PREAPPROVED_WRITES = path.join(f.base, 'invalid-http-env.json');
  const instance = await startStreamableHttpServer(config, createMcpServer);
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: 'Bearer local-http-test', Origin: config.allowedOrigins[0] } },
  });
  const client = new Client({ name: 'http-no-stdio-grant', version: '1' }, { capabilities: {} });
  try {
    await client.connect(transport);
    assert.ok((await client.listTools()).tools.some((tool) => tool.name === 'read_project_file'));
  } finally {
    if (old === undefined) delete process.env.MCP_STDIO_PREAPPROVED_WRITES;
    else process.env.MCP_STDIO_PREAPPROVED_WRITES = old;
    await client.close();
    await transport.close();
    await instance.close();
  }
});

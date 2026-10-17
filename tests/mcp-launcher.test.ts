import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, writeFile, readFile, rm, realpath, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixtureStdioEnv } from './helpers/stdio-fixture.js';

// Engine-free launcher contracts. Node --version is an explicit executable TEST
// DOUBLE here; no game, renderer or human client acceptance is claimed.
async function fixture() {
  const parent = await realpath(os.tmpdir());
  const root = await realpath(await mkdtemp(path.join(parent, 'wheel-launcher-')));
  await mkdir(path.join(root, 'scripts/lib'), { recursive: true });
  await mkdir(path.join(root, 'build/src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="Launcher fixture"\n');
  for (const file of ['run-mcp.mjs', 'lib/project-root.mjs', 'lib/godot-discovery.mjs', 'lib/platform-paths.mjs'])
    await cp(path.join('scripts', file), path.join(root, 'scripts', file));
  return {
    root,
    entry: path.join(root, 'build/src/mcp-server-sdk.js'),
    launcher: path.join(root, 'scripts/run-mcp.mjs'),
    env: fixtureStdioEnv({
      GODOT_PATH: process.execPath,
      GODOT_HARNESS_RUN_REGISTRY_PATH: path.join(root, '.harness/registry.json'),
      MCP_STDIO_PROJECT_ROOTS: root,
      MCP_STDIO_EVIDENCE_ROOTS: root,
      MCP_STDIO_SCOPES: 'read',
    }),
    async cleanup() {
      const exact = await realpath(root);
      assert.equal(path.dirname(exact), parent);
      assert.match(path.basename(exact), /^wheel-launcher-[A-Za-z0-9]+$/);
      assert.equal((await lstat(root)).isSymbolicLink(), false);
      await rm(exact, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
    },
  };
}

const entrySource = (revision: string, exitCode?: number) => `
import {pathToFileURL} from 'node:url';
export async function startStdioServer() {
  console.log(JSON.stringify({pid:process.pid,revision:${JSON.stringify(revision)}}));
  ${exitCode === undefined ? "process.stdin.resume(); process.stdin.once('end',()=>process.exit(0));" : `process.exit(${exitCode});`}
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) await startStdioServer();
`;

function launch(f: Awaited<ReturnType<typeof fixture>>) {
  const result = spawnSync(process.execPath, [f.launcher], {
    cwd: os.tmpdir(),
    input: '', // Actual stdin EOF, not SIGTERM masquerading as graceful close.
    env: { ...f.env, SystemRoot: process.env.SystemRoot, PATH: process.env.PATH },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 65536,
  });
  assert.equal(result.error, undefined, String(result.error) + result.stderr);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

test('configured launcher runs the server in the client-owned PID and exits cleanly on stdin EOF', async () => {
  const f = await fixture();
  try {
    await writeFile(f.entry, entrySource('prebuilt'));
    const result = launch(f);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { pid: result.pid, revision: 'prebuilt' });
    assert.equal(result.stderr, '');
  } finally {
    await f.cleanup();
  }
});

test('missing runtime fails with stderr-only guidance and never executes setup or a compiler', async () => {
  const f = await fixture();
  try {
    await writeFile(
      path.join(f.root, 'scripts/setup.mjs'),
      `
      import {writeFile} from 'node:fs/promises';
      console.log('fixture compiler must not execute');
      await writeFile('build/src/mcp-server-sdk.js', ${JSON.stringify(entrySource('unexpected-build'))});
    `,
    );
    const result = launch(f);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /runtime is missing/);
    assert.match(result.stderr, /npm run build/);
    assert.doesNotMatch(result.stderr, /fixture compiler/);
    await assert.rejects(readFile(f.entry), { code: 'ENOENT' });
  } finally {
    await f.cleanup();
  }
});

test('an incompatible old build gives an actionable rebuild/reinstall error without protocol output', async () => {
  const f = await fixture();
  try {
    await writeFile(f.entry, 'export const oldRuntime = true;');
    const result = launch(f);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /incompatible with this launcher/);
    assert.match(result.stderr, /Reinstall the prebuilt package/);
  } finally {
    await f.cleanup();
  }
});

test('abnormal server exit propagates; the next launch reads replaced entry bytes without an old server process', async () => {
  const f = await fixture();
  try {
    await writeFile(f.entry, entrySource('before-update', 23));
    const first = launch(f);
    assert.equal(first.status, 23);
    assert.deepEqual(JSON.parse(first.stdout), { pid: first.pid, revision: 'before-update' });
    await writeFile(f.entry, entrySource('after-update'));
    const next = launch(f);
    assert.equal(next.status, 0, next.stderr);
    assert.deepEqual(JSON.parse(next.stdout), { pid: next.pid, revision: 'after-update' });
  } finally {
    await f.cleanup();
  }
});

test(
  'actual SDK discovery/read/close/reconnect uses the configured launcher and rejects stale resource identity',
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    const module = pathToFileURL(path.resolve('build/src/mcp-server-sdk.js')).href;
    // Reuse compiled implementation without copying dependencies or loading the
    // real checkout .env; all writable state belongs to this isolated fixture.
    await writeFile(f.entry, `export { startStdioServer } from ${JSON.stringify(module)};`);
    const connect = async () => {
      const client = new Client({ name: 'launcher-sdk-fixture', version: '1' });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [f.launcher],
        env: f.env,
        stderr: 'pipe',
      });
      let errors = '';
      transport.stderr?.on('data', (chunk) => {
        errors = (errors + String(chunk)).slice(-2048);
      });
      try {
        await client.connect(transport);
        return { client, errors: () => errors };
      } catch (error) {
        await client.close();
        throw new Error(String(error) + errors, { cause: error });
      }
    };
    try {
      const first = await connect();
      let oldUri: string;
      try {
        assert.equal(first.client.getServerVersion()?.name, 'wheel-mcp');
        assert.equal((await first.client.listTools()).tools.length, 71);
        oldUri = (await first.client.listResources()).resources[0].uri;
        const metadata = await first.client.callTool({ name: 'get_project_info', arguments: { projectPath: f.root } });
        assert.notEqual(metadata.isError, true);
        assert.equal(first.errors(), '');
      } finally {
        await first.client.close();
      }
      const second = await connect();
      try {
        await assert.rejects(second.client.readResource({ uri: oldUri }));
        const resource = (await second.client.listResources()).resources[0];
        assert.notEqual(resource.uri, oldUri);
        assert.ok((await second.client.readResource({ uri: resource.uri })).contents.length > 0);
        assert.equal(second.errors(), '');
      } finally {
        await second.client.close();
      }
    } finally {
      await f.cleanup();
    }
  },
);

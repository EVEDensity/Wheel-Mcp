import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath, lstat, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('package lifecycle is build-before-pack and has no consumer install side effects', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.scripts.prepack, 'npm run build');
  for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) assert.equal(pkg.scripts[name], undefined);
  assert.ok(Array.isArray(pkg.files) && pkg.files.length > 0);
  assert.equal(pkg.dependencies.zod, '3.25.76', 'runtime Zod imports must not depend on SDK transitive hoisting');
  assert.ok(!pkg.files.some((file: string) => /^(docs|vendor|tests|examples|runs)(\/|$)/.test(file)));
});

test(
  'real tarball installs with locked production dependencies and starts the isolated read-only MCP',
  { timeout: 90000 },
  async () => {
    const parent = await realpath(os.tmpdir());
    const root = await mkdtemp(path.join(parent, 'wheel-package-'));
    const npmCli = [
      process.env.npm_execpath,
      path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
      path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
    ].find((file) => file && existsSync(file));
    assert.ok(npmCli, 'npm CLI is required; do not skip real package installation');
    const env: NodeJS.ProcessEnv = { ...process.env, npm_config_logs_max: '0', npm_config_update_notifier: 'false' };
    delete env.NODE_TEST_CONTEXT;
    delete env.MCP_STDIO_PREAPPROVED_WRITES;
    const runNpm = (args: string[], cwd: string) => {
      const result = spawnSync(process.execPath, [npmCli, ...args], {
        cwd,
        env,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, 0, (result.stderr || result.stdout).slice(-8000));
      return result.stdout;
    };
    let client: Client | undefined;
    let transport: StdioClientTransport | undefined;
    try {
      // The test runner already built the source. Do not build into the live
      // checkout a second time while tests are running.
      const [pack] = JSON.parse(
        runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', root], process.cwd()),
      );
      const names = new Set<string>(pack.files.map((file: { path: string }) => file.path));
      for (const file of [
        'build/src/cli.js',
        'build/src/mcp-server-sdk.js',
        'build/src/mcp-http-server.js',
        'godot-plugin/runtime_bridge.gd',
        'godot-plugin/addons/wheel_mcp/plugin.cfg',
        'scripts/setup.mjs',
        'scripts/lib/codex-config.mjs',
        'LICENSE',
        'THIRD-PARTY-NOTICES.md',
      ])
        assert.ok(names.has(file), file);
      for (const file of names) {
        assert.doesNotMatch(file, /^(src|tests|build\/tests|docs|vendor|examples|runs|node_modules)\//);
        assert.doesNotMatch(file, /(^|\/)(\.env(?:\..*)?|\.harness|\.cursor|\.mcp\.json)(\/|$)/);
        assert.doesNotMatch(file, /\.(mp4|webp|png|log)$/);
      }
      const consumer = path.join(root, 'consumer');
      const fixture = path.join(root, 'project');
      await mkdir(consumer);
      await mkdir(fixture);
      const tarballSpec = `file:${path.join(root, pack.filename).replaceAll('\\', '/')}`;
      const consumerPackage = {
        name: 'wheel-package-fixture',
        private: true,
        version: '1.0.0',
        dependencies: { 'wheel-mcp': tarballSpec },
      };
      await writeFile(path.join(consumer, 'package.json'), JSON.stringify(consumerPackage));
      // Freeze registry dependency resolution, not the artifact under test.
      // This test installs the real tarball with normal lifecycle handling;
      // it is not a network availability or independent clean-machine test.
      const sourceLock = JSON.parse(await readFile('package-lock.json', 'utf8'));
      const sourcePackage = JSON.parse(await readFile('package.json', 'utf8'));
      const packages = { ...sourceLock.packages };
      packages[''] = consumerPackage;
      packages['node_modules/wheel-mcp'] = {
        version: sourcePackage.version,
        resolved: tarballSpec,
        integrity: pack.integrity,
        license: sourcePackage.license,
        dependencies: sourcePackage.dependencies,
        bin: sourcePackage.bin,
        engines: sourcePackage.engines,
        hasInstallScript: ['preinstall', 'install', 'postinstall'].some((name) => sourcePackage.scripts[name]),
      };
      await writeFile(
        path.join(consumer, 'package-lock.json'),
        JSON.stringify({
          name: consumerPackage.name,
          version: consumerPackage.version,
          lockfileVersion: 3,
          requires: true,
          packages,
        }),
      );
      await writeFile(path.join(fixture, 'project.godot'), '[application]\nconfig/name="Packed MCP fixture"\n');
      // Do not ignore lifecycle scripts: this is the regression for a
      // production-only dependency installation without a compiler.
      runNpm(['ci', '--offline', '--omit=dev', '--no-audit', '--no-fund'], consumer);
      const installed = path.join(consumer, 'node_modules/wheel-mcp');
      assert.equal(existsSync(path.join(installed, 'node_modules/typescript')), false);
      assert.equal(existsSync(path.join(consumer, 'node_modules/typescript')), false);
      for (const folder of [consumer, installed]) {
        for (const name of ['.env', '.mcp.json', '.cursor', '.vscode'])
          assert.equal(existsSync(path.join(folder, name)), false);
      }
      const setup = spawnSync(process.execPath, ['scripts/setup.mjs', '--build-only'], {
        cwd: installed,
        env,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000,
      });
      assert.equal(setup.status, 0, setup.stderr);
      assert.equal(existsSync(path.join(installed, '.env')), false);
      assert.equal(existsSync(path.join(installed, '.cursor')), false);
      transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(installed, 'build/src/mcp-server-sdk.js')],
        cwd: fixture,
        env: {
          ...env,
          MCP_STDIO_SCOPES: 'read',
          MCP_STDIO_PROJECT_ROOTS: fixture,
          MCP_STDIO_EVIDENCE_ROOTS: fixture,
          GODOT_HARNESS_RUN_REGISTRY_PATH: path.join(root, 'registry.json'),
        },
        stderr: 'pipe',
      });
      client = new Client({ name: 'real-package-test', version: '1.0.0' });
      await client.connect(transport, { timeout: 10000 });
      const tools = await client.listTools({}, { timeout: 10000 });
      assert.ok(tools.tools.some((tool) => tool.name === 'get_project_info'));
      const result = await client.callTool(
        { name: 'get_project_info', arguments: { projectPath: fixture } },
        undefined,
        { timeout: 10000 },
      );
      assert.notEqual(result.isError, true, JSON.stringify(result));
      // Each emitted relative module import must resolve in the actual package,
      // not accidentally to the developer's source or devDependencies.
      const walk = async (dir: string): Promise<string[]> =>
        (
          await Promise.all(
            (await readdir(dir, { withFileTypes: true })).map(async (entry) => {
              const file = path.join(dir, entry.name);
              return entry.isDirectory() ? walk(file) : [file];
            }),
          )
        ).flat();
      for (const file of await walk(path.join(installed, 'build/src'))) {
        const text = await readFile(file, 'utf8');
        for (const [, specifier] of text.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g))
          assert.ok(existsSync(path.resolve(path.dirname(file), specifier)), `missing package import ${specifier}`);
      }
    } finally {
      await client?.close();
      await transport?.close();
      const exact = await realpath(root);
      assert.equal(path.dirname(exact), parent);
      assert.match(path.basename(exact), /^wheel-package-[A-Za-z0-9]+$/);
      assert.equal((await lstat(root)).isSymbolicLink(), false);
      await rm(exact, { recursive: true });
    }
  },
);

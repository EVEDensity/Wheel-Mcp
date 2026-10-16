import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, stat, mkdir, writeFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSetupFixture } from './helpers/setup-fixture.js';

function runInstall(root: string, extraArgs: string[] = []) {
  return spawnSync(process.execPath, ['scripts/install.mjs', ...extraArgs], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env },
  });
}

test('forced JSON setup preserves restricted environment and unrelated fields with an exact backup', async () => {
  const root = await createSetupFixture();
  const folder = path.join(root, '.cursor');
  await mkdir(folder);
  const file = path.join(folder, 'mcp.json');
  const env = {
    MCP_STDIO_SCOPES: 'read',
    MCP_STDIO_PROJECT_ROOTS: 'D:/trusted-game',
    MCP_STDIO_EVIDENCE_ROOTS: 'D:/evidence',
  };
  const original =
    JSON.stringify(
      {
        mcpServers: {
          'wheel-mcp': { command: 'old-node', args: ['old.js'], env, disabled: true },
          other: { command: 'untouched' },
        },
      },
      null,
      4,
    ) + '\n';
  await writeFile(file, original);
  const result = runInstall(root, ['--skip-npm']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const after = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(after.mcpServers['wheel-mcp'].env, env);
  assert.equal(after.mcpServers['wheel-mcp'].disabled, true);
  assert.deepEqual(after.mcpServers.other, { command: 'untouched' });
  assert.notEqual(after.mcpServers['wheel-mcp'].command, 'old-node');
  const backups = (await readdir(folder)).filter(
    (name) => name.startsWith('mcp.json.wheel-mcp-') && name.endsWith('.bak'),
  );
  assert.equal(backups.length, 1);
  assert.equal(await readFile(path.join(folder, backups[0]), 'utf8'), original);
});

test('setup does not overwrite malformed JSON host configuration even with force', async () => {
  const root = await createSetupFixture();
  const inputs = {
    '.cursor/mcp.json': '{"mcpServers":[]}',
    '.vscode/mcp.json': 'null',
    '.mcp.json': '{"mcpServers":{"wheel-mcp":{"env":"invalid"}}}',
  };
  for (const [name, text] of Object.entries(inputs)) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  const result = runInstall(root, ['--skip-npm']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /leaving file unchanged/);
  for (const [name, text] of Object.entries(inputs)) assert.equal(await readFile(path.join(root, name), 'utf8'), text);
});

test('install smoke: node scripts/install.mjs writes project MCP configs', async () => {
  const root = await createSetupFixture();
  const compiled = path.resolve('build/src/persistent-runtime-bridge.js');
  const before = (await stat(compiled)).mtimeMs;
  const result = runInstall(root, ['--skip-npm']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Wheel-mcp 一键安装/);
  assert.match(result.stdout, /wheel-mcp/);
  assert.match(result.stdout, /\.cursor\/mcp\.json/);
  assert.match(result.stdout, /\.vscode\/mcp\.json/);
  assert.match(result.stdout, /\.mcp\.json/);

  for (const relativePath of ['.cursor/mcp.json', '.vscode/mcp.json', '.mcp.json']) {
    const configPath = path.join(root, ...relativePath.split('/'));
    await access(configPath, constants.R_OK);
    const raw = await readFile(configPath, 'utf8');
    assert.match(raw, /"wheel-mcp"/);
    assert.match(raw, /scripts\/run-mcp\.mjs/);
  }
  assert.equal((await stat(compiled)).mtimeMs, before, 'install smoke must not rebuild the live workspace');
});

test('install smoke: npm run go delegates to install.mjs', async () => {
  const root = await createSetupFixture();
  const env = { ...process.env };
  const result =
    process.platform === 'win32'
      ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run go -- --skip-npm'], {
          cwd: root,
          encoding: 'utf8',
          env,
        })
      : spawnSync('npm', ['run', 'go', '--', '--skip-npm'], {
          cwd: root,
          encoding: 'utf8',
          env,
        });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Wheel-mcp 一键安装/);
});

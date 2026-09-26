import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
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

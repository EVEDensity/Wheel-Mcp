import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function runInstall(extraArgs: string[] = []) {
  return spawnSync(process.execPath, ['scripts/install.mjs', ...extraArgs], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, GODOT_PATH: process.env.GODOT_PATH ?? 'E:/AI/Godot_v4.7.2-stable_win64_console.exe' },
  });
}

test('install smoke: node scripts/install.mjs writes project MCP configs', async () => {
  const result = runInstall(['--skip-npm']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Wheel-mcp 一键安装/);
  assert.match(result.stdout, /wheel-mcp/);
  assert.match(result.stdout, /\.cursor\/mcp\.json/);
  assert.match(result.stdout, /\.vscode\/mcp\.json/);
  assert.match(result.stdout, /\.mcp\.json/);

  for (const relativePath of ['.cursor/mcp.json', '.vscode/mcp.json', '.mcp.json']) {
    const configPath = path.join(process.cwd(), ...relativePath.split('/'));
    await access(configPath, constants.R_OK);
    const raw = await readFile(configPath, 'utf8');
    assert.match(raw, /"wheel-mcp"/);
    assert.match(raw, /scripts\/run-mcp\.mjs/);
  }
});

test('install smoke: npm run go delegates to install.mjs', () => {
  const env = {
    ...process.env,
    GODOT_PATH: process.env.GODOT_PATH ?? 'E:/AI/Godot_v4.7.2-stable_win64_console.exe',
  };
  const result =
    process.platform === 'win32'
      ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run go -- --skip-npm'], {
          cwd: process.cwd(),
          encoding: 'utf8',
          env,
        })
      : spawnSync('npm', ['run', 'go', '--', '--skip-npm'], {
          cwd: process.cwd(),
          encoding: 'utf8',
          env,
        });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Wheel-mcp 一键安装/);
});

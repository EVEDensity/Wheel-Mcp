import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('one-click installer configures MCP without npm install', () => {
  const result = spawnSync(process.execPath, ['scripts/install.mjs', '--skip-npm'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, GODOT_PATH: process.env.GODOT_PATH ?? 'E:/AI/Godot_v4.7.2-stable_win64_console.exe' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Wheel-mcp 一键安装/);
  assert.match(result.stdout, /wheel-mcp/);
});

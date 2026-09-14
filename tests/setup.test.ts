import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('setup script builds and writes Cursor MCP config', async () => {
  const result = spawnSync(process.execPath, ['scripts/setup.mjs', '--skip-build'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, GODOT_PATH: process.env.GODOT_PATH ?? 'E:/AI/Godot_v4.7.2-stable_win64_console.exe' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const configPath = path.join(process.cwd(), '.cursor', 'mcp.json');
  await access(configPath, constants.R_OK);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.mcpServers['wheel-mcp'].command, 'node');
  assert.deepEqual(config.mcpServers['wheel-mcp'].args, ['${workspaceFolder}/scripts/run-mcp.mjs']);
});

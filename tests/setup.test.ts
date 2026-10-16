import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSetupFixture } from './helpers/setup-fixture.js';
import { pathToFileURL } from 'node:url';

test('updating Godot in .env preserves permission settings, comments and line endings', async () => {
  const { mergeGodotEnv } = await import(pathToFileURL(path.resolve('scripts/lib/godot-discovery.mjs')).href);
  const tail = '# keep this\r\nMCP_STDIO_SCOPES=read\r\nMCP_STDIO_PROJECT_ROOTS=D:/trusted-game\r\n';
  assert.equal(mergeGodotEnv(`GODOT_PATH=D:/old.exe\r\n${tail}`, 'D:/new.exe'), `GODOT_PATH=D:/new.exe\r\n${tail}`);
  assert.equal(mergeGodotEnv(tail, 'D:/new.exe'), `${tail}GODOT_PATH=D:/new.exe\r\n`);
  assert.equal(mergeGodotEnv('CUSTOM=value', 'D:/new.exe'), 'CUSTOM=value\nGODOT_PATH=D:/new.exe\n');
  assert.equal(mergeGodotEnv('GODOT_PATH=old\nGODOT_PATH=older\n', 'new'), 'GODOT_PATH=new\nGODOT_PATH=new\n');
});

test('setup script configures project-level MCP hosts', async () => {
  const root = await createSetupFixture();
  const result = spawnSync(process.execPath, ['scripts/setup.mjs', '--skip-build', '--force'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const relativePath of ['.cursor/mcp.json', '.vscode/mcp.json', '.mcp.json']) {
    const configPath = path.join(root, ...relativePath.split('/'));
    await access(configPath, constants.R_OK);
    const raw = await readFile(configPath, 'utf8');
    assert.match(raw, /"wheel-mcp"/);
    assert.match(raw, /scripts\/run-mcp\.mjs/);
  }
});

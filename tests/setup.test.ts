import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSetupFixture } from './helpers/setup-fixture.js';

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverGodotPath, parseEnvFile, resolveGodotPathSync } from '../src/godot-path.js';

test('parseEnvFile ignores comments and quoted values', () => {
  const parsed = parseEnvFile(`
# comment
GODOT_PATH="D:/tools/Godot.exe"
DEBUG=true
`);
  assert.equal(parsed.GODOT_PATH, 'D:/tools/Godot.exe');
  assert.equal(parsed.DEBUG, 'true');
});

test('resolveGodotPathSync requires an explicit executable', () => {
  assert.throws(() => resolveGodotPathSync(''), /GODOT_PATH is required/);
});

test('resolveGodotPathSync normalizes an executable path', () => {
  assert.equal(
    resolveGodotPathSync('E:/AI/Godot_v4.7.2-stable_win64_console.exe').endsWith(
      'Godot_v4.7.2-stable_win64_console.exe',
    ),
    true,
  );
});

test('discoverGodotPath prefers explicit and .env values', async () => {
  const previous = process.env.GODOT_PATH;
  delete process.env.GODOT_PATH;
  try {
    const root = await mkdtemp(path.join(os.tmpdir(), 'godot-path-'));
    const executable = path.join(root, 'Godot_v4.7.2-stable_win64_console.exe');
    await writeFile(executable, 'stub');
    const envFile = path.join(root, '.env');
    await writeFile(envFile, `GODOT_PATH=${executable.replace(/\\/g, '/')}\n`);

    const discovered = await discoverGodotPath({ envFile, searchRoots: [] });
    assert.equal(discovered, path.resolve(executable));
  } finally {
    if (previous) process.env.GODOT_PATH = previous;
    else delete process.env.GODOT_PATH;
  }
});

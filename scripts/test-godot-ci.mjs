import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';

const godotPath = process.env.GODOT_PATH ?? '';
if (!godotPath || !existsSync(godotPath)) {
  console.error(`GODOT_PATH must point to an existing Godot executable (got: ${godotPath || '(unset)'})`);
  process.exit(1);
}

const testFiles = [
  'build/tests/readme-smoke.test.js',
  'build/tests/runtime-behavior-e2e.test.js',
  'build/tests/reload-scene.test.js',
  'build/tests/shutdown.test.js',
];

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: process.env,
});

process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');

if (result.status !== 0) process.exit(result.status ?? 1);

const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
const skipMatch = combined.match(/ℹ skipped (\d+)/);
const skipped = skipMatch ? Number(skipMatch[1]) : 0;
if (skipped > 0) {
  console.error(`Godot CI failed: ${skipped} test(s) skipped despite GODOT_PATH=${godotPath}`);
  process.exit(1);
}

console.log(`Godot CI smoke passed (${testFiles.length} files, 0 skipped)`);

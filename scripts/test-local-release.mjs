import { runCiSuite } from './lib/ci-suite.mjs';
import { statSync } from 'node:fs';

const plan = {
  files: [
    'install',
    'setup',
    'project-transactions',
    'transaction-recovery',
    'owned-process',
    'streamable-http-security',
    'editor-scene-rpc',
    'editor-scene-save',
    'validated-project-write',
    'validation-cleanup',
    'editor-outcome-smoke',
  ].map((name) => `build/tests/${name}.test.js`),
  scope: 'local-release-safety',
  concurrency: 2,
  timeoutMs: 240000,
  engine: 'REAL_HEADLESS',
};
if (process.argv.length === 3 && process.argv[2] === '--list') console.log(JSON.stringify(plan));
else if (process.argv.length !== 2) {
  console.error('usage: test-local-release.mjs [--list]');
  process.exitCode = 2;
} else {
  const godotPath = process.env.GODOT_PATH ?? '';
  if (!godotPath || !statSync(godotPath, { throwIfNoEntry: false })?.isFile())
    throw new Error('Real Godot is required; safety acceptance cannot skip');
  runCiSuite({ ...plan, godotPath });
}

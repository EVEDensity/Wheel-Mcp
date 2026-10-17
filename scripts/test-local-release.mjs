import { runCiSuite } from './lib/ci-suite.mjs';
import { statSync } from 'node:fs';

const plan = {
  files: [
    // Fixed two-worker longest-work-first queue. Hosted trace 39066732705
    // started the ~50s transaction file at 184s and cleanup at 238s, losing
    // the final summary at 240s. Do not leave these files behind short work.
    // Every file, test, deadline and concurrency limit remains unchanged.
    'validated-project-write',
    'editor-scene-rpc',
    'editor-scene-save',
    'project-transactions',
    'png-texture-native',
    'install',
    'sprite-native',
    'ui-scroll-native',
    'ui-rich-text-native',
    'ui-texture-native',
    'ui-line-edit-native',
    'streamable-http-security',
    'owned-process',
    'editor-protocol-input',
    'validation-cleanup',
    'transaction-recovery',
    'setup',
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

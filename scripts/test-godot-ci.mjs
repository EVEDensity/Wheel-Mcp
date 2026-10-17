import { statSync } from 'node:fs';
import { runCiSuite } from './lib/ci-suite.mjs';

// Bounded no-display checks, not the complete authoring/render matrix.
// Rebalance three required native cases out of the overloaded safety phase.
// Both phases retain two workers and the original 240s/60s deadlines.
const files = [
  'sprite-native',
  'character-native',
  'character-step-native',
  'mouse-wheel-native',
  'mcp-background-runtime',
  'bridge-handshake',
  'runtime-error-contract',
  'session-isolation',
  'stdio-cleanup',
].map((name) => `build/tests/${name}.test.js`);
const plan = { files, concurrency: 2, timeoutMs: 60000, engine: 'REAL_HEADLESS', scope: 'engine-smoke' };

if (process.argv[2] === '--list' && process.argv.length === 3) console.log(JSON.stringify(plan));
else if (process.argv.length !== 2) {
  console.error('usage: test-godot-ci.mjs [--list]');
  process.exitCode = 2;
} else {
  const godotPath = process.env.GODOT_PATH ?? '';
  let available = false;
  try {
    available = statSync(godotPath).isFile();
  } catch {
    /* fail below */
  }
  if (!available) {
    console.error('GODOT_PATH must point to an existing Godot executable; engine smoke NOT_RUN.');
    process.exitCode = 1;
  } else runCiSuite({ ...plan, godotPath });
}

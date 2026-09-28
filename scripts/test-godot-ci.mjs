import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import process from 'node:process';
import { summarizeTestEvents } from './lib/test-report.mjs';

const godotPath = process.env.GODOT_PATH ?? '';
let godotIsFile = false;
try {
  godotIsFile = statSync(godotPath).isFile();
} catch {
  /* unavailable */
}
if (!godotIsFile) {
  console.error(`GODOT_PATH must point to an existing Godot executable (got: ${godotPath || '(unset)'})`);
  process.exit(1);
}

const testFiles = [
  'build/tests/editor-fixture-isolation.test.js',
  'build/tests/editor-authoring-e2e.test.js',
  'build/tests/editor-scene-save.test.js',
  'build/tests/validated-project-write.test.js',
  'build/tests/editor-scene-rpc.test.js',
  'build/tests/editor-instance-rpc.test.js',
  'build/tests/inherited-scene-roundtrip.test.js',
  'build/tests/scene-move.test.js',
  'build/tests/ui-authoring-e2e.test.js',
  'build/tests/runtime-3d-e2e.test.js',
  'build/tests/physics-authoring-e2e.test.js',
  'build/tests/animation-authoring-e2e.test.js',
  'build/tests/shader-authoring-e2e.test.js',
  'build/tests/content-workflows-e2e.test.js',
  'build/tests/script-semantic-service.test.js',
  'build/tests/resource-roundtrip.test.js',
  'build/tests/resource-sharing.test.js',
  'build/tests/process-evidence.test.js',
  'build/tests/editor-bridge-e2e.test.js',
  'build/tests/editor-scene-operations.test.js',
  'build/tests/readme-smoke.test.js',
  'build/tests/runtime-behavior-e2e.test.js',
  'build/tests/runtime-error-contract.test.js',
  'build/tests/runtime-property-roundtrip.test.js',
  'build/tests/persistent-events-e2e.test.js',
  'build/tests/bridge-handshake.test.js',
  'build/tests/fresh-validation.test.js',
  'build/tests/session-isolation.test.js',
  'build/tests/reload-scene.test.js',
  'build/tests/shutdown.test.js',
];

const result = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=2', '--test-reporter=./scripts/lib/json-test-reporter.mjs', ...testFiles],
  {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
  },
);

process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');

let report;
try {
  report = summarizeTestEvents(result.stdout ?? '');
} catch (error) {
  console.error(`Godot CI report invalid: ${error.message}`);
  process.exit(1);
}
if (result.status !== 0 || report.failed || report.skipped || report.cancelled || report.todo) {
  console.error(
    `Godot CI failed: ${JSON.stringify({ exitCode: result.status, signal: result.signal, tests: report.tests, failed: report.failed, skipped: report.skipped, cancelled: report.cancelled, todo: report.todo })}`,
  );
  process.exit(result.status || 1);
}
console.log(`Godot CI smoke passed (${testFiles.length} files, ${report.tests} tests, 0 skipped)`);

import { runCiSuite } from './lib/ci-suite.mjs';
runCiSuite({
  files: ['build/tests/package-distribution.test.js'],
  scope: 'local-release-package',
  timeoutMs: 40000,
  godotPath: process.env.GODOT_PATH ?? '',
});

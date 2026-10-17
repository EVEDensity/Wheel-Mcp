import { runCiSuite } from './lib/ci-suite.mjs';

// Critical non-engine paths, never an automatic soak/renderer suite.
const files = [
  // Safety prerequisite before process-heavy SDK/lifecycle fixtures. Keep the
  // same five-second identity deadline; do not hide a failed platform read.
  'process-identity',
  'render-window',
  'production-manifest',
  'local-release',
  'github-release',
  'error-schema',
  'variant-codec',
  'response-types',
  'response-budget',
  'retry-guidance',
  'method-authorization',
  'project-path-policy',
  'tool-registry',
  'mcp-prompts',
  'streamable-http',
  'stdio-client-contract',
  'mcp-launcher',
  'ui-line-edit-schema',
  'ui-scroll-schema',
  'ui-rich-text-schema',
  'ui-texture-schema',
  'png-texture-contract',
  'mouse-wheel-contract',
  'sprite-schema',
  'project-write-approval',
  'preapproved-writes',
  'ci-policy',
]
  .map((name) => `build/tests/${name}.test.js`)
  .concat('scripts/site.test.mjs');
const plan = { files, concurrency: 2, timeoutMs: 90000, engine: 'NOT_RUN', scope: 'fast-contract-only' };

if (process.argv[2] === '--list' && process.argv.length === 3) console.log(JSON.stringify(plan));
else if (process.argv.length !== 2) {
  console.error('usage: test-ci-fast.mjs [--list]');
  process.exitCode = 2;
} else runCiSuite(plan);

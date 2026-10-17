import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from './production-manifest.mjs';

export const localReleasePolicy = {
  id: 'windows-local',
  revision: 2,
  version: '0.2.8',
  platform: 'win32',
  godot: '4.7.2',
  transport: 'stdio',
  totalTimeoutMs: 600000,
  approval: 'MOCK_IN_TESTS_HOST_CONFIRMATION_REQUIRED_IN_PRODUCT',
  excluded: [
    'online-deployment',
    'other-platforms',
    'other-client-certification',
    'human-approval-UX',
    'long-session',
    'high-load-performance',
    'full-authoring-matrix',
  ],
};

export const localReleaseSteps = [
  { id: 'build', program: 'node', args: ['node_modules/typescript/bin/tsc'], timeoutMs: 45000 },
  {
    id: 'format',
    program: 'node',
    args: ['node_modules/prettier/bin/prettier.cjs', '--check', 'src', 'tests', 'godot-plugin', '*.json'],
    timeoutMs: 30000,
  },
  { id: 'lint', program: 'node', args: ['node_modules/eslint/bin/eslint.js', 'src', 'tests'], timeoutMs: 45000 },
  { id: 'core', program: 'node', args: ['scripts/test-ci-fast.mjs'], timeoutMs: 100000 },
  { id: 'package', program: 'node', args: ['scripts/test-release-package.mjs'], timeoutMs: 50000 },
  { id: 'safety', program: 'node', args: ['scripts/test-local-release.mjs'], timeoutMs: 250000 },
  { id: 'engine', program: 'node', args: ['scripts/test-godot-ci.mjs'], timeoutMs: 70000 },
  { id: 'pack', program: 'npm', args: ['pack', '--ignore-scripts', '--json'], timeoutMs: 30000 },
  {
    id: 'audit',
    program: 'npm',
    args: ['audit', '--json', '--fetch-retries=0', '--fetch-timeout=15000', '--logs-max=0'],
    timeoutMs: 25000,
  },
  { id: 'sbom', program: 'npm', args: ['sbom', '--sbom-format=cyclonedx'], timeoutMs: 15000 },
];

export const minimumReleaseTests = { core: 153, safety: 74, engine: 19, package: 2 };

export const localReleaseDocs = [
  'README.md',
  'README.zh-CN.md',
  'SECURITY.md',
  'THIRD-PARTY-NOTICES.md',
  'docs/LOCAL-STABLE-RELEASE.md',
  'docs/GITHUB-RELEASE.md',
  'CHANGELOG.md',
];

export async function localDocumentHashes(root) {
  return Object.fromEntries(
    await Promise.all(localReleaseDocs.map(async (file) => [file, sha256(await readFile(path.join(root, file)))])),
  );
}

/** This profile cannot grant the separate 36-task production qualification. */
export function assessLocalRelease(manifest, current) {
  const errors = [];
  const fail = (message) => errors.push(message);
  if (manifest?.schemaVersion !== 1 || manifest?.status !== 'PASS') fail('local gate is not PASS');
  if (!/^[a-z0-9-]{20,64}$/.test(manifest?.runId ?? '')) fail('missing local run identity');
  if (JSON.stringify(manifest?.policy) !== JSON.stringify(localReleasePolicy)) fail('local release policy differs');
  if (manifest?.sourceHash !== current.sourceHash || !/^[a-f0-9]{64}$/.test(current.sourceHash ?? ''))
    fail('local evidence does not bind current source');
  if (manifest?.version !== current.version || current.version !== localReleasePolicy.version)
    fail('local release version differs');
  if (JSON.stringify(manifest?.documents) !== JSON.stringify(current.documents)) fail('release documentation changed');
  if (manifest?.environment?.platform !== 'win32' || !/^4\.7\.2(?:\.|$)/.test(manifest?.environment?.godot ?? ''))
    fail('local environment is outside scope');
  const node = /^v(\d+)\.(\d+)\./.exec(manifest?.environment?.node ?? '');
  if (!node || Number(node[1]) < 20 || (Number(node[1]) === 20 && Number(node[2]) < 19))
    fail('unsupported Node environment');
  if (
    !Number.isFinite(manifest?.durationMs) ||
    manifest.durationMs < 0 ||
    manifest.durationMs > localReleasePolicy.totalTimeoutMs
  )
    fail('local execution bound exceeded');
  if (!Array.isArray(manifest?.steps) || manifest.steps.length !== localReleaseSteps.length)
    fail('required local steps are missing');
  for (const step of localReleaseSteps) {
    const evidence = manifest?.steps?.find((item) => item.id === step.id);
    if (
      !evidence ||
      evidence.status !== 'PASS' ||
      evidence.exitCode !== 0 ||
      evidence.signal !== null ||
      evidence.error
    )
      fail(`${step.id} did not succeed`);
    if (
      !/^[a-f0-9]{64}$/.test(evidence?.outputHash ?? '') ||
      !Number.isFinite(evidence?.durationMs) ||
      evidence.durationMs < 0 ||
      evidence.durationMs > step.timeoutMs
    )
      fail(`${step.id} has invalid evidence`);
    if (['core', 'safety', 'engine', 'package'].includes(step.id)) {
      const tests = evidence?.tests;
      if (
        !tests ||
        !Number.isSafeInteger(tests.tests) ||
        tests.tests < minimumReleaseTests[step.id] ||
        tests.passed !== tests.tests ||
        tests.failed !== 0 ||
        tests.skipped !== 0 ||
        tests.cancelled !== 0 ||
        tests.todo !== 0 ||
        evidence.scratchCleanup !== 'PASS'
      )
        fail(`${step.id} is incomplete or cleanup failed`);
      if (evidence?.runId !== manifest?.runId) fail(`${step.id} evidence belongs to another run`);
    }
  }
  if (manifest?.audit?.metadata?.vulnerabilities?.total !== 0)
    fail('dependency audit is missing or has known vulnerabilities');
  if (
    manifest?.package?.version !== current.version ||
    !/^[a-f0-9]{64}$/.test(manifest?.package?.sha256 ?? '') ||
    !Number.isSafeInteger(manifest?.package?.files) ||
    manifest.package.files <= 0 ||
    manifest.package.excluded !== 0
  )
    fail('runtime artifact is not valid');
  if (manifest?.productionQualification !== 'NOT_QUALIFIED')
    fail('local gate must not promote production qualification');
  if (!/^[a-f0-9]{64}$/.test(manifest?.sbomSha256 ?? '')) fail('missing SBOM fingerprint');
  return errors;
}

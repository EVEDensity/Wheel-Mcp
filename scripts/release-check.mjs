import { readFile, access } from 'node:fs/promises';
import process from 'node:process';
import path from 'node:path';
import { sourceIdentity } from './lib/production-manifest.mjs';
import { validateRoadmapState } from './lib/roadmap-state.mjs';
import { assessReleaseQualification } from './lib/release-qualification.mjs';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = packageJson.version;
if (!/^0\.1\.0-preview\.\d+$/.test(version) && !/^0\.2\.0$/.test(version))
  throw new Error(`unsupported release version: ${version}`);
if (packageJson.bin['wheel-mcp'] !== 'build/src/mcp-server-sdk.js')
  throw new Error('MCP bin must use official SDK entrypoint');
if (packageJson.engines?.node !== '>=20.19.0') throw new Error('Node >=20.19.0 is required');
if (!packageJson.scripts?.sbom || !packageJson.scripts?.['audit:dependencies'])
  throw new Error('security scripts are required');
if (!/^10\./.test(String(packageJson.devDependencies?.eslint ?? '')))
  throw new Error('ESLint 10 is required for the supported release toolchain');
for (const requiredDoc of ['docs/PRODUCTION-DEPLOYMENT.md', 'docs/SECURITY-THREAT-MODEL.md', 'SECURITY.md']) {
  try {
    await access(requiredDoc);
  } catch {
    throw new Error('required security/release document is missing: ' + requiredDoc);
  }
}
const readText = async (file) => readFile(file, 'utf8');
const readme = await readText('README.md');
const readiness = await readText('docs/RELEASE-READINESS.md');
if (!/Windows-only/.test(readme) || !/Godot 4\.7\.2/.test(readme))
  throw new Error('README must declare the Windows-only Godot 4.7.2 release scope');
if (!/NOT_QUALIFIED/.test(readiness))
  throw new Error('readiness must explicitly distinguish the current roadmap from historical candidate labels');
const source = await sourceIdentity(path.resolve('.'));
const roadmap = JSON.parse(await readText('docs/production-roadmap/tasks.json'));
const roadmapErrors = await validateRoadmapState(
  roadmap,
  await readText('docs/PRODUCTION-MAIN-ASSISTANT-ROADMAP.zh-CN.md'),
  path.resolve('.'),
);

const matrixRoot = path.resolve('runs/matrix');
const requiredFiles = [
  'tool-contract-matrix.json',
  'tool-runtime-results.json',
  'tool-negative-results.json',
  'release-matrix-summary.json',
];
const errors = [...roadmapErrors, ...assessReleaseQualification(roadmap, source.sourceHash)];
const readJson = async (name) => {
  try {
    return JSON.parse(await readFile(path.join(matrixRoot, name), 'utf8'));
  } catch {
    errors.push(`missing or invalid matrix file: ${name}`);
    return null;
  }
};
for (const file of requiredFiles) await readJson(file);
const contract = await readJson('tool-contract-matrix.json');
const runtime = await readJson('tool-runtime-results.json');
const negative = await readJson('tool-negative-results.json');
const summary = await readJson('release-matrix-summary.json');
for (const [name, value] of Object.entries({ contract, runtime, negative, summary }))
  if (value?.sourceHash !== source.sourceHash) errors.push(`${name} matrix does not bind current sourceHash`);
const serialized = JSON.stringify({ contract, runtime, negative, summary });
if (serialized.includes('PENDING_REAL_RUN')) errors.push('matrix contains PENDING_REAL_RUN');
const requiredResults = [
  'doctor',
  'list-projects',
  'project-info',
  'scene-tree',
  'launch',
  'logs',
  'stop',
  'cancel-repeat',
  'launch_project',
  'get_debug_output',
  'stop_project',
  'cancel_project-repeat',
  'runtime-scene-tree',
  'runtime-property',
  'set-runtime-property',
  'inject-input',
  'screenshot',
  'context-pack',
  'scenario',
];
const resultNames = new Set((runtime?.results ?? []).map((item) => item.name));
for (const name of requiredResults) if (!resultNames.has(name)) errors.push(`missing real matrix result: ${name}`);
if (!Array.isArray(negative?.cases) || negative.cases.length === 0) errors.push('negative test results are missing');
if (negative?.status !== 'PASS') errors.push(`negative test status is ${negative?.status ?? 'missing'}`);
if (runtime?.status !== 'PASS') errors.push(`runtime matrix status is ${runtime?.status ?? 'missing'}`);
if (summary?.status !== 'PASS') errors.push(`release matrix status is ${summary?.status ?? 'missing'}`);
const failed = (runtime?.results ?? []).filter((item) => item.verdict !== 'PASS');
if (failed.length)
  errors.push(`matrix contains ${failed.length} failed result(s): ${failed.map((item) => item.name).join(', ')}`);
const evidenceDirs = (runtime?.results ?? [])
  .flatMap((item) => [item.evidence_dir, item.cli_evidence_dir, item.mcp_evidence_dir])
  .filter(Boolean);
for (const dir of [...new Set(evidenceDirs)]) {
  try {
    await access(path.join(dir, 'manifest.json'));
  } catch {
    errors.push(`evidence manifest missing: ${dir}`);
  }
}
if (!summary?.platforms || typeof summary.platforms !== 'object')
  errors.push('platform verification summary is missing');
if (errors.length) {
  console.error(
    JSON.stringify(
      {
        status: 'FAIL',
        version,
        sourceHash: source.sourceHash,
        qualification: roadmap.qualification?.status ?? 'NOT_QUALIFIED',
        checks: [
          'version',
          'sdk-entrypoint',
          'node-engine',
          'toolchain',
          'security-scripts',
          'deployment-review-docs',
          'windows-scope',
          'matrix-integrity',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        version,
        node: process.version,
        checks: [
          'version',
          'sdk-entrypoint',
          'node-engine',
          'toolchain',
          'security-scripts',
          'deployment-review-docs',
          'windows-scope',
          'matrix-integrity',
        ],
      },
      null,
      2,
    ),
  );
}

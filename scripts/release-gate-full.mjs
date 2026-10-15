import { spawnSync } from 'node:child_process';
const steps = [
  'verify:roadmap',
  'verify:production',
  'matrix:generate',
  'release:check:production',
  'audit:dependencies',
  'sbom',
];
if (process.argv.length === 3 && process.argv[2] === '--plan') {
  console.log(JSON.stringify({ scope: 'full-production-only', steps, doesNotPublish: true }, null, 2));
} else if (process.argv.length !== 2) {
  console.error('usage: release-gate-full.mjs [--plan]');
  process.exitCode = 2;
} else
  for (const step of steps) {
    const args = ['run', step, ...(step === 'verify:production' ? ['--', '--baseline'] : [])];
    const result = process.env.npm_execpath
      ? spawnSync(process.execPath, [process.env.npm_execpath, ...args], { stdio: 'inherit', windowsHide: true })
      : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
          stdio: 'inherit',
          windowsHide: true,
          shell: process.platform === 'win32',
        });
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }

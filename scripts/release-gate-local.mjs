import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';

function run(label, command, args = []) {
  console.log(`\n==> ${label}`);
  const useNpmCli=process.platform==='win32'&&command==='npm.cmd'&&process.env.npm_execpath;
  const result = spawnSync(useNpmCli?process.execPath:command, useNpmCli?[process.env.npm_execpath,...args]:args, {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32' && command === 'npm.cmd' && !useNpmCli,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const godotPath = process.env.GODOT_PATH ?? '';
if (!godotPath || !existsSync(godotPath)) {
  console.error(`GODOT_PATH must point to an existing Godot executable (got: ${godotPath || '(unset)'})`);
  process.exit(1);
}

process.env.REAL_GODOT_PROJECT ??= 'tests/fixtures/runtime-behavior';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

run('build', npm, ['run', 'build']);
run('isolated installation smoke (no workspace client configuration writes)', process.execPath, [
  '--test',
  'build/tests/install.test.js',
  'build/tests/setup.test.js',
]);
run('roadmap state', npm, ['run', 'verify:roadmap']);
run('current-source baseline', npm, ['run', 'verify:production', '--', '--baseline']);
run('format:check', npm, ['run', 'format:check']);
run('lint', npm, ['run', 'lint']);
run('test', npm, ['test']);
run('test:godot-ci', npm, ['run', 'test:godot-ci']);
run('matrix:generate', npm, ['run', 'matrix:generate']);
run('release:check', npm, ['run', 'release:check']);
run('audit:dependencies', npm, ['run', 'audit:dependencies']);
run('sbom', npm, ['run', 'sbom']);

console.log('\nLocal release gate passed.');

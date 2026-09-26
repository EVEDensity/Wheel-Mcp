import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRoadmapState } from './lib/roadmap-state.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const value = (flag) => {
  const at = process.argv.indexOf(flag);
  return at < 0 ? undefined : process.argv[at + 1];
};
const unknown = process.argv
  .slice(2)
  .filter((arg, index, args) => arg.startsWith('--') && !['--state', '--roadmap', '--root'].includes(arg));
if (unknown.length || ['--state', '--roadmap', '--root'].some((flag) => process.argv.includes(flag) && !value(flag))) {
  console.error('usage: check-roadmap.mjs [--state file] [--roadmap file] [--root directory]');
  process.exit(2);
}
const projectRoot = path.resolve(value('--root') ?? root);
try {
  const state = JSON.parse(
    await readFile(
      path.resolve(value('--state') ?? path.join(projectRoot, 'docs/production-roadmap/tasks.json')),
      'utf8',
    ),
  );
  const markdown = await readFile(
    path.resolve(value('--roadmap') ?? path.join(projectRoot, 'docs/PRODUCTION-MAIN-ASSISTANT-ROADMAP.zh-CN.md')),
    'utf8',
  );
  const errors = await validateRoadmapState(state, markdown, projectRoot);
  console.log(
    JSON.stringify(
      { status: errors.length ? 'FAIL' : 'PASS', tasks: state.tasks.length, gates: state.gates.length, errors },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', error: error.message }));
  process.exitCode = 1;
}

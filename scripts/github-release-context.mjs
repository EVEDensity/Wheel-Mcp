import { readFile, appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { validateReleaseContext } from './lib/github-release.mjs';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Invalid release version');
const tag = `v${pkg.version}`;
const result = validateReleaseContext({
  version: pkg.version,
  ref: process.env.GITHUB_REF,
  head: git('rev-parse', 'HEAD'),
  tagHead: git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`),
  mainContains: (() => {
    try {
      git('merge-base', '--is-ancestor', 'HEAD', 'origin/main');
      return true;
    } catch {
      return false;
    }
  })(),
});
if (process.env.GITHUB_SHA && git('rev-parse', `${process.env.GITHUB_SHA}^{commit}`) !== result.commit)
  throw new Error('Checkout does not match the triggering commit');
if (process.env.GITHUB_OUTPUT)
  await appendFile(process.env.GITHUB_OUTPUT, `tag=${result.tag}\ncommit=${result.commit}\n`);
console.log(JSON.stringify(result));

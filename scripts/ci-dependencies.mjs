import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function needsDependencyAudit(files) {
  return files.some((file) => ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc'].includes(file));
}

export function dependencyDecision(base, diff) {
  if (!/^[a-f0-9]{40}$/i.test(base ?? '') || /^0+$/.test(base))
    return { audit: true, reason: 'base unavailable; audit conservatively' };
  try {
    return { audit: needsDependencyAudit(diff(base)), reason: 'dependency file diff' };
  } catch {
    return { audit: true, reason: 'base/diff unavailable; audit conservatively' };
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const result =
    process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'
      ? { audit: true, reason: 'manual run checks current advisories' }
      : dependencyDecision(process.env.CI_BASE_SHA, (base) =>
          execFileSync('git', ['diff', '--name-only', '-z', base, 'HEAD'], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 10000,
            maxBuffer: 1024 * 1024,
          })
            .split('\0')
            .filter(Boolean),
        );
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `audit=${result.audit}\n`);
  console.log(JSON.stringify(result));
}

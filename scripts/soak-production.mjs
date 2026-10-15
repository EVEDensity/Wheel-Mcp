import { readFile, stat, realpath, lstat, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceIdentity, sha256 } from './lib/production-manifest.mjs';

// Workload execution and reported-limit checking never grant chaos/security or production qualification.
const { frozenSoakPlan, assessSoakReport } = await import(
  pathToFileURL(path.resolve('build/src/soak-contract.js')).href
);
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--plan') {
  console.log(JSON.stringify(frozenSoakPlan(), null, 2));
} else if (args.length === 2 && args[0] === '--assess') {
  const file = path.resolve(args[1]);
  if ((await stat(file)).size > 16 * 1024 * 1024) throw new Error('Soak report exceeds 16MiB budget');
  const report = JSON.parse(await readFile(file, 'utf8'));
  const result = assessSoakReport(report, (await sourceIdentity(process.cwd())).sourceHash);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'FAIL') process.exitCode = 1;
} else if (args.length === 2 && args[0] === '--request-stop') {
  const parent = await realpath(path.resolve('runs/production-roadmap/T31'));
  const directory = path.resolve(args[1]);
  if (
    path.dirname(directory) !== parent ||
    !/^native-(?:workload|smoke)-\d{4}-/.test(path.basename(directory)) ||
    (await lstat(directory)).isSymbolicLink() ||
    (await realpath(directory)) !== directory
  )
    throw new Error('Stop request requires an exact managed native run directory');
  const info = await lstat(path.join(directory, 'inputs.json'));
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 65536)
    throw new Error('Unsafe native run inputs');
  const input = JSON.parse(await readFile(path.join(directory, 'inputs.json'), 'utf8'));
  const { readProcessIdentity } = await import('../build/src/process-identity.js');
  if (
    !Number.isSafeInteger(input.workerPid) ||
    input.workerPid <= 0 ||
    !/^[a-f0-9]{64}$/.test(input.workerIdentityHash ?? '') ||
    !/^[a-f0-9]{64}$/.test(input.sourceHash ?? '')
  )
    throw new Error('Run does not support cooperative stopping');
  const identity = await readProcessIdentity(input.workerPid);
  if (!identity || sha256(JSON.stringify(identity)) !== input.workerIdentityHash)
    throw new Error('Worker already stopped or OS process identity changed; no request written');
  if (
    await lstat(path.join(directory, 'stop-request.json')).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    })
  )
    throw new Error('Stop request already exists; do not overwrite it');
  await writeFile(
    path.join(directory, 'stop-request.staged'),
    JSON.stringify({
      schemaVersion: 1,
      workerPid: input.workerPid,
      workerIdentityHash: input.workerIdentityHash,
      sourceHash: input.sourceHash,
    }),
    { flag: 'wx', mode: 0o600 },
  );
  await rename(path.join(directory, 'stop-request.staged'), path.join(directory, 'stop-request.json'));
  console.log(JSON.stringify({ status: 'STOP_REQUESTED_NOT_YET_STOPPED', workerPid: input.workerPid, directory }));
} else if (args.length === 1 && ['--smoke', '--smoke-paced', '--smoke-stress', '--workload'].includes(args[0])) {
  await import('./soak-native-worker.mjs');
} else {
  console.error(
    'NOT_RUN: use --plan, --assess <report>, --smoke, --smoke-paced or --workload. Full qualification still requires independent chaos/security, manifest and gate review.',
  );
  process.exitCode = 2;
}

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { sourceIdentity, sha256 } from './lib/production-manifest.mjs';
import { discoverGodotPath } from './lib/godot-discovery.mjs';
import {
  localReleasePolicy,
  localReleaseSteps,
  localDocumentHashes,
  assessLocalRelease,
} from './lib/local-release.mjs';

if (process.argv.length === 3 && process.argv[2] === '--plan') {
  console.log(JSON.stringify({ policy: localReleasePolicy, steps: localReleaseSteps, doesNotPublish: true }, null, 2));
} else if (process.argv.length !== 2) {
  console.error('usage: release-local-stable.mjs [--plan]');
  process.exitCode = 2;
} else {
  const root = process.cwd();
  const output = path.resolve('runs/local-release');
  await mkdir(output, { recursive: true });
  const started = Date.now();
  const source = await sourceIdentity(root);
  const documents = await localDocumentHashes(root);
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const npmCli = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  ].find((file) => file && existsSync(file));
  const godotPath = await discoverGodotPath({ envFile: '.env' });
  const version =
    godotPath && spawnSync(godotPath, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  const manifest = {
    schemaVersion: 1,
    status: 'FAIL',
    version: pkg.version,
    sourceHash: source.sourceHash,
    head: source.head,
    documents,
    policy: localReleasePolicy,
    startedAt: new Date(started).toISOString(),
    environment: { platform: process.platform, node: process.version, godot: version?.stdout?.trim() ?? '' },
    steps: [],
    durationMs: 0,
    productionQualification: 'NOT_QUALIFIED',
  };
  try {
    if (
      process.platform !== 'win32' ||
      !npmCli ||
      !godotPath ||
      version.status !== 0 ||
      !/^4\.7\.2(?:\.|$)/.test(manifest.environment.godot)
    )
      throw new Error('Windows, npm and real Godot 4.7.2 are required');
    if (pkg.version !== localReleasePolicy.version)
      throw new Error('Candidate version must match the local release profile');
    const env = {
      ...process.env,
      GODOT_PATH: godotPath,
      npm_config_logs_max: '0',
      npm_config_update_notifier: 'false',
    };
    delete env.NODE_TEST_CONTEXT;
    for (const step of localReleaseSteps) {
      const remaining = localReleasePolicy.totalTimeoutMs - (Date.now() - started);
      if (remaining <= 1000) throw new Error('Local release execution deadline exhausted');
      console.log(`Local gate: ${step.id}`);
      const args = step.program === 'npm' ? [npmCli, ...step.args] : step.args;
      if (step.id === 'pack') args.push('--pack-destination', output, '--logs-max=0');
      const before = Date.now();
      const result = spawnSync(process.execPath, args, {
        cwd: root,
        env,
        encoding: 'utf8',
        windowsHide: true,
        timeout: Math.min(step.timeoutMs, remaining),
        maxBuffer: 4 * 1024 * 1024,
      });
      const text = (result.stdout ?? '') + (result.stderr ?? '');
      const record = {
        id: step.id,
        status: result.status === 0 && !result.error ? 'PASS' : 'FAIL',
        exitCode: result.status,
        signal: result.signal,
        error: result.error?.code ?? null,
        durationMs: Date.now() - before,
        outputHash: sha256(text),
      };
      manifest.steps.push(record);
      if (record.status !== 'PASS') {
        await writeFile(path.join(output, 'last-failure-output.txt'), text.slice(-16000));
        throw new Error(`${step.id} failed: ${result.error?.code ?? result.status}; ${text.slice(-3000)}`);
      }
      if (['core', 'safety', 'engine', 'package'].includes(step.id)) {
        const scope = {
          core: 'fast-contract-only',
          safety: 'local-release-safety',
          engine: 'engine-smoke',
          package: 'local-release-package',
        }[step.id];
        const summary = JSON.parse(await readFile(`runs/ci/${scope}/summary.json`, 'utf8'));
        record.tests = Object.fromEntries(
          ['tests', 'passed', 'failed', 'skipped', 'cancelled', 'todo'].map((key) => [key, summary[key]]),
        );
        record.scratchCleanup = summary.scratchCleanup;
        if (summary.status !== 'PASS') throw new Error(`${step.id} did not produce a passing test summary`);
      }
      if (step.id === 'pack') {
        const artifact = JSON.parse(result.stdout)[0];
        manifest.package = {
          filename: artifact.filename,
          version: artifact.version,
          files: artifact.files.length,
          bytes: artifact.size,
          unpackedBytes: artifact.unpackedSize,
          sha256: sha256(await readFile(path.join(output, artifact.filename))),
          excluded: artifact.files.filter((file) =>
            /^(?:docs\/|vendor\/|examples\/|tests\/|build\/tests\/|runs\/|\.harness\/|\.env(?:$|\.))/.test(file.path),
          ).length,
        };
      }
      if (step.id === 'audit') manifest.audit = JSON.parse(result.stdout);
      if (step.id === 'sbom') {
        const sbom = JSON.parse(result.stdout);
        if (sbom.bomFormat !== 'CycloneDX' || !sbom.components?.length) throw new Error('SBOM is incomplete');
        await writeFile(path.join(output, 'sbom.json'), result.stdout);
        manifest.sbomSha256 = sha256(result.stdout);
      }
      console.log(`  PASS (${record.durationMs}ms)`);
    }
    manifest.durationMs = Date.now() - started;
    manifest.status = 'PASS';
    const current = await sourceIdentity(root);
    const errors = assessLocalRelease(manifest, {
      sourceHash: current.sourceHash,
      documents: await localDocumentHashes(root),
      version: pkg.version,
    });
    if (errors.length) throw new Error(errors.join('; '));
    console.log('Windows local stable gate PASS. No push, tag, publication or production promotion.');
  } catch (error) {
    manifest.status = 'FAIL';
    manifest.failure = error.message;
    process.exitCode = 1;
    console.error(error.message);
  } finally {
    manifest.finishedAt = new Date().toISOString();
    manifest.durationMs = Date.now() - started;
    await writeFile(path.join(output, 'latest.json'), JSON.stringify(manifest, null, 2));
    if (manifest.status === 'FAIL')
      await writeFile(path.join(output, 'last-failure.json'), JSON.stringify(manifest, null, 2));
  }
}

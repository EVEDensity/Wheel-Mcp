import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sourceIdentity, sha256 } from './lib/production-manifest.mjs';
import { localDocumentHashes, assessLocalRelease } from './lib/local-release.mjs';

const root = process.cwd();
try {
  const manifest = JSON.parse(await readFile('runs/local-release/latest.json', 'utf8'));
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const current = await sourceIdentity(root);
  const errors = assessLocalRelease(manifest, {
    sourceHash: current.sourceHash,
    version: pkg.version,
    documents: await localDocumentHashes(root),
  });
  if (!/^[a-z0-9.-]+\.tgz$/.test(manifest.package?.filename ?? '')) errors.push('invalid artifact filename');
  else if (
    sha256(await readFile(path.join(root, 'runs/local-release', manifest.package.filename))) !== manifest.package.sha256
  )
    errors.push('runtime artifact hash changed');
  if (sha256(await readFile('runs/local-release/sbom.json')) !== manifest.sbomSha256) errors.push('SBOM hash changed');
  const status = errors.length ? 'FAIL' : 'PASS';
  console.log(
    JSON.stringify(
      {
        status,
        profile: 'windows-local',
        version: pkg.version,
        sourceHash: current.sourceHash,
        productionQualification: 'NOT_QUALIFIED',
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
// Read-only validation is repeated immediately before selecting upload files.
execFileSync(process.execPath, ['scripts/check-local-release.mjs'], { stdio: 'inherit', windowsHide: true });
const root = path.resolve('runs/local-release');
const manifest = JSON.parse(await readFile(path.join(root, 'latest.json'), 'utf8'));
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
if (manifest.package.filename !== `wheel-mcp-${version}.tgz`) throw new Error('Unexpected release package filename');
const out = path.resolve('runs/github-release');
await mkdir(out); // Refuse stale/reused output directories instead of uploading mixed versions.
const files = [manifest.package.filename, 'sbom.json', 'acceptance.json'];
await copyFile(path.join(root, files[0]), path.join(out, files[0]));
await copyFile(path.join(root, 'sbom.json'), path.join(out, 'sbom.json'));
await copyFile(path.join(root, 'latest.json'), path.join(out, 'acceptance.json'));
const sums = [];
for (const name of files)
  sums.push(
    `${createHash('sha256')
      .update(await readFile(path.join(out, name)))
      .digest('hex')}  ${name}`,
  );
await writeFile(path.join(out, 'SHA256SUMS'), sums.join('\n') + '\n');
await writeFile(
  path.join(out, 'RELEASE-NOTES.md'),
  `# Wheel-mcp v${version} Windows local stable\n\n` +
    'GitHub-hosted Windows build and acceptance for trusted local Godot 4.7.2 projects over stdio.\n\n' +
    '- Preserves restricted MCP client environment settings during installer updates; original JSON configurations are backed up.\n' +
    '- Screenshots default to off-screen startup and minimized, unfocusable real rendering. Restart the MCP server after updating.\n' +
    '- Godot CI downloads are SHA-256 pinned and bounded.\n\n' +
    `Commit: ${process.env.GITHUB_SHA ?? manifest.head}. Source SHA-256: ${manifest.sourceHash}.\n\n` +
    'Assets: prebuilt npm-format runtime archive, CycloneDX SBOM, acceptance receipt and SHA256SUMS.\n' +
    'Download the archive and install it with Node.js/npm. Godot is installed separately; no npm registry publication is performed.\n\n' +
    'Automated approvals use explicit test doubles. Screenshots were pixel-tested locally with Compatibility and Forward+; GitHub acceptance is headless, not GPU certification.\n' +
    'Other clients/platforms, long/high-load runs, full authoring and public HTTP remain outside this limited stable profile. Full production qualification remains NOT_QUALIFIED.\n',
);
console.log(`Prepared ${files.length + 2} release files in runs/github-release`);

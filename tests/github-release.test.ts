import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm, realpath, lstat } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

const { validateReleaseContext } = await import(pathToFileURL(resolve('scripts/lib/github-release.mjs')).href);
const { godotArchives, verifyArchive, validateDownloadUrl } = await import(
  pathToFileURL(resolve('scripts/lib/godot-archive.mjs')).href
);

test('release requires an existing stable tag on the accepted main commit', () => {
  const context = {
    version: '0.2.2',
    ref: 'refs/tags/v0.2.2',
    head: 'a'.repeat(40),
    tagHead: 'a'.repeat(40),
    mainContains: true,
  };
  assert.deepEqual(validateReleaseContext(context), { tag: 'v0.2.2', commit: context.head });
  assert.doesNotThrow(() => validateReleaseContext({ ...context, ref: 'refs/heads/main' }));
  for (const invalid of [
    { version: '0.2.2-preview' },
    { ref: 'refs/pull/1/merge' },
    { ref: 'refs/tags/v0.2.0' },
    { tagHead: 'b'.repeat(40) },
    { head: '' },
    { mainContains: false },
  ]) {
    assert.throws(() => validateReleaseContext({ ...context, ...invalid }));
  }
});

test('Godot archives are pinned and corrupt bytes fail before extraction', () => {
  // Synthetic unit fixture, not engine acceptance evidence.
  const bytes = Buffer.from('archive verification fixture');
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.doesNotThrow(() => verifyArchive(bytes, hash));
  assert.throws(() => verifyArchive(Buffer.concat([bytes, Buffer.from('changed')]), hash));
  assert.throws(() => verifyArchive(bytes, ''));
  assert.equal(Object.keys(godotArchives).length, 3);
  for (const archive of Object.values(godotArchives) as { name: string; sha256: string }[]) {
    assert.match(archive.name, /^Godot_v4\.7\.2-stable_/);
    assert.match(archive.sha256, /^[a-f0-9]{64}$/);
  }
});

test('Godot download redirects stay on exact HTTPS release hosts', () => {
  for (const host of ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']) {
    assert.doesNotThrow(() => validateDownloadUrl(`https://${host}/asset.zip`));
  }
  for (const url of [
    'http://github.com/asset.zip',
    'https://github.com.attacker.example/asset.zip',
    'https://user:password@github.com/asset.zip',
    'file:///asset.zip',
  ])
    assert.throws(() => validateDownloadUrl(url));
});

test('release workflow isolates packaging from write access and verifies before publishing', async () => {
  const workflow = parse(await readFile('.github/workflows/release.yml', 'utf8'));
  assert.deepEqual(Object.keys(workflow.on).sort(), ['push', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.push.tags, ['v[0-9]*']);
  assert.equal(workflow.on.push.branches, undefined);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const { build, publish } = workflow.jobs;
  assert.equal(build['runs-on'], 'windows-latest');
  assert.ok(build['timeout-minutes'] <= 15);
  const buildCommands = build.steps.map((step: { run?: string }) => step.run ?? '').join('\n');
  for (const command of ['github-release-context.mjs', 'release:gate', 'release:check', 'prepare-github-release.mjs']) {
    assert.ok(buildCommands.includes(command));
  }
  assert.equal(publish.needs, 'build');
  assert.deepEqual(publish.permissions, { contents: 'write' });
  assert.ok(publish.steps.every((step: { uses?: string }) => !step.uses?.startsWith('actions/checkout@')));
  const publishCommands = publish.steps.map((step: { run?: string }) => step.run ?? '').join('\n');
  for (const command of ['--draft --verify-tag', 'asset.digest', '--draft=false']) {
    assert.ok(publishCommands.includes(command));
  }
  assert.doesNotMatch(publishCommands, /npm publish|--clobber|--force/);
  assert.match(publishCommands, /gh api --paginate --slurp/);
  assert.doesNotMatch(publishCommands, /releases\/tags\//);
  for (const job of [build, publish]) {
    for (const step of job.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
  }
});

test('the actual publication verifier accepts one complete draft and rejects tampering or stale source', async () => {
  const workflow = parse(await readFile('.github/workflows/release.yml', 'utf8'));
  const step = workflow.jobs.publish.steps.find((item: { run?: string }) => item.run?.includes("<<'NODE'"));
  const code = step.run.match(/<<'NODE'\n([\s\S]*?)\nNODE/)[1];
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(join(parent, 'wheel-publication-'));
  const tag = 'v0.2.2';
  const head = 'a'.repeat(40);
  const receipt = { version: tag.slice(1), status: 'PASS', head };
  try {
    const assets = [];
    for (const [name, text] of Object.entries({
      'wheel-mcp-0.2.2.tgz': 'synthetic archive, not engine evidence',
      'sbom.json': '{}',
      'acceptance.json': JSON.stringify(receipt),
      SHA256SUMS: 'synthetic checksum fixture',
    })) {
      await writeFile(join(root, name), text);
      assets.push({
        name,
        size: Buffer.byteLength(text),
        digest: `sha256:${createHash('sha256').update(text).digest('hex')}`,
      });
    }
    const release = { tag_name: tag, draft: true, target_commitish: 'main', assets };
    await writeFile(join(root, 'uploaded-releases.json'), JSON.stringify([[release]]));
    const verify = () =>
      spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        cwd: root,
        windowsHide: true,
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, RELEASE_TAG: tag, RELEASE_SHA: head },
      });
    assert.equal(verify().status, 0);
    await writeFile(join(root, 'sbom.json'), '{"tampered":true}');
    assert.notEqual(verify().status, 0);
    await writeFile(join(root, 'sbom.json'), '{}');
    await writeFile(join(root, 'acceptance.json'), JSON.stringify({ ...receipt, head: 'b'.repeat(40) }));
    assert.notEqual(verify().status, 0);
    await writeFile(join(root, 'acceptance.json'), JSON.stringify(receipt));
    await writeFile(join(root, 'uploaded-releases.json'), JSON.stringify([[release, release]]));
    assert.notEqual(verify().status, 0);
  } finally {
    assert.equal(dirname(await realpath(root)), parent);
    assert.match(basename(root), /^wheel-publication-[A-Za-z0-9]+$/);
    assert.equal((await lstat(root)).isSymbolicLink(), false);
    await rm(root, { recursive: true });
  }
});

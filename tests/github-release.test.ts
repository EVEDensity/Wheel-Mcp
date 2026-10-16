import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

const { validateReleaseContext } = await import(pathToFileURL(resolve('scripts/lib/github-release.mjs')).href);
const { godotArchives, verifyArchive, validateDownloadUrl } = await import(
  pathToFileURL(resolve('scripts/lib/godot-archive.mjs')).href
);

test('release requires an existing stable tag on the accepted main commit', () => {
  const context = {
    version: '0.2.1',
    ref: 'refs/tags/v0.2.1',
    head: 'a'.repeat(40),
    tagHead: 'a'.repeat(40),
    mainContains: true,
  };
  assert.deepEqual(validateReleaseContext(context), { tag: 'v0.2.1', commit: context.head });
  assert.doesNotThrow(() => validateReleaseContext({ ...context, ref: 'refs/heads/main' }));
  for (const invalid of [
    { version: '0.2.1-preview' },
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
  for (const job of [build, publish]) {
    for (const step of job.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
  }
});

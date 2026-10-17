import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

const { validateReleaseContext, releaseChanges } = await import(
  pathToFileURL(resolve('scripts/lib/github-release.mjs')).href
);
const { consumerNpmEnvironment, npmFailureDetails } = await import(
  pathToFileURL(resolve('scripts/lib/npm-consumer-env.mjs')).href
);
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
  assert.deepEqual(validateReleaseContext(context), { tag: 'v0.2.2', commit: context.head, publish: true });
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
  const untagged = { ...context, ref: 'refs/heads/main', tagHead: undefined, acceptanceOnly: true };
  assert.deepEqual(validateReleaseContext(untagged), { tag: 'v0.2.2', commit: context.head, publish: false });
  assert.throws(() => validateReleaseContext({ ...untagged, acceptanceOnly: false }));
  assert.throws(() => validateReleaseContext({ ...untagged, ref: context.ref }));
  assert.throws(() => validateReleaseContext({ ...untagged, mainContains: false }));
  assert.throws(() => validateReleaseContext({ ...untagged, head: '' }));
  assert.throws(() => validateReleaseContext({ ...untagged, acceptanceOnly: 'true' }));
});

test('consumer npm isolation removes parent lifecycle metadata but preserves registry and host settings', () => {
  const input = {
    PATH: 'synthetic-path',
    npm_package_name: 'parent-project',
    NPM_LIFECYCLE_EVENT: 'release:gate',
    npm_execpath: '/parent/npm',
    npm_node_execpath: '/parent/node',
    npm_command: 'run-script',
    INIT_CWD: '/parent',
    npm_config_local_prefix: '/parent',
    npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_cache: '/synthetic/cache',
    HTTPS_PROXY: 'synthetic-proxy',
    NPM_TOKEN: 'synthetic-token',
    GODOT_PATH: 'synthetic-engine',
  };
  const cleaned = consumerNpmEnvironment(input);
  for (const key of [
    'npm_package_name',
    'NPM_LIFECYCLE_EVENT',
    'npm_execpath',
    'npm_node_execpath',
    'npm_command',
    'INIT_CWD',
    'npm_config_local_prefix',
  ])
    assert.equal(cleaned[key], undefined);
  for (const key of ['PATH', 'npm_config_registry', 'npm_config_cache', 'HTTPS_PROXY', 'NPM_TOKEN', 'GODOT_PATH'])
    assert.equal(cleaned[key], input[key as keyof typeof input]);
  assert.equal(input.npm_package_name, 'parent-project');
  const noisy =
    'npm verbose cli synthetic\n' +
    'npm http cache package@https://registry.npmjs.org/p.tgz 0ms (cache hit)\n'.repeat(200) +
    'npm error fetch https://name:secret@registry.example/failed';
  const details = npmFailureDetails(noisy);
  assert.match(details, /npm verbose cli/);
  assert.match(details, /npm error fetch/);
  assert.doesNotMatch(details, /cache hit|secret/);
  assert.ok(npmFailureDetails('x'.repeat(20000)).length < 2700);
});

test('release notes use only the exact nonempty version section, never stale or unreleased notes', async () => {
  const history =
    '# Changelog\r\n\r\n## Unreleased\r\n\r\nFuture\r\n\r\n## 0.2.6\r\n\r\n- Exact change.\r\n\r\n## 0.2.5\r\n\r\nOld change.\r\n';
  assert.equal(releaseChanges(history, '0.2.6'), '- Exact change.');
  assert.throws(() => releaseChanges(history, '0.2.7'), /Missing exact/);
  assert.throws(() => releaseChanges(history, '0.2.6-preview'), /Invalid/);
  assert.throws(() => releaseChanges('## 0.2.6\n\n## 0.2.5\n- Old', '0.2.6'), /Empty/);
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const changes = releaseChanges(await readFile('CHANGELOG.md', 'utf8'), pkg.version);
  assert.ok(changes.trim().length > 0);
  const preparation = await readFile('scripts/prepare-github-release.mjs', 'utf8');
  assert.match(preparation, /releaseChanges\(await readFile\('CHANGELOG.md'/);
  assert.ok(preparation.includes('${changes}'));
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
  assert.equal(workflow.on.workflow_dispatch.inputs.acceptance_only.default, true);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const { build, publish } = workflow.jobs;
  assert.equal(build['runs-on'], 'windows-latest');
  assert.ok(build['timeout-minutes'] <= 15);
  assert.deepEqual(build.steps.find((s: { run?: string }) => s.run === 'node scripts/release-gate-local.mjs').env, {
    TEMP: '${{ runner.temp }}',
    TMP: '${{ runner.temp }}',
    TMPDIR: '${{ runner.temp }}',
  });
  const buildCommands = build.steps.map((step: { run?: string }) => step.run ?? '').join('\n');
  for (const command of [
    'github-release-context.mjs',
    'node scripts/release-gate-local.mjs',
    'release:check',
    'prepare-github-release.mjs',
  ]) {
    assert.ok(buildCommands.includes(command));
  }
  assert.equal(publish.needs, 'build');
  assert.equal(publish.if, "needs.build.outputs.publish == 'true'");
  assert.equal(build.outputs.publish, '${{ steps.context.outputs.publish }}');
  assert.equal(build.outputs.asset_name, '${{ steps.context.outputs.asset_name }}');
  const upload = build.steps.find((step: { with?: { path?: string } }) => step.with?.path === 'runs/github-release/');
  assert.equal(upload.with.name, '${{ steps.context.outputs.asset_name }}');
  assert.equal(publish.steps[0].with.name, '${{ needs.build.outputs.asset_name }}');
  const contextStep = build.steps.find((step: { id?: string }) => step.id === 'context');
  assert.equal(
    contextStep.env.RELEASE_ACCEPTANCE_ONLY,
    "${{ github.event_name == 'workflow_dispatch' && inputs.acceptance_only }}",
  );
  assert.deepEqual(publish.permissions, { contents: 'write' });
  assert.ok(publish.steps.every((step: { uses?: string }) => !step.uses?.startsWith('actions/checkout@')));
  const publishCommands = publish.steps.map((step: { run?: string }) => step.run ?? '').join('\n');
  for (const command of ['await verifyTag()', 'asset.digest', 'draft: false', 'verifyIdentity(published, false)']) {
    assert.ok(publishCommands.includes(command));
  }
  assert.doesNotMatch(publishCommands, /npm publish|--clobber|--force/);
  assert.doesNotMatch(publishCommands, /--paginate|uploaded-releases|gh release edit|releases\?per_page/);
  assert.match(publishCommands, /await api\(`releases\/\$\{id\}`\)/);
  assert.match(publishCommands, /redirect: 'error'/);
  for (const job of [build, publish]) {
    for (const step of job.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
  }
});

test('actual publisher binds create response ID, checks every asset and fails closed without replay or overwrite', async () => {
  const workflow = parse(await readFile('.github/workflows/release.yml', 'utf8'));
  const step = workflow.jobs.publish.steps.find((item: { run?: string }) => item.run?.includes("<<'NODE'"));
  const code = step.run.match(/<<'NODE'\n([\s\S]*?)\nNODE/)[1];
  const tag = 'v0.2.2';
  const head = 'a'.repeat(40);
  // Execute the exact workflow body with injected files/transport, never real GitHub writes.
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const publish = new AsyncFunction(
    'readFileSync',
    'createHash',
    'process',
    'fetch',
    'console',
    code.replace(/^import .*;\n/gm, ''),
  );
  for (const fault of [
    '',
    'receipt-head',
    'receipt-version',
    'receipt-status',
    'missing-file',
    'missing-token',
    'tag-missing',
    'tag-moved',
    'tag-moved-before-publish',
    'tag-depth',
    'existing-release',
    'create-conflict',
    'create-response-lost',
    'create-id',
    'create-tag',
    'create-public',
    'release-id',
    'release-tag',
    'release-prerelease',
    'asset-count',
    'asset-name',
    'asset-duplicate',
    'asset-size',
    'asset-state',
    'asset-digest',
    'upload-failure',
    'read-failure',
    'publish-response-lost',
    'published-draft',
  ]) {
    const receipt = {
      version: fault === 'receipt-version' ? '0.0.0' : tag.slice(1),
      status: fault === 'receipt-status' ? 'FAIL' : 'PASS',
      head: fault === 'receipt-head' ? 'b'.repeat(40) : head,
    };
    const files: Record<string, Buffer> = Object.fromEntries(
      Object.entries({
        'wheel-mcp-0.2.2.tgz': 'synthetic archive, not engine evidence',
        'sbom.json': '{}',
        'acceptance.json': JSON.stringify(receipt),
        SHA256SUMS: 'synthetic checksum fixture',
        'RELEASE-NOTES.md': '# Synthetic notes',
      }).map(([name, bytes]) => [name, Buffer.from(bytes)]),
    );
    const assets: any[] = [];
    const requests: { path: string; method: string; body: any }[] = [];
    let tagReads = 0;
    const response = (value: unknown, status = 200) => ({ ok: status < 300, status, json: async () => value });
    const identity = { id: 123, tag_name: tag, draft: true, prerelease: false };
    const transport = async (address: string, options: any) => {
      const url = new URL(address);
      assert.ok(['api.github.com', 'uploads.github.com'].includes(url.hostname));
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
      assert.ok(options.signal instanceof AbortSignal);
      const path = url.pathname.replace('/repos/owner/repo/', '');
      const method = options.method;
      const body = options.body && url.hostname === 'api.github.com' ? JSON.parse(options.body) : options.body;
      requests.push({ path, method, body });
      if (path === `git/ref/tags/${tag}`) {
        tagReads++;
        if (fault === 'tag-missing') return response({}, 404);
        if (fault === 'tag-moved' || (fault === 'tag-moved-before-publish' && tagReads === 2))
          return response({ object: { type: 'commit', sha: 'b'.repeat(40) } });
        return response({ object: { type: 'tag', sha: 'c'.repeat(40) } });
      }
      if (path === `git/tags/${'c'.repeat(40)}`)
        return response({
          object: fault === 'tag-depth' ? { type: 'tag', sha: 'c'.repeat(40) } : { type: 'commit', sha: head },
        });
      if (path === `releases/tags/${tag}`)
        return response(
          fault === 'existing-release' ? { ...identity, draft: false } : {},
          fault === 'existing-release' ? 200 : 404,
        );
      if (path === 'releases' && method === 'POST') {
        assert.equal(body.draft, true);
        assert.equal(body.target_commitish, head);
        assert.equal(body.tag_name, tag);
        if (fault === 'create-response-lost') throw new Error('Synthetic ambiguous create failure');
        if (fault === 'create-conflict') return response({}, 422);
        return response({
          ...identity,
          ...(fault === 'create-id' ? { id: '123' } : {}),
          ...(fault === 'create-tag' ? { tag_name: 'v0.0.0' } : {}),
          ...(fault === 'create-public' ? { draft: false } : {}),
        });
      }
      if (path === 'releases/123/assets' && method === 'POST') {
        assert.equal(url.hostname, 'uploads.github.com');
        assert.equal(options.headers['Content-Type'], 'application/octet-stream');
        if (fault === 'upload-failure') return response({}, 502);
        const name = url.searchParams.get('name')!;
        assert.deepEqual(body, files[name]);
        assets.push({
          name,
          size: body.length,
          state: 'uploaded',
          digest: `sha256:${createHash('sha256').update(body).digest('hex')}`,
        });
        return response(assets.at(-1), 201);
      }
      if (path === 'releases/123' && method === 'GET') {
        if (fault === 'read-failure') return response({}, 403);
        const uploaded = structuredClone(assets);
        if (fault === 'asset-count') uploaded.pop();
        if (fault === 'asset-name') uploaded[0].name = 'unexpected.tgz';
        if (fault === 'asset-duplicate') uploaded[1] = { ...uploaded[0] };
        if (fault === 'asset-size') uploaded[0].size++;
        if (fault === 'asset-state') uploaded[0].state = 'starter';
        if (fault === 'asset-digest') uploaded[0].digest = `sha256:${'0'.repeat(64)}`;
        return response({
          ...identity,
          assets: uploaded,
          ...(fault === 'release-id' ? { id: 456 } : {}),
          ...(fault === 'release-tag' ? { tag_name: 'v0.0.0' } : {}),
          ...(fault === 'release-prerelease' ? { prerelease: true } : {}),
        });
      }
      if (path === 'releases/123' && method === 'PATCH') {
        assert.deepEqual(body, { draft: false, make_latest: 'true' });
        if (fault === 'publish-response-lost') throw new Error('Synthetic ambiguous publish failure');
        return response({ ...identity, draft: fault === 'published-draft' });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    };
    const execute = () =>
      publish(
        (name: string, encoding?: string) => {
          if (fault === 'missing-file' && name === 'sbom.json') throw new Error('Synthetic missing file');
          assert.ok(files[name], `unexpected file ${name}`);
          return encoding ? files[name].toString('utf8') : files[name];
        },
        createHash,
        {
          env: {
            RELEASE_TAG: tag,
            RELEASE_SHA: head,
            GH_REPO: 'owner/repo',
            GH_TOKEN: fault === 'missing-token' ? '' : 'synthetic-token',
          },
        },
        transport,
        { log: () => undefined },
      );
    if (fault) await assert.rejects(execute, fault);
    else await assert.doesNotReject(execute);
    const mutations = requests.filter((r) => r.method !== 'GET');
    assert.ok(requests.filter((r) => r.path === 'releases').length <= 1, fault);
    assert.ok(requests.filter((r) => r.method === 'PATCH').length <= 1, fault);
    if (
      [
        'receipt-head',
        'receipt-version',
        'receipt-status',
        'missing-file',
        'missing-token',
        'tag-missing',
        'tag-moved',
        'tag-depth',
        'existing-release',
      ].includes(fault)
    )
      assert.equal(mutations.length, 0, fault);
    if (fault && !['publish-response-lost', 'published-draft'].includes(fault))
      assert.equal(
        requests.some((r) => r.method === 'PATCH'),
        false,
        fault,
      );
    if (!fault) assert.equal(mutations.length, 6);
  }
});

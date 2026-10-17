import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, mkdir, cp, writeFile, rm, realpath, lstat } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { parse } from 'yaml';

test('automatic CI is bounded and does not run the engine matrix, full tests or release gates', async () => {
  const ci = parse(await readFile('.github/workflows/ci.yml', 'utf8'));
  assert.deepEqual(Object.keys(ci.on), ['push', 'pull_request', 'workflow_dispatch']);
  assert.deepEqual(ci.on.push.branches, ['main']);
  assert.deepEqual(ci.on.pull_request.branches, ['main']);
  assert.equal(ci.on.workflow_dispatch.inputs.engine.type, 'boolean');
  assert.equal(ci.on.workflow_dispatch.inputs.engine.default, false);
  assert.equal(ci.on.workflow_dispatch.inputs.package.type, 'boolean');
  assert.equal(ci.on.workflow_dispatch.inputs.package.default, false);
  assert.deepEqual((await readdir('.github/workflows')).filter((name) => /\.ya?ml$/.test(name)).sort(), [
    'ci.yml',
    'release.yml',
  ]);
  assert.equal(ci.concurrency['cancel-in-progress'], true);
  const jobs = Object.values(ci.jobs) as Array<{
    'runs-on': string;
    'timeout-minutes': number;
    strategy?: unknown;
    steps: Array<{
      run?: string;
      if?: string;
      uses?: string;
      with?: Record<string, unknown>;
      env?: Record<string, string>;
    }>;
  }>;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]['runs-on'], 'windows-latest');
  assert.equal(jobs[0]['timeout-minutes'], 10);
  assert.equal(jobs[0].strategy, undefined);
  for (const step of jobs[0].steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
  const checkout = jobs[0].steps.find((step) => step.uses?.startsWith('actions/checkout@'))!;
  assert.equal(checkout.with?.['persist-credentials'], false);
  const automatic = jobs[0].steps.filter((step) => !/&& inputs\.(engine|package)/.test(step.if ?? ''));
  const commands = automatic.flatMap((step) => (step.run ? [step.run] : []));
  assert.ok(commands.includes('npm run check'));
  const audit = jobs[0].steps.find((step) => step.run === 'npm run audit:dependencies')!;
  assert.equal(audit.if, "github.event_name == 'workflow_dispatch' || steps.dependencies.outputs.audit == 'true'");
  assert.doesNotMatch(
    commands.join('\n'),
    /npm test|build\/tests\/\*|test:godot|soak|verify:production|matrix:generate|ci-install-godot|release:gate|test-release-package/,
  );
  const engine = jobs[0].steps.filter((step) => step.if?.includes('&& inputs.engine'));
  assert.deepEqual(
    engine.map((step) => step.run),
    ['node scripts/ci-install-godot.mjs', 'node scripts/test-godot-ci.mjs'],
  );
  for (const step of engine) assert.equal(step.if, "github.event_name == 'workflow_dispatch' && inputs.engine");
  const archive = jobs[0].steps.filter((step) => step.if?.includes('&& inputs.package'));
  assert.equal(archive.length, 1);
  assert.equal(archive[0].if, "github.event_name == 'workflow_dispatch' && inputs.package");
  assert.equal(archive[0].run, 'node scripts/test-release-package.mjs');
  for (const step of jobs[0].steps.filter(
    (s) => s.run && /npm run check|test-godot-ci|test-release-package/.test(s.run),
  )) {
    assert.deepEqual(step.env, { TEMP: '${{ runner.temp }}', TMP: '${{ runner.temp }}', TMPDIR: '${{ runner.temp }}' });
  }
  for (const step of jobs[0].steps.filter((step) => step.uses?.includes('upload-artifact'))) {
    assert.equal(step.if, 'failure()');
    assert.equal(step.with?.['retention-days'], 7);
    for (const name of ['summary.json', 'failure-summary.json', 'failure-details.txt'])
      assert.ok(String(step.with?.path).includes(`runs/ci/**/${name}`));
    assert.doesNotMatch(String(step.with?.path), /stdout|stderr|\.log/);
  }
});

test('fast CI uses an explicit non-engine test allowlist with a hard execution deadline', () => {
  const plan = JSON.parse(
    execFileSync(process.execPath, ['scripts/test-ci-fast.mjs', '--list'], { encoding: 'utf8', windowsHide: true }),
  );
  assert.equal(plan.engine, 'NOT_RUN');
  assert.equal(plan.scope, 'fast-contract-only');
  assert.equal(plan.timeoutMs, 90000);
  assert.equal(plan.concurrency, 2);
  assert.deepEqual(plan.files.slice(0, 2), [
    'build/tests/process-identity.test.js',
    'build/tests/render-window.test.js',
  ]);
  assert.equal(new Set(plan.files).size, plan.files.length);
  assert.ok(plan.files.includes('build/tests/method-authorization.test.js'));
  assert.ok(plan.files.includes('build/tests/ci-policy.test.js'));
  for (const name of [
    'stdio-client-contract',
    'mcp-launcher',
    'ui-line-edit-schema',
    'ui-scroll-schema',
    'project-write-approval',
    'preapproved-writes',
    'retry-guidance',
  ])
    assert.ok(plan.files.includes(`build/tests/${name}.test.js`));
  assert.ok(plan.files.includes('scripts/site.test.mjs'));
  assert.ok(plan.files.every((file: string) => !/soak|e2e|outcome-ledger|production-case|index-scale/.test(file)));
});

test('optional engine smoke is small and bounded; local release prep has no redundant suite or installation writes', async () => {
  const smoke = JSON.parse(
    execFileSync(process.execPath, ['scripts/test-godot-ci.mjs', '--list'], { encoding: 'utf8', windowsHide: true }),
  );
  assert.equal(smoke.engine, 'REAL_HEADLESS');
  assert.equal(smoke.timeoutMs, 60000);
  assert.equal(smoke.files.length, 5);
  assert.ok(smoke.files.every((file: string) => !/soak|authoring|outcome-ledger|production-case/.test(file)));
  const release = JSON.parse(
    execFileSync(process.execPath, ['scripts/release-gate-local.mjs', '--plan'], {
      encoding: 'utf8',
      windowsHide: true,
    }),
  );
  assert.equal(release.doesNotPublish, true);
  assert.equal(release.policy.id, 'windows-local');
  assert.equal(release.policy.totalTimeoutMs, 600000);
  for (const id of ['build', 'format', 'lint', 'core'])
    assert.ok(release.steps.some((step: { id: string }) => step.id === id));
  assert.ok(
    release.steps.every(
      (step: { program: string; args: string[] }) => !(step.program === 'npm' && step.args.includes('check')),
    ),
  );
  assert.doesNotMatch(JSON.stringify(release.steps), /verify:production|matrix:generate|test:built|soak/);
  assert.ok(release.steps.some((step: { id: string }) => step.id === 'safety'));
  assert.ok(release.steps.some((step: { id: string }) => step.id === 'package'));
  const packageRunner = await readFile('scripts/test-release-package.mjs', 'utf8');
  assert.match(packageRunner, /godotPath: process\.env\.GODOT_PATH \?\? ''/);
  assert.match(packageRunner, /timeoutMs: 40000/);
  const packageTest = await readFile('tests/package-distribution.test.ts', 'utf8');
  const consumerInstall = packageTest.slice(
    packageTest.indexOf("mark('install:start')"),
    packageTest.indexOf("mark('install:complete')"),
  );
  assert.match(consumerInstall, /'ci'/);
  assert.match(consumerInstall, /'--offline'/);
  assert.doesNotMatch(consumerInstall, /ignore-scripts|prefer-offline/);
  const safety = JSON.parse(
    execFileSync(process.execPath, ['scripts/test-local-release.mjs', '--list'], {
      encoding: 'utf8',
      windowsHide: true,
    }),
  );
  assert.ok(safety.files.includes('build/tests/editor-protocol-input.test.js'));
  assert.ok(safety.files.includes('build/tests/ui-line-edit-native.test.js'));
  assert.ok(safety.files.includes('build/tests/ui-scroll-native.test.js'));
  assert.equal(safety.concurrency, 2);
  assert.deepEqual(safety.files.slice(0, 2), [
    'build/tests/validated-project-write.test.js',
    'build/tests/editor-scene-rpc.test.js',
  ]);
  assert.deepEqual(
    [...safety.files].sort(),
    [
      'install',
      'setup',
      'project-transactions',
      'transaction-recovery',
      'owned-process',
      'streamable-http-security',
      'editor-protocol-input',
      'editor-scene-rpc',
      'editor-scene-save',
      'validated-project-write',
      'validation-cleanup',
      'editor-outcome-smoke',
      'ui-line-edit-native',
      'ui-scroll-native',
    ]
      .map((name) => `build/tests/${name}.test.js`)
      .sort(),
  );
  assert.equal(safety.timeoutMs, 240000);
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.ok(pkg.scripts.check.includes('test:ci-fast'));
  assert.ok(pkg.scripts['check:full'].includes('test:built'));
});

test('dependency audit skips unrelated changes, includes dependency edits, and fails safe on missing base/diff', async () => {
  const { dependencyDecision, needsDependencyAudit } = await import(
    pathToFileURL(path.resolve('scripts/ci-dependencies.mjs')).href
  );
  assert.equal(needsDependencyAudit(['README.md', 'src/mcp-server-sdk.ts']), false);
  for (const file of ['package.json', 'package-lock.json', '.npmrc', 'npm-shrinkwrap.json'])
    assert.equal(needsDependencyAudit([file]), true);
  assert.equal(dependencyDecision('a'.repeat(40), () => ['README.md']).audit, false);
  assert.equal(dependencyDecision('a'.repeat(40), () => ['package-lock.json']).audit, true);
  assert.equal(
    dependencyDecision('', () => {
      throw new Error('must not need diff');
    }).audit,
    true,
  );
  assert.equal(dependencyDecision('0'.repeat(40), () => []).audit, true);
  assert.equal(
    dependencyDecision('b'.repeat(40), () => {
      throw new Error('shallow base missing');
    }).audit,
    true,
  );
});

test('CI runner refuses a process-exit-zero skipped suite and preserves bounded failure diagnostics', async () => {
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-ci-control-'));
  try {
    await mkdir(path.join(root, 'scripts/lib'), { recursive: true });
    await cp('scripts/lib/json-test-reporter.mjs', path.join(root, 'scripts/lib/json-test-reporter.mjs'));
    await writeFile(
      path.join(root, 'skip.test.mjs'),
      "import test from 'node:test'; test.skip('expected negative control', () => {});\n",
    );
    const module = pathToFileURL(path.resolve('scripts/lib/ci-suite.mjs')).href;
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {runCiSuite} from ${JSON.stringify(module)}; runCiSuite({files:['skip.test.mjs'],scope:'negative-control',timeoutMs:3000});`,
      ],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000 },
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(await readFile(path.join(root, 'runs/ci/negative-control/summary.json'), 'utf8'));
    assert.equal(report.status, 'FAIL');
    assert.equal(report.processResult.exitCode, 0);
    assert.equal(report.qualification, 'NOT_QUALIFIED');
    assert.match(await readFile(path.join(root, 'runs/ci/negative-control/stdout.jsonl'), 'utf8'), /test:summary/);
    const details = await readFile(path.join(root, 'runs/ci/negative-control/failure-details.txt'), 'utf8');
    assert.match(details, /test:summary/);
    assert.ok(details.length <= 16000);
    const progress = JSON.parse(
      await readFile(path.join(root, 'runs/ci/negative-control/progress/summary.json'), 'utf8'),
    );
    assert.equal(progress.finalSummaryReceived, true);
    assert.equal(progress.files.length, 1);
    assert.equal(progress.files[0].file, 'skip.test.mjs');
    const scratch = await realpath(report.scratch);
    assert.equal(path.dirname(scratch), parent);
    assert.match(path.basename(scratch), /^wheel-ci-[A-Za-z0-9]+$/);
    assert.equal((await lstat(report.scratch)).isSymbolicLink(), false);
    await rm(scratch, { recursive: true, force: false }); // Owned synthetic control: no engine actors or business evidence.

    // Reverse lexical order must remain explicit, not be sorted by the CLI.
    await writeFile(
      path.join(root, 'z-first.test.mjs'),
      "import test from 'node:test'; test('z-first', () => { globalThis.wheelIsolationMarker = true; });\n",
    );
    await writeFile(
      path.join(root, 'a-second.test.mjs'),
      "import test from 'node:test'; import assert from 'node:assert/strict'; test('a-second', () => { assert.equal(globalThis.wheelIsolationMarker, undefined); });\n",
    );
    const ordered = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {runCiSuite} from ${JSON.stringify(module)}; runCiSuite({files:['z-first.test.mjs','a-second.test.mjs'],scope:'ordered-control',timeoutMs:5000,concurrency:1});`,
      ],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000 },
    );
    assert.equal(ordered.status, 0, ordered.stdout + ordered.stderr);
    const orderedSummary = JSON.parse(await readFile(path.join(root, 'runs/ci/ordered-control/summary.json'), 'utf8'));
    assert.deepEqual(
      orderedSummary.cases.map((c: { name: string }) => c.name),
      ['z-first', 'a-second'],
    );

    // A passing case with a live worker is not a completed suite. The bounded
    // synthetic timer expires naturally; no engine or persistent actor exists.
    await writeFile(
      path.join(root, 'held.test.mjs'),
      "import test from 'node:test'; test('held worker', () => { setTimeout(() => {}, 3000); });\n",
    );
    const held = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {runCiSuite} from ${JSON.stringify(module)}; runCiSuite({files:['held.test.mjs'],scope:'held-control',timeoutMs:1500});`,
      ],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000 },
    );
    assert.equal(held.status, 1, held.stdout + held.stderr);
    const heldSummary = JSON.parse(await readFile(path.join(root, 'runs/ci/held-control/summary.json'), 'utf8'));
    assert.equal(heldSummary.status, 'FAIL');
    assert.match(heldSummary.processResult.error, /ETIMEDOUT/);
    const heldProgress = JSON.parse(
      await readFile(path.join(root, 'runs/ci/held-control/progress/summary.json'), 'utf8'),
    );
    assert.equal(heldProgress.finalSummaryReceived, false);
    const heldScratch = await realpath(heldSummary.scratch);
    assert.equal(path.dirname(heldScratch), parent);
    assert.match(path.basename(heldScratch), /^wheel-ci-[A-Za-z0-9]+$/);
    assert.equal((await lstat(heldScratch)).isSymbolicLink(), false);
    await rm(heldScratch, { recursive: true, force: false }); // Owned engine-free timeout control only.
  } finally {
    const exact = await realpath(root);
    assert.equal(path.dirname(exact), parent);
    assert.match(path.basename(exact), /^wheel-ci-control-[A-Za-z0-9]+$/);
    assert.equal((await lstat(root)).isSymbolicLink(), false);
    await rm(exact, { recursive: true, force: false });
  }
});

test('engine smoke cannot silently skip a missing Godot executable', () => {
  const result = spawnSync(process.execPath, ['scripts/test-godot-ci.mjs'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
    env: { ...process.env, GODOT_PATH: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /engine smoke NOT_RUN/);
});

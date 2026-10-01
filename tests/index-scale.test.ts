import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateContextCorpus, CONTEXT_CORPUS } from './helpers/context-corpus.js';
import { getProjectIndex } from '../src/index/project-index.js';
import { searchProject } from '../src/godot-development.js';
import { buildContextPack } from '../src/context-pack.js';
import { createTimeoutContext } from '../src/timeout.js';

test('T26 frozen 1k corpus retrieves 30 file/symbol/node targets without expected-answer injection', async () => {
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, 'wheel-t26-scale-'));
  try {
    const corpus = await generateContextCorpus(root, 1000);
    assert.equal(corpus.questions.length, 30);
    assert.equal(new Set(corpus.questions.map((q) => q.id)).size, 30);
    assert.equal(corpus.eventCount, 12000);
    const index = await getProjectIndex(root);
    const first = await index.refresh();
    assert.equal(first.files.length, 1000);
    assert.equal(first.files.filter((f) => f.path.startsWith('.harness/')).length, 0);
    for (const question of corpus.questions) {
      const result = await searchProject(root, question.query, { maxResults: CONTEXT_CORPUS.topK });
      assert.ok(
        result.results.some((item) => item.path === question.expectedFile),
        question.id,
      );
      if (question.kind !== 'file') {
        const metadata = first.files.find((f) => f.path === question.expectedFile)!.metadata;
        const names = question.kind === 'symbol' ? metadata.symbols : metadata.nodes;
        assert.ok(
          names.some((item) => item.name === question.expectedName),
          question.id,
        );
      }
    }
    const target = corpus.questions.find((q) => q.kind === 'symbol')!;
    const pack = await buildContextPack({
      projectPath: root,
      evidenceDir: path.join(root, '.harness'),
      targets: [target.expectedFile],
      fields: ['snippets'],
      maxBytes: 1024,
      anchors: [{ file: target.expectedFile, kind: 'symbol', name: target.expectedName }],
    });
    assert.ok(Buffer.byteLength(JSON.stringify(pack)) <= 1024);
    const before = index.readSnapshot()!;
    await writeFile(path.join(root, target.expectedFile), `extends Node\nfunc updated_target():\n\tpass\n`);
    const changed = await index.refresh();
    assert.notEqual(changed.sourceHash, before.sourceHash);
    assert.equal(changed.stats.readFiles, 1);
    assert.equal(changed.stats.reusedFiles, 999);
    const timeout = createTimeoutContext(10000);
    timeout.cancel();
    try {
      await assert.rejects(index.refresh(timeout), { code: 'CANCELLED' });
    } finally {
      timeout.dispose();
    }
    assert.equal(index.readSnapshot()!.sourceHash, changed.sourceHash);
    index.stopWatching();
  } finally {
    const actual = await realpath(root);
    assert.equal(path.dirname(actual), parent);
    assert.ok(path.basename(actual).startsWith('wheel-t26-scale-'));
    await rm(actual, { recursive: true, force: true });
  }
});

test('T26 generator refuses workloads outside the frozen sizes before writing', async () => {
  await assert.rejects(generateContextCorpus('unused-no-write', 50001));
  await assert.rejects(generateContextCorpus('unused-no-write', 1000, -1));
});

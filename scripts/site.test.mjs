import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDeck, advanceSnake, pickFood, canTurn, circleHitsRect } from '../docs/site/game-core.js';
const docs = fileURLToPath(new URL('../docs/', import.meta.url));
async function collect(dir) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const entry = path.join(dir, item.name);
    if (item.isDirectory()) files.push(...(await collect(entry)));
    else files.push(entry);
  }
  return files;
}
test('all static page assets, internal links and fragments resolve within docs', async () => {
  const files = (await collect(docs)).filter((p) => p.endsWith('.html'));
  assert.equal(files.length, 6);
  assert.ok(!files.includes(path.join(docs, 'guide.html')));
  for (const file of files) {
    const html = await readFile(file, 'utf8');
    assert.doesNotMatch(html, /guide\.html/, `${file}: deleted guide page is still linked`);
    assert.match(html, /<html lang="zh-CN">/);
    assert.match(html, /name="viewport"/);
    for (const [, link] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^https?:/.test(link)) continue;
      assert.ok(!link.startsWith('/'), `${file}: root-relative URL ${link}`);
      const [resource, fragment] = link.split('#');
      let target = resource ? path.resolve(path.dirname(file), resource) : file;
      assert.ok(!path.relative(docs, target).startsWith('..'), `${link} escapes docs`);
      if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
      await stat(target);
      if (fragment)
        assert.ok((await readFile(target, 'utf8')).includes(`id="${fragment}"`), `${link} fragment missing`);
    }
  }
});
test('public onboarding documents resolve local links and expose the existing website', async () => {
  const root = path.dirname(docs.slice(0, -1));
  const documents = [
    'README.md',
    'README.zh-CN.md',
    'SECURITY.md',
    'docs/README.md',
    'docs/GETTING-STARTED.md',
    'docs/GETTING-STARTED.zh-CN.md',
    'docs/TROUBLESHOOTING.md',
    'docs/AGENT-COMPATIBILITY.md',
    'docs/WEBSITE.md',
  ];
  for (const name of documents) {
    const file = path.join(root, name);
    const text = await readFile(file, 'utf8');
    for (const [, link] of text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
      if (/^(?:https?:|mailto:|#)/.test(link)) continue;
      const resource = link.split('#')[0];
      const target = path.resolve(path.dirname(file), resource);
      assert.ok(!path.relative(root, target).startsWith('..'), `${name}: ${link} escapes repository`);
      await stat(target);
    }
  }
  for (const name of ['README.md', 'README.zh-CN.md']) {
    const text = await readFile(path.join(root, name), 'utf8');
    assert.ok(text.includes('https://evedensity.github.io/Wheel-Mcp/'));
    assert.ok(text.includes('releases/tag/v0.2.0'));
    assert.doesNotMatch(text, /status-preview|CI\/CD is paused|暂停 GitHub CI\/CD/);
  }
});
test('homepage links directly to rendered documentation and bilingual onboarding keeps the same restricted entry', async () => {
  const homepage = await readFile(path.join(docs, 'index.html'), 'utf8');
  assert.match(homepage, /https:\/\/github\.com\/EVEDensity\/Wheel-Mcp\/blob\/main\/docs\/README\.md/);
  const entries = await Promise.all(
    ['GETTING-STARTED.md', 'GETTING-STARTED.zh-CN.md'].map(async (name) => {
      const text = await readFile(path.join(docs, name), 'utf8');
      const json = text.match(/```json\r?\n([\s\S]*?)\r?\n```/);
      assert.ok(json, `${name}: missing server entry`);
      return JSON.parse(json[1]);
    }),
  );
  assert.deepEqual(entries[0], entries[1]);
  assert.equal(entries[0].env.MCP_STDIO_SCOPES, 'read');
  assert.ok(entries[0].env.MCP_STDIO_PROJECT_ROOTS);
  assert.ok(entries[0].env.MCP_STDIO_EVIDENCE_ROOTS);
});
test('deck contains exactly eight pairs and supports deterministic shuffling', () => {
  const deck = makeDeck(() => 0.5);
  assert.equal(deck.length, 16);
  assert.equal(new Set(deck).size, 8);
  for (const card of new Set(deck)) assert.equal(deck.filter((c) => c === card).length, 2);
  assert.deepEqual(
    makeDeck(() => 0.5),
    deck,
  );
});
test('snake moves, grows, rejects boundaries and self-collisions', () => {
  const body = [
    { x: 3, y: 1 },
    { x: 2, y: 1 },
    { x: 1, y: 1 },
  ];
  assert.equal(advanceSnake(body, { x: 1, y: 0 }, { x: 4, y: 1 }).body.length, 4);
  assert.equal(advanceSnake(body, { x: 0, y: 1 }, null).body.length, 3);
  assert.equal(advanceSnake(body, { x: -1, y: 0 }, null).dead, true);
  assert.equal(advanceSnake([{ x: 0, y: 0 }], { x: -1, y: 0 }, null).dead, true);
  assert.equal(
    advanceSnake(
      [
        { x: 1, y: 0 },
        { x: 0, y: 0 },
      ],
      { x: -1, y: 0 },
      null,
    ).dead,
    false,
  );
  assert.equal(canTurn({ x: 1, y: 0 }, { x: -1, y: 0 }), false);
  assert.equal(canTurn({ x: 1, y: 0 }, { x: 0, y: 1 }), true);
});
test('food never spawns on snake and full board is a win', () => {
  const body = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  assert.deepEqual(pickFood(body, 2, 2), { x: 1, y: 1 });
  assert.equal(pickFood([...body, { x: 1, y: 1 }], 2, 2), null);
});
test('brick collision includes edge hits and excludes far-away balls', () => {
  const rect = { x: 20, y: 20, w: 50, h: 10 };
  assert.equal(circleHitsRect({ x: 18, y: 25, r: 3 }, rect), true);
  assert.equal(circleHitsRect({ x: 0, y: 0, r: 3 }, rect), false);
});

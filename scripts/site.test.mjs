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
  assert.equal(files.length, 7);
  for (const file of files) {
    const html = await readFile(file, 'utf8');
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

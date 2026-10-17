import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, link, mkdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sceneOperationsSchema } from '../src/editor/scene-service.js';
import { readAnimationSource } from '../src/editor/animation-source.js';
import { verifySceneDependencies } from '../src/editor/scene-dependencies.js';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const copy = {
  kind: 'animation_copy',
  path: 'Animator',
  sourcePath: 'res://walk.tres',
  sourceHash: 'a'.repeat(64),
  clipId: 'walk',
  targets: { Imported: 'Hero' },
};
test('animation copy requires an explicit hash, clip identity and bounded mapping, never importer options', () => {
  assert.equal(sceneOperationsSchema.safeParse([copy]).success, true);
  for (const extra of [
    { sourceHash: undefined },
    { sourceHash: 'z'.repeat(64) },
    { clipId: '../bad' },
    { targets: {} },
    { targets: { Imported: '' } },
    { targets: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`Source${i}`, 'Hero'])) },
    { clips: [] },
    { importer: 'fbx' },
    { script: 'payload' },
    { policy: 'overwrite' },
  ])
    assert.equal(sceneOperationsSchema.safeParse([{ ...copy, ...extra }]).success, false);
});
test('animation source rejects traversal, protected, absolute, hard-linked and junction paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-animation-source-'));
  const bytes = Buffer.from('[gd_resource type="Animation" format=3]\n\n[resource]\n');
  await writeFile(path.join(root, 'walk.tres'), bytes);
  assert.equal((await readAnimationSource(root, 'walk.tres', sha(bytes))).resourcePath, 'res://walk.tres');
  for (const input of [
    '../walk.tres',
    path.join(root, 'walk.tres'),
    '.git/walk.tres',
    '.godot/walk.tres',
    '.harness/walk.tres',
    'uid://bad',
    'walk.tres:stream',
    'walk.tres\u0000',
  ])
    await assert.rejects(readAnimationSource(root, input, sha(bytes)), { code: 'FORBIDDEN' });
  await link(path.join(root, 'walk.tres'), path.join(root, 'linked.tres'));
  await assert.rejects(readAnimationSource(root, 'linked.tres', sha(bytes)), { code: 'FORBIDDEN' });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'wheel-animation-outside-'));
  await writeFile(path.join(outside, 'walk.tres'), bytes);
  await mkdir(path.join(root, 'assets'));
  await symlink(outside, path.join(root, 'assets/link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readAnimationSource(root, 'assets/link/walk.tres', sha(bytes)), { code: 'FORBIDDEN' });
});
test('animation source bounds bytes and UTF-8 without decoding or executing native resource contents', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-animation-bytes-'));
  const file = path.join(root, 'walk.tres');
  for (const [bytes, code] of [
    [Buffer.alloc(16385), 'UNSUPPORTED'],
    [Buffer.from([0xff, 0xfe]), 'UNSUPPORTED'],
  ] as const) {
    await writeFile(file, bytes);
    await assert.rejects(readAnimationSource(root, 'walk.tres', sha(bytes)), { code });
    assert.deepEqual(await readFile(file), bytes);
  }
  // The native inert parser, not this byte reader, rejects executable syntax.
  const inert = Buffer.from('script = ExtResource("never-load")');
  await writeFile(file, inert);
  await readAnimationSource(root, 'walk.tres', sha(inert));
  assert.deepEqual(await readFile(file), inert);
});
test('animation source dependency CAS checks exact current bytes and retains the combined dependency budget', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-animation-cas-'));
  const bytes = Buffer.from('original'),
    file = path.join(root, 'walk.tres');
  await writeFile(file, bytes);
  await verifySceneDependencies(root, { 'res://walk.tres': sha(bytes) });
  await writeFile(file, Buffer.from('changed'));
  await assert.rejects(verifySceneDependencies(root, { 'res://walk.tres': sha(bytes) }), { code: 'CONFLICT' });
  assert.equal(await readFile(file, 'utf8'), 'changed');
  await assert.rejects(
    verifySceneDependencies(
      root,
      Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`res://${i}.tres`, 'a'.repeat(64)])),
    ),
    { code: 'UNSUPPORTED' },
  );
});

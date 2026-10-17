import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, link, mkdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resourceRequestSchema } from '../src/editor/resource-service.js';
import { readTexturePng, validateTexturePng } from '../src/editor/png-source.js';
import { verifySceneDependencies } from '../src/editor/scene-dependencies.js';
import { pixelPng, pngChunk } from './helpers/png-fixture.js';
import { editorStateSchema } from '../src/editor/editor-bridge.js';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('PNG source action requires an explicit fingerprint and never accepts host buffers or importer settings', () => {
  // Native progress is normalized by the producer, not by weakening this boundary.
  assert.equal(
    editorStateSchema.shape.filesystem.safeParse({ scanning: false, importing: false, progress: 1.85 }).success,
    false,
  );
  assert.equal(
    resourceRequestSchema.safeParse({ action: 'png_texture', path: 'res://icon.png', sourceHash: 'a'.repeat(64) })
      .success,
    true,
  );
  for (const extra of [{ sourceHash: 'x' }, { dataBase64: 'AAAA' }, { importer: 'anything' }, { source: {} }])
    assert.equal(
      resourceRequestSchema.safeParse({ action: 'png_texture', path: 'icon.png', sourceHash: 'a'.repeat(64), ...extra })
        .success,
      false,
    );
});
test('bounded PNG decoder checks real RGB/RGBA pixels, CRC, dimensions and rejects profile/animation chunks', () => {
  for (const rgb of [false, true])
    assert.equal(validateTexturePng(pixelPng(2, 1, rgb)).rgba.toString('hex'), 'ff0000ff0000ffff');
  assert.equal(validateTexturePng(pixelPng(32, 32)).rgba.length, 4096);
  assert.throws(() => validateTexturePng(pixelPng(33, 1)), { code: 'UNSUPPORTED' });
  assert.throws(() => validateTexturePng(Buffer.alloc(16385)), { code: 'INVALID_ARGUMENT' });
  const crc = Buffer.from(pixelPng());
  crc[crc.length - 1] ^= 1;
  assert.throws(() => validateTexturePng(crc), { code: 'INVALID_ARGUMENT' });
  const truncated = pixelPng().subarray(0, -1);
  assert.throws(() => validateTexturePng(truncated), { code: 'INVALID_ARGUMENT' });
  for (const name of ['iCCP', 'gAMA', 'acTL', 'tEXt']) {
    const image = pixelPng();
    assert.throws(
      () =>
        validateTexturePng(
          Buffer.concat([image.subarray(0, 33), pngChunk(name, Buffer.from('data')), image.subarray(33)]),
        ),
      { code: 'UNSUPPORTED' },
    );
  }
});
test('PNG source reads refuse protected, absolute, traversal, hard-linked and junction paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-png-'));
  const bytes = pixelPng(),
    hash = sha(bytes);
  await writeFile(path.join(root, 'icon.png'), bytes);
  assert.equal((await readTexturePng(root, 'icon.png', hash)).resourcePath, 'res://icon.png');
  for (const input of [
    '../icon.png',
    path.join(root, 'icon.png'),
    '.harness/icon.png',
    '.git/icon.png',
    '.godot/icon.png',
    'uid://anything',
  ])
    await assert.rejects(readTexturePng(root, input, hash), { code: 'FORBIDDEN' });
  await link(path.join(root, 'icon.png'), path.join(root, 'linked.png'));
  await assert.rejects(readTexturePng(root, 'linked.png', hash), { code: 'FORBIDDEN' });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'wheel-png-outside-'));
  await writeFile(path.join(outside, 'icon.png'), bytes);
  await mkdir(path.join(root, 'assets'));
  await symlink(outside, path.join(root, 'assets/link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readTexturePng(root, 'assets/link/icon.png', hash), { code: 'FORBIDDEN' });
});
test('PNG dependencies enforce current source hashes and the existing combined 32-file budget', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-png-'));
  const bytes = pixelPng(),
    file = path.join(root, 'icon.png');
  await writeFile(file, bytes);
  await verifySceneDependencies(root, { 'res://icon.png': sha(bytes) });
  await writeFile(file, pixelPng(1, 1));
  await assert.rejects(verifySceneDependencies(root, { 'res://icon.png': sha(bytes) }), { code: 'CONFLICT' });
  await assert.rejects(
    verifySceneDependencies(
      root,
      Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`res://${i}.png`, 'a'.repeat(64)])),
    ),
    { code: 'UNSUPPORTED' },
  );
});

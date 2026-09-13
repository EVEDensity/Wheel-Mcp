import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { compareScreenshots } from '../src/godot-development.js';
function png(pixels: number[]) {
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const n of b) {
      c ^= n;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const b = Buffer.alloc(data.length + 12);
    b.writeUInt32BE(data.length);
    body.copy(b, 4);
    b.writeUInt32BE(crc(body), b.length - 4);
    return b;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, ...pixels]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
test('RGBA diff computes ratio, tolerance, alpha and bounding box, writes a valid diff image', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pixel-diff-'));
  const a = path.join(root, 'a.png'),
    b = path.join(root, 'b.png'),
    diff = path.join(root, 'diff.png');
  await writeFile(a, png([10, 20, 30, 255, 50, 60, 70, 255]));
  await writeFile(b, png([10, 20, 30, 0, 59, 60, 70, 255]));
  const r = await compareScreenshots(a, b, { threshold: 8, ignoreAlpha: true, writeDiff: true, diffPath: diff });
  assert.equal(r.differenceRatio, 0.5);
  assert.deepEqual(r.boundingBox, { left: 1, top: 0, right: 1, bottom: 0 });
  assert.equal((await compareScreenshots(diff, diff)).same, true);
  assert.equal((await compareScreenshots(a, b, { threshold: 9, ignoreAlpha: true })).same, true);
  assert.equal((await compareScreenshots(a, b, { threshold: 8, ignoreAlpha: false })).differentPixels, 2);
  const corrupt = await readFile(b);
  corrupt[20] ^= 1;
  await writeFile(b, corrupt);
  await assert.rejects(compareScreenshots(a, b), /CRC/);
  await writeFile(b, png([1, 2, 3, 4, 5, 6, 7, 8]).subarray(0, -4));
  await assert.rejects(compareScreenshots(a, b), /truncated/);
  await writeFile(b, Buffer.from('not a screenshot'));
  await assert.rejects(compareScreenshots(a, b), /PNG/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EvidenceLog } from '../src/evidence-log.js';

test('log rotation preserves ordered bytes and bounds memory without splitting UTF-8 tail', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wheel-log-'));
  const logs = await EvidenceLog.create(directory, { segmentBytes: 19, tailBytes: 10, maxSegments: 10 });
  const text = '开始—alpha—结束\n'.repeat(3);
  logs.append('stdout', text);
  await logs.drain();
  const segments = (await readdir(directory)).filter((n) => n.startsWith('stdout.')).sort();
  const ordered = [...segments.filter((n) => n !== 'stdout.log'), 'stdout.log'];
  const bytes = Buffer.concat(await Promise.all(ordered.map((n) => readFile(path.join(directory, n)))));
  assert.equal(bytes.toString('utf8'), text);
  assert.ok(Buffer.byteLength(logs.tail('stdout')) <= 10);
  assert.equal(logs.tail('stdout').includes('\ufffd'), false);
});

test('log quota reports failure and preserves previously written evidence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wheel-log-quota-'));
  const logs = await EvidenceLog.create(directory, { segmentBytes: 8, maxSegments: 1 });
  logs.append('stderr', '12345678901234567890');
  await assert.rejects(logs.drain(), /quota exhausted/);
  const files = (await readdir(directory)).filter((n) => n.startsWith('stderr.'));
  const lengths = await Promise.all(files.map(async (n) => (await readFile(path.join(directory, n))).length));
  assert.equal(
    lengths.reduce((a, b) => a + b, 0),
    16,
  );
});

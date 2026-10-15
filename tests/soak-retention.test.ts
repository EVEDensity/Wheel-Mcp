import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, link, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { retainStoppedSoakShadow } from '../src/soak-retention.js';

/** Explicit synthetic native metadata for retention unit controls, NOT actual engine qualification. */
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'wheel-soak-retention-unit-')));
  const dir = path.join(root, '.harness/shadow/cycle-0');
  await mkdir(dir, { recursive: true });
  const meta = {
    source: 'REAL',
    run_id: 'synthetic-unit-shadow',
    pid: 2147483000,
    project_path: root,
    lifecycle: 'STOPPED',
    exit_code: 0,
    signal: null,
    timed_out: false,
    cancelled: false,
    evidence_status: 'COMPLETE',
    finished_at: '2026-10-09T00:00:00Z',
  };
  for (const [name, data] of Object.entries({
    'process.json': JSON.stringify(meta),
    'manifest.json': JSON.stringify({
      source: 'REAL',
      lifecycle: 'STOPPED',
      evidence_status: 'COMPLETE',
      evidence_dir: dir,
    }),
    'persistent.json': JSON.stringify({ source: 'REAL', session_id: meta.run_id, pid: meta.pid, project_path: root }),
    'events.jsonl': '',
    'godot.log': 'synthetic successful log',
    'requests.jsonl': '',
    'responses.jsonl': '',
    'startup.json': '{}',
    'stderr.log': '',
    'stdout.log': '',
  }))
    await writeFile(path.join(dir, name), data);
  return {
    root,
    dir,
    meta,
    input: { projectRoot: root, cycle: 0, sessionId: meta.run_id, pid: meta.pid, forced: false, exitCode: 0 },
  };
}
test('T31 retention archives terminal shadow before exact ten-file removal; preserves other evidence', async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, 'keep.gd'), 'user-like critical content');
  let archived = false;
  const result = await retainStoppedSoakShadow(f.input, async (s) => {
    assert.equal((await readdir(f.dir)).length, 10);
    assert.equal(s.files.length, 10);
    assert.equal(s.process.run_id, f.meta.run_id);
    archived = true;
  });
  assert.equal(archived, true);
  assert.equal(result.removedFiles, 10);
  assert.equal(result.files.length, 10);
  await assert.rejects(readdir(f.dir), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(f.root, 'keep.gd'), 'utf8'), 'user-like critical content');
});
test('T31 retention refuses live PID, failed/incomplete/foreign terminal records and forced stop', async () => {
  for (const mutate of [
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.input.pid = process.pid;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.input.forced = true;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.meta.lifecycle = 'RUNNING';
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.meta.exit_code = 1;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.meta.run_id = 'foreign';
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.meta.cancelled = true;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.meta.evidence_status = 'INCOMPLETE';
    },
  ]) {
    const f = await fixture();
    mutate(f);
    await writeFile(path.join(f.dir, 'process.json'), JSON.stringify(f.meta));
    await assert.rejects(
      retainStoppedSoakShadow(f.input, async () => {
        throw Error('Must not archive invalid data');
      }),
    );
    assert.equal((await readdir(f.dir)).length, 10);
  }
});
test('T31 retention preserves engine errors and unexpected files', async () => {
  for (const name of ['godot.log', 'unexpected.json']) {
    const f = await fixture();
    await writeFile(path.join(f.dir, name), 'ERROR: native failure');
    await assert.rejects(retainStoppedSoakShadow(f.input, async () => {}));
    assert.ok((await readdir(f.dir)).includes('process.json'));
  }
});
test('T31 archive failure or changed evidence removes no raw files', async () => {
  for (const changed of [false, true]) {
    const f = await fixture();
    await assert.rejects(
      retainStoppedSoakShadow(f.input, async () => {
        if (changed) await writeFile(path.join(f.dir, 'godot.log'), 'changed after snapshot');
        else throw Error('SIMULATED archive write failure');
      }),
    );
    assert.equal((await readdir(f.dir)).length, 10);
  }
});
test('T31 retention path/cycle traversal rejects before any deletion', async () => {
  const f = await fixture();
  for (const cycle of [-1, NaN, '../other' as unknown as number])
    await assert.rejects(retainStoppedSoakShadow({ ...f.input, cycle }, async () => {}));
  assert.equal((await readdir(f.dir)).length, 10);
});
test('T31 retention refuses a hard-linked evidence file without touching its other name', async () => {
  const f = await fixture();
  const outside = path.join(f.root, 'keep.log');
  await writeFile(outside, 'critical unrelated log');
  await unlink(path.join(f.dir, 'godot.log'));
  await link(outside, path.join(f.dir, 'godot.log'));
  await assert.rejects(retainStoppedSoakShadow(f.input, async () => {}));
  assert.equal((await readdir(f.dir)).length, 10);
  assert.equal(await readFile(outside, 'utf8'), 'critical unrelated log');
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
// Read-only existence probe; do not import runtime/registry modules into this filesystem-only helper.
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

const names = [
  'events.jsonl',
  'godot.log',
  'manifest.json',
  'persistent.json',
  'process.json',
  'requests.jsonl',
  'responses.jsonl',
  'startup.json',
  'stderr.log',
  'stdout.log',
].sort();
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const samePath = (a: string, b: string) =>
  process.platform === 'win32'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);

/** TEST WORKER ONLY: archive a successful, quiescent shadow before removing its exact regular files.
 * Never prunes failures, journals, validation, performance samples or a persistent actor's evidence.
 * This is not an atomic multi-file operation or protection against arbitrary concurrent OS mutation.
 */
export async function retainStoppedSoakShadow(
  input: { projectRoot: string; cycle: number; sessionId: string; pid: number; forced: boolean; exitCode: number },
  archive: (snapshot: {
    directory: string;
    files: Array<{ name: string; bytes: Buffer; sha256: string }>;
    process: Record<string, any>;
  }) => Promise<void>,
) {
  assert.ok(Number.isSafeInteger(input.cycle) && input.cycle >= 0);
  assert.ok(Number.isSafeInteger(input.pid) && input.pid > 0);
  assert.equal(input.forced, false);
  assert.equal(input.exitCode, 0);
  assert.equal(running(input.pid), false, 'Do not prune a live or reused PID');
  const root = path.resolve(input.projectRoot);
  assert.ok(samePath(await realpath(root), root), 'Fixture root must be canonical');
  assert.equal((await lstat(root)).isSymbolicLink(), false);
  let directory = root;
  for (const component of ['.harness', 'shadow', `cycle-${input.cycle}`]) {
    directory = path.join(directory, component);
    const info = await lstat(directory);
    assert.equal(info.isSymbolicLink(), false);
    assert.equal(info.isDirectory(), true);
    assert.ok(samePath(await realpath(directory), directory));
  }
  assert.deepEqual((await readdir(directory)).sort(), names, 'Unexpected shadow evidence must be preserved');
  const files: Array<{ name: string; bytes: Buffer; sha256: string; ino: number; dev: number }> = [];
  for (const name of names) {
    const file = path.join(directory, name),
      info = await lstat(file);
    assert.equal(info.isSymbolicLink(), false);
    assert.equal(info.isFile(), true);
    assert.equal(info.nlink, 1);
    assert.ok(info.size <= 1024 * 1024, 'Shadow file archive quota exceeded');
    const bytes = await readFile(file);
    files.push({ name, bytes, sha256: hash(bytes), ino: info.ino, dev: info.dev });
  }
  const json = (name: string) =>
    JSON.parse(files.find((f) => f.name === name)!.bytes.toString()) as Record<string, any>;
  const processRecord = json('process.json'),
    manifest = json('manifest.json'),
    persistent = json('persistent.json');
  assert.equal(processRecord.source, 'REAL');
  assert.equal(processRecord.run_id, input.sessionId);
  assert.equal(processRecord.pid, input.pid);
  assert.ok(samePath(processRecord.project_path, root));
  assert.equal(processRecord.lifecycle, 'STOPPED');
  assert.equal(processRecord.exit_code, 0);
  assert.equal(processRecord.signal, null);
  assert.equal(processRecord.timed_out, false);
  assert.equal(processRecord.cancelled, false);
  assert.equal(processRecord.evidence_status, 'COMPLETE');
  assert.ok(Number.isFinite(Date.parse(processRecord.finished_at)));
  assert.equal(manifest.source, 'REAL');
  assert.equal(manifest.lifecycle, 'STOPPED');
  assert.equal(manifest.evidence_status, 'COMPLETE');
  assert.ok(samePath(manifest.evidence_dir, directory));
  assert.equal(persistent.source, 'REAL');
  assert.equal(persistent.session_id, input.sessionId);
  assert.equal(persistent.pid, input.pid);
  assert.ok(samePath(persistent.project_path, root));
  for (const name of ['godot.log', 'stderr.log', 'stdout.log'])
    assert.doesNotMatch(
      files.find((f) => f.name === name)!.bytes.toString(),
      /SCRIPT ERROR|\bERROR:|ObjectDB instances leaked|resources still in use/,
    );
  // Durable archive success is a prerequisite. An archive failure removes nothing.
  await archive({ directory, files, process: processRecord });
  assert.equal(running(input.pid), false);
  assert.deepEqual((await readdir(directory)).sort(), names);
  for (const f of files) {
    const info = await lstat(path.join(directory, f.name));
    assert.equal(info.isSymbolicLink(), false);
    assert.equal(info.isFile(), true);
    assert.equal(info.nlink, 1);
    assert.equal(info.ino, f.ino);
    assert.equal(info.dev, f.dev);
    assert.equal(hash(await readFile(path.join(directory, f.name))), f.sha256, 'Evidence changed during archive');
  }
  // Exact files only, no recursive deletion or ancestor cleanup.
  for (const f of files) await unlink(path.join(directory, f.name));
  await rmdir(directory);
  return {
    sessionId: input.sessionId,
    pid: input.pid,
    lifecycle: 'STOPPED',
    exitCode: 0,
    files: files.map((f) => ({ name: f.name, bytes: f.bytes.length, sha256: f.sha256 })),
    retained: 'All file hashes and terminal process record; first/latest raw shadow slots archived',
    removedFiles: files.length,
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cancelProcess, launchProject, stopProcess } from '../src/godot-runtime.js';
import { ensureEvidenceManifest } from '../src/evidence.js';

const posixOnly = { skip: process.platform === 'win32' ? 'fake Godot is a POSIX shell script' : false };

async function fakeGodot(body: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-process-evidence-'));
  const executable = path.join(root, 'fake-godot.sh');
  await writeFile(executable, `#!/bin/sh\n${body}\n`);
  await chmod(executable, 0o755);
  return { root, executable, evidenceDir: path.join(root, 'evidence') };
}

async function readJson(file: string) {
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
}

test('process evidence manifest lists only files a script run produces', posixOnly, async () => {
  const { root, executable, evidenceDir } = await fakeGodot('exit 0');
  const launch = await launchProject({ godotPath: executable, projectPath: root, evidenceDir, headless: true });
  await launch.close;
  const manifest = await readJson(path.join(evidenceDir, 'manifest.json'));
  assert.equal(manifest.profile, 'PROCESS_EVIDENCE');
  assert.equal(manifest.lifecycle, 'EXITED');
  assert.equal('request_file' in manifest, false);
  assert.equal('response_file' in manifest, false);
  assert.equal('events_file' in manifest, false);
  const metadata = await readJson(path.join(evidenceDir, 'process.json'));
  assert.equal(metadata.exit_code, 0);
  assert.equal(metadata.signal, null);
});

test('bridge evidence manifest still lists request, response and events files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-bridge-evidence-'));
  const manifest = await ensureEvidenceManifest(root, 'BRIDGE_EVIDENCE');
  assert.equal(manifest.request_file, path.join(root, 'request.json'));
  assert.equal(manifest.response_file, path.join(root, 'response.json'));
  assert.equal(manifest.events_file, path.join(root, 'events.jsonl'));
});

test('a process killed outside wheel records the signal', posixOnly, async () => {
  const { root, executable, evidenceDir } = await fakeGodot('exec sleep 30');
  const launch = await launchProject({ godotPath: executable, projectPath: root, evidenceDir, headless: true });
  process.kill(launch.child.pid!, 'SIGKILL');
  await launch.close;
  const metadata = await readJson(path.join(evidenceDir, 'process.json'));
  assert.equal(metadata.lifecycle, 'FAILED');
  assert.equal(metadata.exit_code, null);
  assert.equal(metadata.signal, 'SIGKILL');
});

test('stop_project keeps STOPPED instead of being overwritten by FAILED', posixOnly, async () => {
  const { root, executable, evidenceDir } = await fakeGodot('exec sleep 30');
  const launch = await launchProject({ godotPath: executable, projectPath: root, evidenceDir, headless: true });
  const result = await stopProcess(launch.child.pid!);
  assert.equal(result.stopped, true);
  await launch.close;
  const metadata = await readJson(path.join(evidenceDir, 'process.json'));
  assert.equal(metadata.lifecycle, 'STOPPED');
  assert.equal(metadata.cancelled, false);
  assert.equal(typeof metadata.signal, 'string');
  const manifest = await readJson(path.join(evidenceDir, 'manifest.json'));
  assert.equal(manifest.lifecycle, 'STOPPED');
});

test('cancel_project records CANCELLED', posixOnly, async () => {
  const { root, executable, evidenceDir } = await fakeGodot('exec sleep 30');
  const launch = await launchProject({ godotPath: executable, projectPath: root, evidenceDir, headless: true });
  await cancelProcess(launch.child.pid!);
  await launch.close;
  const metadata = await readJson(path.join(evidenceDir, 'process.json'));
  assert.equal(metadata.lifecycle, 'CANCELLED');
  assert.equal(metadata.cancelled, true);
});

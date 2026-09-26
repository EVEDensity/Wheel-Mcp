import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { executeDevelopmentLoop } from '../src/development-loop.js';
import { PersistentRuntimeBridge } from '../src/persistent-runtime-bridge.js';
import { createTimeoutContext } from '../src/timeout.js';

async function fixture(script: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shutdown-real-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
  await writeFile(
    path.join(root, 'main.tscn'),
    '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n',
  );
  await writeFile(path.join(root, 'main.gd'), script);
  return {
    projectPath: root,
    bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
    godotPath: process.env.GODOT_PATH,
    evidenceDir: path.join(root, 'evidence'),
    maxRetries: 0,
    timeoutMs: 15000,
    checks: [{ id: 'loaded', method: 'get_scene_tree' as const, path: 'nodes', op: 'exists' as const }],
  };
}
test(
  'real audio playback is released before exit; strict shutdown retains deliberate exit errors and avoids false-positive leak detection',
  { skip: !process.env.GODOT_PATH, timeout: 60000 },
  async () => {
    const input = await fixture(
      'extends Node\nfunc _ready():\n\tfor kind in [AudioStreamPlayer, AudioStreamPlayer2D, AudioStreamPlayer3D]:\n\t\tvar audio = kind.new()\n\t\taudio.stream = AudioStreamGenerator.new()\n\t\tadd_child(audio)\n\t\taudio.play()\n',
    );
    const healthy = await executeDevelopmentLoop(input);
    assert.equal(healthy.status, 'PASS', JSON.stringify(healthy));
    assert.equal(healthy.attempts[0].shutdown?.forced, false);
    assert.equal(healthy.attempts[0].shutdown?.exitCode, 0);
    await writeFile(
      path.join(input.projectPath, 'main.gd'),
      'extends Node\nfunc _exit_tree():\n\tpush_error("intentional exit fault")\n',
    );
    const exitError = await executeDevelopmentLoop(input);
    assert.equal(exitError.status, 'FAIL');
    assert.ok(exitError.attempts[0].shutdownDiagnostics.some((d) => d.message.includes('intentional exit fault')));
    assert.ok(
      !exitError.attempts[0].runtimeDiagnostics?.diagnostics.some((d) => d.message.includes('intentional exit fault')),
    );
    // Empty script: verify shutdown leak check does not fire false positives on clean exit.
    // NOTE: GDScript GC in Godot 4.x auto-releases all script-held references, so a truly
    // orphaned Node/Resource cannot be produced from script alone — C++-side leak would need
    // manual RID/ObjectDB manipulation that GDScript cannot reach.
    await writeFile(path.join(input.projectPath, 'main.gd'), 'extends Node\n');
    const clean = await executeDevelopmentLoop(input);
    assert.equal(clean.status, 'PASS', JSON.stringify(clean));
    assert.ok(clean.attempts[0].checks.some((c) => c.id === 'shutdown' && c.passed));
    assert.equal(clean.attempts[0].shutdown?.forced, false);
    assert.equal(clean.attempts[0].shutdown?.exitCode, 0);
  },
);
test(
  'acknowledged stop without exit is force-reaped and reported, not presented as graceful success',
  { skip: !process.env.GODOT_PATH, timeout: 15000 },
  async () => {
    const input = await fixture('extends Node\n');
    const custom = path.join(input.projectPath, 'non-exiting-bridge.gd');
    const source = await readFile(input.bridgePath, 'utf8');
    assert.ok(source.includes('quit.call_deferred()'));
    await writeFile(custom, source.replace('quit.call_deferred()', 'pass # injected non-exiting runtime'));
    const start = createTimeoutContext(10000);
    const b = await PersistentRuntimeBridge.start({ ...input, bridgePath: custom, headless: true, timeout: start });
    start.dispose();
    const stop = createTimeoutContext(700);
    try {
      const r = await b.stop(stop);
      assert.equal(r.forced, true);
      assert.throws(() => process.kill(r.pid, 0));
    } finally {
      stop.dispose();
    }
  },
);

test('pre-cancelled startup never launches, and spawn failure drains without hanging', { timeout: 10000 }, async () => {
  const input = await fixture('extends Node\n');
  const controller = new AbortController();
  controller.abort();
  const cancelled = createTimeoutContext(2000, controller.signal);
  try {
    await assert.rejects(PersistentRuntimeBridge.start({ ...input, timeout: cancelled }), /cancel/i);
  } finally {
    cancelled.dispose();
  }
  const timeout = createTimeoutContext(2000);
  try {
    await assert.rejects(
      PersistentRuntimeBridge.start({
        ...input,
        godotPath: path.join(input.projectPath, 'missing-godot.exe'),
        timeout,
      }),
      /ENOENT/,
    );
    assert.match(await readFile(path.join(input.evidenceDir, 'stderr.log'), 'utf8'), /ENOENT/);
    const metadata = JSON.parse(await readFile(path.join(input.evidenceDir, 'process.json'), 'utf8'));
    assert.equal(metadata.started, false);
    assert.equal(metadata.lifecycle, 'FAILED');
    assert.ok(metadata.finished_at);
    assert.equal(metadata.evidence_status, 'COMPLETE');
    const manifest = JSON.parse(await readFile(path.join(input.evidenceDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.artifacts['responses.jsonl'].status, 'NOT_GENERATED');
  } finally {
    timeout.dispose();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildContextPack } from '../src/context-pack.js';

test('context pack contains project, godot, scene and git sections', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'godot-mcp-context-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="Context"\nrun/main_scene="res://main.tscn"\n');
  await writeFile(path.join(root, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n');
  const result = await buildContextPack({ projectPath: root, godotPath: 'E:/AI/Godot_v4.7.2-stable_win64_console.exe' });
  assert.equal(result.source, 'REAL');
  assert.equal(result.project.name, 'Context');
  assert.equal(result.main_scene.scene_tree.runtime, false);
  assert.equal(result.active_run, null);
});

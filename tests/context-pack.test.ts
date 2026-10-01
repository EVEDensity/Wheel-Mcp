import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildContextPack } from '../src/context-pack.js';
import { discoverGodotPath } from '../src/godot-path.js';

test('context pack contains project, godot, scene and git sections', async (t) => {
  const godotPath = process.env.GODOT_PATH ?? (await discoverGodotPath({ envFile: path.join(process.cwd(), '.env') }));
  if (!godotPath) t.skip('GODOT_PATH is not available');
  const root = await mkdtemp(path.join(os.tmpdir(), 'godot-mcp-context-'));
  await writeFile(
    path.join(root, 'project.godot'),
    '[application]\nconfig/name="Context"\nrun/main_scene="res://main.tscn"\n',
  );
  await writeFile(path.join(root, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n');
  const result = await buildContextPack({
    projectPath: root,
    godotPath,
    evidenceDir: root,
  });
  assert.equal(result.source, 'REAL');
  assert.equal((result.project as { name: string }).name, 'Context');
  assert.equal((result.main_scene as { scene_tree: { runtime: boolean } }).scene_tree.runtime, false);
  assert.equal((result.active_run as { status: string }).status, 'unavailable');
});

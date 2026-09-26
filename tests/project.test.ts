import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getProjectInfo, getSceneTree, listProjects } from '../src/godot-runtime.js';

test('listProjects discovers bounded Godot projects recursively', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'godot-mcp-projects-'));
  await mkdir(path.join(root, 'nested'), { recursive: true });
  await writeFile(path.join(root, 'nested', 'project.godot'), '[application]\nconfig/name="Nested"\n');
  const result = await listProjects(root, true);
  assert.equal(result.source, 'REAL');
  assert.deepEqual(result.projects, [path.join(root, 'nested', 'project.godot')]);
});

test('getProjectInfo returns metadata and relative files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'godot-mcp-info-'));
  await mkdir(path.join(root, 'scenes'), { recursive: true });
  await writeFile(
    path.join(root, 'project.godot'),
    '[application]\nconfig/name="Fixture"\nrun/main_scene="res://main.tscn"\n',
  );
  await writeFile(path.join(root, 'scenes', 'main.tscn'), '[gd_scene format=3]\n');
  const result = await getProjectInfo(root);
  assert.equal(result.name, 'Fixture');
  assert.equal(result.mainScene, 'res://main.tscn');
  assert.deepEqual(result.files, ['project.godot', 'scenes/main.tscn']);
});

test('getSceneTree parses real static nodes and labels capability', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'godot-mcp-scene-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
  await writeFile(
    path.join(root, 'main.tscn'),
    '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\n[node name="Player" type="Sprite2D" parent="."]\n',
  );
  const result = await getSceneTree(root);
  assert.equal(result.source, 'REAL');
  assert.equal(result.runtime, false);
  assert.equal(result.capability, 'STATIC_SCENE_TREE');
  assert.deepEqual(
    result.nodes.map((node) => node.name),
    ['Main', 'Player'],
  );
  await assert.rejects(() => getSceneTree(root, 'res://../outside.tscn'), /escapes project root/);
});

test('static tree filters, limits and resumes while constructing only the requested page', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'godot-mcp-tree-page-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
  const lines = ['[gd_scene format=3]', '[node name="Main" type="Node2D"]'];
  for (let index = 0; index < 1000; index++) lines.push(`[node name="Child${index}" type="Node2D" parent="."]`);
  await writeFile(path.join(root, 'main.tscn'), lines.join('\n'));
  const first = await getSceneTree(root, null, undefined, { limit: 10, fields: ['name', 'path'] });
  assert.equal(first.nodes.length, 10);
  assert.equal(first.truncated, true);
  assert.equal(first.next_cursor, 10);
  assert.deepEqual(first.nodes[0], { name: 'Main', path: '.' });
  const second = await getSceneTree(root, null, undefined, { limit: 10, cursor: first.next_cursor! });
  assert.equal(second.nodes[0].name, 'Child9');
  const subtree = await getSceneTree(root, null, undefined, { subtree: 'Child500', depth: 0 });
  assert.deepEqual(
    subtree.nodes.map((node) => node.name),
    ['Child500'],
  );
});

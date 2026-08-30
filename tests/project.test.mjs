import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getProjectInfo, listProjects } from '../src/godot-runtime.mjs';

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
  await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="Fixture"\nrun/main_scene="res://main.tscn"\n');
  await writeFile(path.join(root, 'scenes', 'main.tscn'), '[gd_scene format=3]\n');
  const result = await getProjectInfo(root);
  assert.equal(result.name, 'Fixture');
  assert.equal(result.mainScene, 'res://main.tscn');
  assert.deepEqual(result.files, ['project.godot', 'scenes/main.tscn']);
});

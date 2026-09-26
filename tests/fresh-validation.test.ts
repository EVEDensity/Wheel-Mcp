import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeDevelopmentLoop } from '../src/development-loop.js';
import { snapshotProject } from '../src/project-snapshot.js';

const godotPath = process.env.GODOT_PATH ?? '';
const bridgePath = path.resolve('godot-plugin/runtime_bridge.gd');

async function basicProject(root: string): Promise<string> {
  const project = path.join(root, 'project');
  await mkdir(project);
  await writeFile(path.join(project, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
  await writeFile(
    path.join(project, 'main.tscn'),
    '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://state.gd" id="1"]\n[node name="Main" type="Node2D"]\nscript = ExtResource("1")\n',
  );
  await writeFile(path.join(project, 'state.gd'), 'extends Node2D\nvar version = 1\n');
  return project;
}

test('snapshot includes script, autoload config and imported source assets but excludes generated caches', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-snapshot-'));
  const project = await basicProject(root);
  const evidence = path.join(project, 'evidence');
  await mkdir(evidence);
  await mkdir(path.join(project, '.godot'));
  const before = await snapshotProject(project, undefined, [evidence]);
  await writeFile(path.join(evidence, 'result.json'), '{"generated":true}');
  await writeFile(path.join(project, '.godot', 'cache.bin'), 'generated');
  assert.equal((await snapshotProject(project, undefined, [evidence])).sha256, before.sha256);
  await writeFile(path.join(project, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.notEqual((await snapshotProject(project, undefined, [evidence])).sha256, before.sha256);
  await writeFile(path.join(project, 'project.godot'), '[autoload]\nGlobal="*res://global.gd"\n');
  assert.notEqual((await snapshotProject(project, undefined, [evidence])).sha256, before.sha256);
});

test(
  'fresh editor import and new Godot process verify Autoload, class_name, imported asset and scene dependency',
  {
    skip: !existsSync(godotPath),
    timeout: 90000,
  },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-fresh-complete-'));
    const project = await basicProject(root);
    await writeFile(
      path.join(project, 'project.godot'),
      '[application]\nrun/main_scene="res://main.tscn"\n[autoload]\nGlobal="*res://global.gd"\n',
    );
    await writeFile(path.join(project, 'global.gd'), 'extends Node\nvar bonus = 3\n');
    await writeFile(path.join(project, 'health_base.gd'), 'class_name HealthBase\nextends Node2D\nvar health = 1\n');
    await writeFile(
      path.join(project, 'state.gd'),
      'extends HealthBase\nvar version = 2\nfunc _ready():\n\tversion += Global.bonus\n',
    );
    await writeFile(
      path.join(project, 'icon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>',
    );
    await writeFile(path.join(project, 'child.tscn'), '[gd_scene format=3]\n[node name="ChildRoot" type="Node2D"]\n');
    await writeFile(
      path.join(project, 'main.tscn'),
      '[gd_scene load_steps=4 format=3]\n[ext_resource type="Script" path="res://state.gd" id="1"]\n[ext_resource type="Texture2D" path="res://icon.svg" id="2"]\n[ext_resource type="PackedScene" path="res://child.tscn" id="3"]\n[node name="Main" type="Node2D"]\nscript = ExtResource("1")\n[node name="Sprite" type="Sprite2D" parent="."]\ntexture = ExtResource("2")\n[node name="Child" parent="." instance=ExtResource("3")]\n',
    );
    const result = await executeDevelopmentLoop({
      projectPath: project,
      godotPath,
      bridgePath,
      evidenceDir: path.join(root, 'evidence'),
      checks: [
        {
          id: 'autoload_class',
          method: 'get_property',
          params: { nodePath: '.', property: 'version' },
          path: 'value',
          op: 'equals',
          expected: 5,
        },
        {
          id: 'imported_asset',
          method: 'get_property',
          params: { nodePath: 'Sprite', property: 'texture' },
          path: 'value.path',
          op: 'equals',
          expected: 'res://icon.svg',
        },
        {
          id: 'scene_dependency',
          method: 'get_scene_tree',
          params: {},
          path: 'nodes.2.name',
          op: 'equals',
          expected: 'Child',
        },
      ],
      maxRetries: 0,
      timeoutMs: 70000,
    });
    assert.equal(result.status, 'PASS', JSON.stringify(result.attempts));
    assert.ok(result.attempts[0].checks.some((check) => check.id === 'preflight' && check.passed));
    assert.ok(result.attempts[0].checks.some((check) => check.id === 'input_snapshot' && check.passed));
  },
);

test(
  'external project edit after the input hash prevents a mixed-snapshot PASS',
  {
    skip: !existsSync(godotPath),
    timeout: 90000,
  },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-fresh-conflict-'));
    const project = await basicProject(root);
    const evidence = path.join(root, 'evidence');
    const pending = executeDevelopmentLoop({
      projectPath: project,
      godotPath,
      bridgePath,
      evidenceDir: evidence,
      actions: [{ method: 'wait_physics_frames', params: { frames: 120 } }],
      checks: [{ id: 'tree', method: 'get_scene_tree', params: {}, path: 'nodes', op: 'exists' }],
      maxRetries: 0,
      rollbackOnFailure: false,
      timeoutMs: 70000,
    });
    let snapshotReady = false;
    for (let index = 0; index < 400; index++) {
      const directories = await readdir(evidence).catch(() => []);
      if (directories.some((name) => existsSync(path.join(evidence, name, 'attempt-0', 'input-before.json')))) {
        snapshotReady = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(snapshotReady, true);
    await writeFile(path.join(project, 'state.gd'), 'extends Node2D\nvar version = 2\n');
    const result = await pending;
    assert.equal(result.status, 'FAIL');
    assert.equal(result.code, 'CONFLICT');
    assert.ok(result.attempts[0].checks.some((check) => check.id === 'input_snapshot' && !check.passed));
  },
);

test(
  'script initialization error cannot be reported as a successful fresh validation',
  {
    skip: !existsSync(godotPath),
    timeout: 90000,
  },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-fresh-init-error-'));
    const project = await basicProject(root);
    await writeFile(
      path.join(project, 'state.gd'),
      'extends Node2D\nvar version = 1\nfunc _ready():\n\tpush_error("fresh initialization failure")\n',
    );
    const result = await executeDevelopmentLoop({
      projectPath: project,
      godotPath,
      bridgePath,
      evidenceDir: path.join(root, 'evidence'),
      checks: [
        {
          id: 'version',
          method: 'get_property',
          params: { nodePath: '.', property: 'version' },
          path: 'value',
          op: 'equals',
          expected: 1,
        },
      ],
      maxRetries: 0,
      timeoutMs: 70000,
    });
    assert.equal(result.status, 'FAIL');
    assert.ok(result.attempts[0].checks.some((check) => check.id === 'diagnostics' && !check.passed));
  },
);

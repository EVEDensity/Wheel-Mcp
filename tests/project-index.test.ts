import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { searchProject } from '../src/godot-development.js';
import { getProjectInfo } from '../src/godot-runtime.js';
import { getProjectIndex, ProjectIndex } from '../src/index/project-index.js';
import { indexFileMetadata } from '../src/index/file-metadata.js';
import { compileProjectGlob } from '../src/index/glob.js';

test('project text search excludes binary contents and generated runs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-index-'));
  await mkdir(path.join(root, 'runs'));
  await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="Index fixture"\n');
  await writeFile(path.join(root, 'probe.gd'), 'extends Node\n# needle\n');
  await writeFile(path.join(root, 'texture.png'), Buffer.from([137, 80, 78, 71, 0, ...Buffer.from('needle')]));
  await writeFile(path.join(root, 'runs', 'log.txt'), 'needle');
  const result = await searchProject(root, 'needle');
  assert.deepEqual(
    result.results.map((item: { path: string }) => item.path),
    ['probe.gd'],
  );
  const info = await getProjectInfo(root);
  assert.ok(!info.files.some((file) => file.startsWith('runs/')));
});
test('glob budget avoids regex backtracking and treats punctuation literally', () => {
  assert.equal(compileProjectGlob('*.gd')('scenes/probe.gd'), true);
  assert.equal(compileProjectGlob('probe?.gd')('probe1.gd'), true);
  assert.equal(compileProjectGlob('[a].gd')('a.gd'), false);
  assert.equal(compileProjectGlob('*a'.repeat(100) + 'b')('a'.repeat(200)), false);
  assert.throws(() => compileProjectGlob('*'.repeat(257)), { code: 'INVALID_ARGUMENT' });
});
test('metadata budgets and lexical exclusions are explicit rather than semantic completeness claims', () => {
  const source = 'var note = """\nfunc fake():\n"""\nfunc real():\n\tpass\n';
  assert.deepEqual(
    indexFileMetadata('probe.gd', source).symbols.map((symbol) => symbol.name),
    ['note', 'real'],
  );
  const oversized = indexFileMetadata('probe.gd', '#'.repeat(65537) + '\nfunc later():\n');
  assert.equal(oversized.omittedFromLine, 1);
  assert.equal(oversized.symbols.length, 0);
});
test('index has project-scoped hashes, bounded binary metadata and unchanged-file cache hits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-index-meta-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  await writeFile(path.join(root, 'sprite.png'), Buffer.from([137, 80, 78, 71, 0]));
  const index = await getProjectIndex(root);
  const cold = await index.refresh();
  assert.equal(cold.schemaVersion, 1);
  assert.equal(cold.stale, false);
  assert.equal(cold.safeRefactor, false);
  assert.equal(cold.stats.readFiles, 2);
  const binary = cold.files.find((file) => file.path === 'sprite.png')!;
  assert.equal(binary.text, null);
  assert.match(binary.sha256, /^[a-f0-9]{64}$/);
  const warm = await index.refresh();
  assert.equal(warm.sourceHash, cold.sourceHash);
  assert.equal(warm.stats.readFiles, 0);
  assert.equal(warm.stats.reusedFiles, 2);
  const other = await mkdtemp(path.join(os.tmpdir(), 'wheel-index-other-'));
  await writeFile(path.join(other, 'project.godot'), '[application]\n');
  assert.notEqual((await (await getProjectIndex(other)).refresh()).projectId, cold.projectId);
  const bounded = new ProjectIndex(index.root, 1);
  await assert.rejects(bounded.refresh(), { code: 'UNSUPPORTED' });
  assert.equal(bounded.readSnapshot(), undefined);
});

test('lexical index associates real declarations, nodes, resources, UIDs and reverse dependencies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-index-graph-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
  await writeFile(
    path.join(root, 'probe.gd'),
    'extends Node\n# func fake():\nvar note = "func fake2():"\nconst OTHER = preload("uid://probe")\nfunc move_right():\n\tpass\n',
  );
  await writeFile(path.join(root, 'probe.gd.uid'), 'uid://probe\n');
  await writeFile(
    path.join(root, 'main.tscn'),
    '[gd_scene load_steps=3 format=3 uid="uid://scene"]\n[ext_resource type="Script" path="res://probe.gd" id="1"]\n[sub_resource type="StyleBoxFlat" id="style"]\n[node name="Root" type="Node"]\nscript = ExtResource("1")\n[node name="Child" type="Control" parent="."]\ntheme_override_styles/panel = SubResource("style")\n',
  );
  const index = await getProjectIndex(root);
  const cold = await index.refresh();
  const script = cold.files.find((file) => file.path === 'probe.gd')!;
  assert.deepEqual(
    script.metadata.symbols.map((symbol) => symbol.name),
    ['note', 'OTHER', 'move_right'],
  );
  const scene = cold.files.find((file) => file.path === 'main.tscn')!;
  assert.deepEqual(
    scene.metadata.nodes.map((node) => node.name),
    ['Root', 'Child'],
  );
  assert.equal(scene.metadata.resources.length, 2);
  assert.ok(cold.graph.edges.some((edge) => edge.from === 'main.tscn' && edge.to === 'probe.gd'));
  assert.ok(cold.graph.edges.some((edge) => edge.to === 'main.tscn#subresource:style'));
  assert.ok(cold.graph.edges.some((edge) => edge.from === 'probe.gd' && edge.to === 'probe.gd'));
  assert.deepEqual(cold.graph.reverse.find((item) => item.target === 'probe.gd')!.sources, ['main.tscn', 'probe.gd']);
  assert.equal(cold.graph.unresolved.length, 0);
  const warm = await index.refresh();
  assert.equal(warm.files.find((file) => file.path === 'probe.gd')!.metadata, script.metadata);
  assert.throws(() => (cold.graph.edges as unknown as object[]).push({}));
  await writeFile(path.join(root, 'other.gd'), 'extends Node\n');
  await writeFile(path.join(root, 'other.gd.uid'), 'uid://probe');
  assert.ok((await index.refresh()).graph.unresolved.some((item) => item.reason === 'ambiguous-uid'));
});

test('generated directory and binary resources stay bounded and are never decoded as source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-index-generated-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\n');
  for (let dir = 0; dir < 10; dir++) {
    await mkdir(path.join(root, `group-${dir}`));
    for (let file = 0; file < 20; file++)
      await writeFile(path.join(root, `group-${dir}`, `${file}.gd`), `extends Node\nvar item_${file} = 1\n`);
  }
  await writeFile(path.join(root, 'large.png'), Buffer.alloc(3 * 1024 * 1024, 65));
  const index = await getProjectIndex(root);
  const cold = await index.refresh();
  assert.equal(cold.files.length, 202);
  assert.equal(cold.files.find((file) => file.path === 'large.png')!.text, null);
  assert.equal((await index.refresh()).stats.reusedFiles, 202);
  assert.equal(cold.graph.analysisLevel, 'lexical');
});

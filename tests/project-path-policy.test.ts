import test from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  readProjectFile,
  readSceneFile,
  searchProject,
  writeProjectFile,
  writeSceneFile,
} from '../src/godot-development.js';
import { getSceneTree } from '../src/godot-runtime.js';
import { analyzeScriptFile } from '../src/script-analysis.js';
import { resolveProjectPath } from '../src/project/paths.js';
import { authorizeToolCall, createClientPolicy } from '../src/mcp/access-policy.js';
import { fixtureApproval } from './helpers/project-approval.js';

async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'wheel-path-policy-'));
  const root = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  await mkdir(root);
  await mkdir(outside);
  await mkdir(path.join(root, 'scenes'));
  await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://scenes/main.tscn"\n');
  await writeFile(
    path.join(root, 'scenes', 'main.tscn'),
    '[gd_scene format=3 uid="uid://testscene"]\n[node name="Main" type="Node2D"]\n',
  );
  await writeFile(path.join(root, 'script.gd'), 'extends Node\n');
  await writeFile(path.join(root, 'script.gd.uid'), 'uid://testscript\n');
  await writeFile(path.join(outside, 'secret.txt'), 'OUTSIDE');
  return { base, root, outside };
}

test('relative, res://, approved absolute and real UID mappings resolve to one project file', async () => {
  const { root } = await fixture();
  const relative = await readSceneFile(root, 'scenes/main.tscn');
  const resource = await readSceneFile(root, 'res://scenes/main.tscn');
  const absolute = await readSceneFile(root, path.join(root, 'scenes', 'main.tscn'));
  const uid = await readSceneFile(root, 'uid://testscene');
  assert.equal(resource.content, relative.content);
  assert.equal(absolute.content, relative.content);
  assert.equal(uid.content, relative.content);
  assert.equal((await getSceneTree(root)).nodes[0].name, 'Main');
  assert.equal((await analyzeScriptFile(root, 'uid://testscript')).functions.length, 0);
  await writeProjectFile(root, 'res://scenes/new.gd', 'extends Node\n', {
    verifyApproval: fixtureApproval,
    validationMode: 'raw',
  });
  assert.equal((await readProjectFile(root, 'scenes/new.gd')).content, 'extends Node\n');
  await writeSceneFile(root, 'res://scenes/new.tscn', '[gd_scene format=3]\n[node name="New" type="Node2D"]\n', {
    validationMode: 'raw',
    verifyApproval: fixtureApproval,
  });
  assert.equal((await readSceneFile(root, 'scenes/new.tscn')).scenePath, 'scenes/new.tscn');
  await assert.rejects(() => resolveProjectPath(root, 'uid://missing', { mode: 'read', allowUid: true }), /not found/);
  await assert.rejects(() => writeProjectFile(root, 'uid://testscript', 'x'), /UID writes/);
});

test('traversal, missing parents, protected areas, ADS and off-project absolute paths cannot write', async () => {
  const { root, outside } = await fixture();
  const probes = [
    '../outside/secret.txt',
    'res://../outside/secret.txt',
    'res://scenes/../../outside/secret.txt',
    'scenes\\..\\outside\\secret.txt',
    'scenes//new.gd',
    'scenes/./new.gd',
    'scenes/new.gd:stream',
    'scenes/new.gd.',
    'scenes/new.gd ',
    path.join(outside, 'secret.txt'),
    '.git/config',
    '.godot/cache.txt',
    '.harness/results.json',
    'missing/new.gd',
  ];
  for (const candidate of probes) await assert.rejects(() => writeProjectFile(root, candidate, 'CHANGED'), candidate);
  assert.equal(await readFile(path.join(outside, 'secret.txt'), 'utf8'), 'OUTSIDE');
  await assert.rejects(() => readProjectFile(root, 'res://../outside/secret.txt'));
  await assert.rejects(() => readProjectFile(root, '.git/config'), /protected/);
  await assert.rejects(() => getSceneTree(root, 'res://../outside/secret.txt'), /unsafe|escapes/);
});

test('real directory junctions and supported symlinks cannot redirect project reads or writes', async () => {
  const { root, outside } = await fixture();
  const junction = path.join(root, 'portal');
  await symlink(outside, junction, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => readProjectFile(root, 'portal/secret.txt'), /links|junctions/);
  await assert.rejects(() => writeProjectFile(root, 'portal/secret.txt', 'CHANGED'), /links|junctions/);
  await assert.rejects(() => writeProjectFile(root, 'portal/new.txt', 'CHANGED'), /links|junctions/);
  if (process.platform !== 'win32') {
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'alias.txt'));
    await assert.rejects(() => writeProjectFile(root, 'alias.txt', 'CHANGED'), /links|junctions/);
  }
  assert.equal(await readFile(path.join(outside, 'secret.txt'), 'utf8'), 'OUTSIDE');
  assert.deepEqual((await searchProject(root, 'OUTSIDE')).results, []);
});

test('hard-linked files cannot be modified and Windows path spelling is checked', async () => {
  const { root, outside } = await fixture();
  await link(path.join(outside, 'secret.txt'), path.join(root, 'hardlink.txt'));
  await assert.rejects(() => writeProjectFile(root, 'hardlink.txt', 'CHANGED'), /hard-linked/);
  assert.equal(await readFile(path.join(outside, 'secret.txt'), 'utf8'), 'OUTSIDE');
  if (process.platform === 'win32') {
    await assert.rejects(() => readProjectFile(root, 'SCENES/main.tscn'), /casing/);
    await assert.rejects(() => writeProjectFile(root, 'C:relative.txt', 'CHANGED'));
    await assert.rejects(() => writeProjectFile(root, '\\\\server\\share\\bad.txt', 'CHANGED'));
  }
});

test('MCP authorization and direct file tools share resource, protected and junction rules', async () => {
  const { root, outside } = await fixture();
  const policy = createClientPolicy({
    clientId: 'paths',
    scopes: ['read', 'write'],
    projectRoots: [root],
    evidenceRoots: [root],
  });
  await assert.doesNotReject(() =>
    authorizeToolCall(policy, 'read_scene_file', { projectPath: root, scenePath: 'res://scenes/main.tscn' }),
  );
  await assert.doesNotReject(() =>
    authorizeToolCall(policy, 'read_scene_file', { projectPath: root, scenePath: 'uid://testscene' }),
  );
  await assert.doesNotReject(() =>
    authorizeToolCall(policy, 'read_scene_file', {
      projectPath: root,
      scenePath: path.join(root, 'scenes', 'main.tscn'),
    }),
  );
  await assert.rejects(
    () => authorizeToolCall(policy, 'write_project_file', { projectPath: root, filePath: '.git/config' }),
    /unsafe/,
  );
  await assert.rejects(
    () => authorizeToolCall(policy, 'read_project_file', { projectPath: root, filePath: '.harness/secret' }),
    /unsafe/,
  );
  await assert.rejects(
    () =>
      authorizeToolCall(policy, 'write_project_file', {
        projectPath: root,
        filePath: path.join(outside, 'secret.txt'),
      }),
    /unsafe/,
  );
  await symlink(outside, path.join(root, 'portal'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    () => authorizeToolCall(policy, 'read_project_file', { projectPath: root, filePath: 'portal/secret.txt' }),
    /unsafe/,
  );
});

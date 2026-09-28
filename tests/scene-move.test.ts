import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { planSceneMove, moveProjectScene } from '../src/project/scene-move.js';
import { fixtureApproval } from './helpers/project-approval.js';
import { wireEditor } from './helpers/editor-mcp.js';

const scene = '[gd_scene format=3 uid="uid://b2q3lgpgcclts"]\n[node name="Component" type="Node2D"]\n';
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-move-'));
  await mkdir(path.join(root, 'scenes'));
  await writeFile(
    path.join(root, 'project.godot'),
    '[application]\nconfig/name="Move fixture"\nrun/main_scene="res://base.tscn"\n',
  );
  await writeFile(path.join(root, 'base.tscn'), scene);
  await writeFile(
    path.join(root, 'main.tscn'),
    '[gd_scene load_steps=2 format=3]\n[ext_resource type="PackedScene" path="res://base.tscn" id="base"]\n[node name="Main" instance=ExtResource("base")]\n',
  );
  return root;
}
test('scene move impact identifies only reliable ext_resource and main_scene references and retains UID', async () => {
  const root = await fixture();
  const plan = await planSceneMove(root, 'base.tscn', 'scenes/renamed.tscn');
  assert.deepEqual(plan.references.map((r) => r.path).sort(), ['main.tscn', 'project.godot']);
  assert.equal(plan.uid, 'uid://b2q3lgpgcclts');
  assert.equal(plan.operations[0].kind, 'rename');
  assert.equal(await readFile(path.join(root, 'base.tscn'), 'utf8'), scene, 'Planning must not mutate');
  await writeFile(path.join(root, 'dynamic.gd'), 'extends Node\nvar source = "res://base.tscn"\n');
  await assert.rejects(planSceneMove(root, 'base.tscn', 'scenes/renamed.tscn'), { code: 'CONFLICT' });
  await writeFile(
    path.join(root, 'dynamic.gd'),
    'extends Node\nfunc get_scene(name):\n\treturn load("res://" + name + ".tscn")\n',
  );
  await assert.rejects(planSceneMove(root, 'base.tscn', 'scenes/renamed.tscn'), { code: 'CONFLICT' });
});
test('scene move rejects existing targets, protected paths and unsupported UID-only references', async () => {
  const root = await fixture();
  await assert.rejects(planSceneMove(root, 'base.tscn', 'main.tscn'), { code: 'CONFLICT' });
  await assert.rejects(planSceneMove(root, 'base.tscn', '.harness/base.tscn'));
  await writeFile(path.join(root, 'settings.cfg'), 'resource="uid://b2q3lgpgcclts"\n');
  await assert.rejects(planSceneMove(root, 'base.tscn', 'scenes/renamed.tscn'), { code: 'CONFLICT' });
});
test('scene move exempts only byte-identical bundled plugin code from unrelated dynamic-load heuristics', async () => {
  const root = await fixture();
  const addon = path.join(root, 'addons/wheel_mcp');
  await mkdir(addon, { recursive: true });
  const pluginPath = path.join(addon, 'asset_import.gd');
  const bundled = await readFile(path.resolve('godot-plugin/addons/wheel_mcp/asset_import.gd'));
  await writeFile(pluginPath, bundled);
  assert.equal((await planSceneMove(root, 'base.tscn', 'scenes/renamed.tscn')).from, 'base.tscn');
  await writeFile(
    pluginPath,
    Buffer.concat([bundled, Buffer.from('\nfunc changed(name): return load("res://" + name + ".tscn")\n')]),
  );
  await assert.rejects(planSceneMove(root, 'base.tscn', 'scenes/renamed.tscn'), { code: 'CONFLICT' });
});
const real = { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 120000 };
test(
  'official MCP scene move approves exact impact, validates without old file, commits and loads inherited references',
  real,
  async () => {
    const root = await fixture();
    const c = await wireEditor(root);
    try {
      const reply = await c.call('move_project_scene', { from: 'base.tscn', to: 'scenes/renamed.tscn' });
      assert.notEqual(reply.isError, true, JSON.stringify(reply));
      assert.equal((reply.structuredContent as any).validation, 'PASS');
      assert.equal(existsSync(path.join(root, 'base.tscn')), false);
      assert.equal(await readFile(path.join(root, 'scenes/renamed.tscn'), 'utf8'), scene);
      assert.match(await readFile(path.join(root, 'main.tscn'), 'utf8'), /path="res:\/\/scenes\/renamed.tscn"/);
      assert.match(
        await readFile(path.join(root, 'project.godot'), 'utf8'),
        /main_scene="res:\/\/scenes\/renamed.tscn"/,
      );
    } finally {
      await c.close();
    }
  },
);
test(
  'declined scene move and concurrent reference edit keep originals intact; read/write without run is denied',
  real,
  async () => {
    const root = await fixture();
    const c = await wireEditor(root, { scopes: ['read', 'write'] });
    try {
      assert.equal(
        (
          (await c.call('move_project_scene', { from: 'base.tscn', to: 'scenes/renamed.tscn' }))
            .structuredContent as any
        ).code,
        'FORBIDDEN',
      );
    } finally {
      await c.close();
    }
    await assert.rejects(
      moveProjectScene(root, 'base.tscn', 'scenes/renamed.tscn', { verifyApproval: async () => null }),
      { code: 'FORBIDDEN' },
    );
    const changed = (await readFile(path.join(root, 'main.tscn'), 'utf8')) + '; human change\n';
    await assert.rejects(
      moveProjectScene(root, 'base.tscn', 'scenes/renamed.tscn', {
        verifyApproval: async (p) => {
          await writeFile(path.join(root, 'main.tscn'), changed);
          return fixtureApproval(p);
        },
      }),
      { code: 'CONFLICT' },
    );
    assert.equal(await readFile(path.join(root, 'base.tscn'), 'utf8'), scene);
    assert.equal(await readFile(path.join(root, 'main.tscn'), 'utf8'), changed);
    assert.equal(existsSync(path.join(root, 'scenes/renamed.tscn')), false);
  },
);

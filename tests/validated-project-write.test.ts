import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeValidatedProjectFiles, writeValidatedProjectText } from '../src/project/validated-write.js';
import { fixtureApproval } from './helpers/project-approval.js';
import { startEditorFixture } from './helpers/editor-fixture.js';
const real = { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 90000 };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-write-validated-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
  const scene = '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n';
  await writeFile(path.join(root, 'main.tscn'), scene);
  return { root, scene };
}
test('invalid scene, script and dependency candidates never replace original bytes or mtime', real, async () => {
  const f = await fixture(),
    before = await stat(path.join(f.root, 'main.tscn'));
  for (const [name, content] of [
    ['main.tscn', '[gd_scene format=3]\n[node name="Broken" type="Node2D"\n'],
    ['bad.gd', 'extends Node\nfunc invalid(:\n'],
    ['bad.tres', '[gd_resource type="Resource" format=3]\n[resource]\nscript = ExtResource("missing")\n'],
  ] as const) {
    await assert.rejects(
      writeValidatedProjectText(f.root, name, content, { verifyApproval: fixtureApproval }),
      (error: any) => {
        assert.equal(error.code, 'VALIDATION_FAILED');
        assert.equal(error.details.result.status, 'FAIL');
        assert.equal(error.details.result.files[0].path, 'res://' + name);
        const inputs = JSON.parse(readFileSync(path.join(error.details.evidenceDir, 'inputs.json'), 'utf8'));
        assert.equal(existsSync(path.dirname(inputs.stage)), false, 'isolated validation stage must be removed');
        return true;
      },
    );
    assert.equal(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), f.scene);
    assert.equal((await stat(path.join(f.root, 'main.tscn'))).mtimeMs, before.mtimeMs);
    if (name !== 'main.tscn') assert.equal(existsSync(path.join(f.root, name)), false);
  }
});
test(
  'correct isolated resource context validates imported SVG, UID, new multi-file dependencies and rejected batch',
  real,
  async () => {
    const f = await fixture();
    await writeFile(
      path.join(f.root, 'icon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
    );
    const material =
      '[gd_resource type="StandardMaterial3D" format=3 uid="uid://b123abc"]\n[resource]\nroughness = 0.5\n';
    const scene =
      '[gd_scene load_steps=3 format=3]\n[ext_resource type="Texture2D" path="res://icon.svg" id="1"]\n[ext_resource type="Material" path="res://shared.tres" id="2"]\n[node name="Main" type="Node2D"]\n[node name="Sprite" type="Sprite2D" parent="."]\ntexture = ExtResource("1")\n[node name="Geometry" type="MeshInstance3D" parent="."]\nmaterial_override = ExtResource("2")\n';
    const r = await writeValidatedProjectFiles(
      f.root,
      [
        { path: 'shared.tres', content: material, expectedSha256: null },
        { path: 'main.tscn', content: scene, expectedSha256: sha(f.scene) },
      ],
      { verifyApproval: fixtureApproval },
    );
    assert.equal(r.validation, 'PASS');
    assert.equal(r.persisted, true);
    const report = JSON.parse(await readFile(path.join(r.evidenceDir!, 'report.json'), 'utf8'));
    assert.equal(report.status, 'PASS');
    assert.equal(report.result.files[1].instantiated, true);
    const inputs = JSON.parse(await readFile(path.join(r.evidenceDir!, 'inputs.json'), 'utf8'));
    assert.equal(existsSync(path.dirname(inputs.stage)), false, 'successful validation stage must be removed');
    await assert.rejects(
      writeValidatedProjectFiles(
        f.root,
        [
          { path: 'valid.gd', content: 'extends Node\n', expectedSha256: null },
          { path: 'bad.tscn', content: '[gd_scene format=3]\n[broken', expectedSha256: null },
        ],
        { verifyApproval: fixtureApproval },
      ),
      { code: 'VALIDATION_FAILED' },
    );
    assert.equal(existsSync(path.join(f.root, 'valid.gd')), false);
    assert.equal(existsSync(path.join(f.root, 'bad.tscn')), false);
    assert.equal(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), scene);
    await assert.rejects(
      writeValidatedProjectText(f.root, '.godot/bad.gd', 'extends Node\n', { verifyApproval: fixtureApproval }),
      /protected/,
    );
  },
);
test(
  'dirty document, human input changed during approval, cancellation and absent approval preserve originals',
  real,
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, { writeEnabled: true });
    try {
      await f.command('dirty-select');
      await assert.rejects(
        writeValidatedProjectText(f.root, 'main.tscn', f.scene + '; proposed\n', {
          ownerId: 'local-client',
          verifyApproval: fixtureApproval,
        }),
        { code: 'CONFLICT' },
      );
      assert.equal(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), f.scene);
    } finally {
      await f.stop();
    }
    const simple = await fixture();
    await assert.rejects(writeValidatedProjectText(simple.root, 'new.gd', 'extends Node\n'), { code: 'FORBIDDEN' });
    await assert.rejects(
      writeValidatedProjectText(simple.root, 'new.gd', 'extends Node\n', {
        verifyApproval: async (plan) => {
          await writeFile(path.join(simple.root, 'human.txt'), 'preserved');
          return fixtureApproval(plan);
        },
      }),
      { code: 'CONFLICT' },
    );
    assert.equal(await readFile(path.join(simple.root, 'human.txt'), 'utf8'), 'preserved');
    assert.equal(existsSync(path.join(simple.root, 'new.gd')), false);
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(
      writeValidatedProjectText(simple.root, 'new.gd', 'extends Node\n', {
        signal: abort.signal,
        verifyApproval: fixtureApproval,
      }),
    );
    assert.equal(existsSync(path.join(simple.root, 'new.gd')), false);
    const raw = await writeValidatedProjectText(simple.root, 'raw.gd', 'this is not valid GDScript', {
      validationMode: 'raw',
      verifyApproval: async (plan) => {
        assert.match(plan.intent!, /RAW TEXT.*NOT_RUN/);
        return fixtureApproval(plan);
      },
    });
    assert.equal(raw.validation, 'NOT_RUN');
    assert.match(raw.validationScope!, /RAW/);
  },
);

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { manageEditorResource, resourceRefSchema } from '../src/editor/resource-service.js';
import { applyEditorScene } from '../src/editor/scene-service.js';
const real = { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 };
const scene =
  '[gd_scene format=3]\n[node name="Main" type="Node3D"]\n[node name="A" type="MeshInstance3D" parent="."]\n[node name="B" type="MeshInstance3D" parent="."]\n';
test(
  'real resource handles are scoped, native shared/unique edits undo correctly and stale handles reject',
  real,
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, { writeEnabled: true, scene });
    const base = { projectPath: f.root, ownerId: 'local-client' };
    const manage = (request: Parameters<typeof manageEditorResource>[0]['request']) =>
      manageEditorResource({ ...base, request });
    const apply = (operations: Parameters<typeof applyEditorScene>[0]['operations']) =>
      applyEditorScene({
        ...base,
        operations,
        approve: async (p) => ({ actor: base.ownerId, planHash: p.planHash, receipt: 'explicit-test-double' }),
      });
    const reference = async (node: string) =>
      resourceRefSchema.parse((await manage({ action: 'reference', path: node, property: 'material_override' })).ref);
    try {
      const ref = resourceRefSchema.parse(
        (await manage({ action: 'create', resourceType: 'StandardMaterial3D', properties: { roughness: 0.25 } })).ref,
      );
      await assert.rejects(
        manageEditorResource({ ...base, ownerId: 'stdio-local', request: { action: 'read', ref } }),
        { code: 'FORBIDDEN' },
      );
      await assert.rejects(manage({ action: 'read', ref: { ...ref, resourceType: 'PhysicsMaterial' } }), {
        code: 'FORBIDDEN',
      });
      await apply(
        ['A', 'B'].map((node) => ({
          kind: 'resource_assign',
          path: node,
          property: 'material_override',
          ref,
          policy: 'shared',
        })),
      );
      const a = await reference('A'),
        b = await reference('B');
      assert.equal(a.fingerprint, b.fingerprint);
      await apply([
        {
          kind: 'resource_set',
          path: 'A',
          property: 'material_override',
          properties: { roughness: 0.75 },
          policy: 'shared',
        },
      ]);
      for (const node of ['A', 'B'])
        assert.equal(
          (await manage({ action: 'read', ref: await reference(node) })).properties &&
            ((await manage({ action: 'read', ref: await reference(node) })).properties as any).roughness,
          0.75,
        );
      await assert.rejects(manage({ action: 'read', ref: a }), { code: 'CONFLICT' });
      await f.command('undo');
      assert.equal(((await manage({ action: 'read', ref: await reference('B') })).properties as any).roughness, 0.25);
      await f.command('redo');
      await apply([
        {
          kind: 'resource_set',
          path: 'A',
          property: 'material_override',
          properties: { roughness: 0.5 },
          policy: 'make_unique',
        },
      ]);
      assert.notEqual((await reference('A')).fingerprint, (await reference('B')).fingerprint);
      assert.equal(((await manage({ action: 'read', ref: await reference('B') })).properties as any).roughness, 0.75);
      await f.command('undo');
      assert.equal((await reference('A')).fingerprint, (await reference('B')).fingerprint);
      await f.command('redo');
      const copy = resourceRefSchema.parse((await manage({ action: 'duplicate', ref: await reference('A') })).ref);
      await manage({ action: 'release', ref: copy });
      await assert.rejects(manage({ action: 'read', ref: copy }), { code: 'NOT_FOUND' });
      assert.equal(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), scene);
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
    } finally {
      await f.stop();
    }
  },
);

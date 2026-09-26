import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EditorBridge } from '../src/editor/editor-bridge.js';
import { applyEditorScene } from '../src/editor/scene-service.js';
import { startEditorFixture } from './helpers/editor-fixture.js';
const real = { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 };
const component =
  '[gd_scene format=3]\n[node name="Component" type="Node2D"]\n[node name="Tip" type="Marker2D" parent="."]\nposition = Vector2(10, 20)\n';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
test(
  'real native PackedScene instance preserves source, internal owner and protected root/children',
  real,
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, {
      writeEnabled: true,
      files: { 'component.tscn': component },
    });
    const options = {
      projectPath: f.root,
      ownerId: 'local-client',
      approve: async (p: { planHash: string }) => ({
        actor: 'local-client',
        planHash: p.planHash,
        receipt: 'explicit-test-double',
      }),
    };
    try {
      const result = await applyEditorScene({
        ...options,
        operations: [
          {
            kind: 'instantiate',
            parent: '.',
            name: 'Instance',
            scenePath: 'res://component.tscn',
            sourceHash: hash(component),
            policy: 'preserve',
          },
        ],
      });
      assert.equal(result.status, 'PASS', JSON.stringify(result));
      const bridge = await EditorBridge.connect(options);
      try {
        const state = await bridge.snapshot();
        assert.ok(state.sceneTree.nodes.some((n) => n.path === 'Instance' && n.owner === '.'));
        assert.ok(state.sceneTree.nodes.some((n) => n.path === 'Instance/Tip' && n.owner === 'Instance'));
      } finally {
        bridge.close();
      }
      for (const operations of [
        [{ kind: 'rename' as const, path: 'Instance', name: 'Forbidden' }],
        [
          {
            kind: 'set' as const,
            path: 'Instance/Tip',
            property: 'position' as const,
            value: { type: 'Vector2' as const, x: 999, y: 0 },
          },
        ],
        [{ kind: 'create' as const, parent: 'Instance', name: 'Forbidden', type: 'Node2D' as const }],
      ])
        await assert.rejects(applyEditorScene({ ...options, operations }), { code: 'FORBIDDEN' });
      assert.equal(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), f.scene);
      assert.equal(await readFile(path.join(f.root, 'component.tscn'), 'utf8'), component);
      assert.ok(!f.output().includes('ERROR:'), f.output());
    } finally {
      await f.stop();
    }
  },
);
test(
  'instance sources reject protected paths, unapproved bytes and executable/dependency graphs before mutation',
  real,
  async () => {
    const unsafe =
      '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://malicious.gd" id="1"]\n[node name="Component" type="Node2D"]\nscript = ExtResource("1")\n';
    const f = await startEditorFixture(process.env.GODOT_PATH!, {
      writeEnabled: true,
      files: {
        'component.tscn': component,
        'unsafe.tscn': unsafe,
        'malicious.gd':
          '@tool\nextends Node2D\nfunc _init():\n\tFileAccess.open("res://executed.txt", FileAccess.WRITE).store_string("executed")\n',
      },
    });
    const options = {
      projectPath: f.root,
      ownerId: 'local-client',
      approve: async (p: { planHash: string }) => ({
        actor: 'local-client',
        planHash: p.planHash,
        receipt: 'explicit-test-double',
      }),
    };
    try {
      for (const [scenePath, sourceHash, code] of [
        ['res://.harness/editor-bridge.json', hash(component), 'FORBIDDEN'],
        ['res://component.tscn', '0'.repeat(64), 'CONFLICT'],
        ['res://unsafe.tscn', hash(unsafe), 'UNSUPPORTED'],
      ])
        await assert.rejects(
          applyEditorScene({
            ...options,
            operations: [
              { kind: 'instantiate', parent: '.', name: 'Instance', scenePath, sourceHash, policy: 'preserve' },
            ],
          }),
          { code },
        );
      assert.ok(!existsSync(path.join(f.root, 'executed.txt')));
      await assert.rejects(
        applyEditorScene({
          ...options,
          operations: [
            {
              kind: 'instantiate',
              parent: '.',
              name: 'Instance',
              scenePath: 'res://component.tscn',
              sourceHash: hash(component),
              policy: 'preserve',
            },
          ],
          approve: async (p) => {
            await writeFile(path.join(f.root, 'component.tscn'), component + '; changed during approval\n');
            return { actor: 'local-client', planHash: p.planHash, receipt: 'explicit-test-double' };
          },
        }),
        { code: 'CONFLICT' },
      );
      const bridge = await EditorBridge.connect(options);
      try {
        assert.ok(!(await bridge.snapshot()).sceneTree.nodes.some((n) => n.path === 'Instance'));
      } finally {
        bridge.close();
      }
    } finally {
      await f.stop();
    }
  },
);

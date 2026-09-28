import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../src/mcp-server-sdk.js';
import { createClientPolicy } from '../src/mcp/access-policy.js';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { resourceTypes } from '../src/editor/resource-service.js';
const real = { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 90000 };
const controller = `@tool
extends EditorPlugin
func _enter_tree(): set_process(true)
func _process(_delta):
\tvar root = EditorInterface.get_edited_scene_root()
\tif root == null or not FileAccess.file_exists("res://.harness/fixture-command.json"): return
\tvar command = JSON.parse_string(FileAccess.get_file_as_string("res://.harness/fixture-command.json"))
\tDirAccess.remove_absolute(ProjectSettings.globalize_path("res://.harness/fixture-command.json"))
\tvar packed = PackedScene.new()
\tcommand.pack = packed.pack(root)
\tcommand.save = ResourceSaver.save(packed, root.scene_file_path)
\tvar file = FileAccess.open("res://.harness/fixture-result.json",FileAccess.WRITE)
\tfile.store_string(JSON.stringify(command))
\tfile.close()
`;
test(
  'official MCP native resource export, exact approved external save and inline/shared scene reopen',
  real,
  async () => {
    let f = await startEditorFixture(process.env.GODOT_PATH!, {
      writeEnabled: true,
      controller,
      scene: '[gd_scene format=3]\n[node name="Main" type="Node3D"]\n',
    });
    const policy = createClientPolicy({
      clientId: 'local-client',
      scopes: ['read', 'write'],
      projectRoots: [f.root],
      evidenceRoots: [f.root],
    });
    const server = createMcpServer(policy),
      client = new Client({ name: 'resource-test', version: '1' }, { capabilities: { elicitation: { form: {} } } });
    let approvals = 0;
    client.setRequestHandler(ElicitRequestSchema, async () => {
      approvals++;
      return { action: 'accept', content: { confirm: true } };
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: { projectPath: f.root, ...args } });
      assert.notEqual(r.isError, true, JSON.stringify(r));
      return r.structuredContent as Record<string, any>;
    };
    const files: Record<string, string> = {},
      expected: Record<string, any> = {};
    try {
      const ops: any[] = [];
      for (const [i, type] of resourceTypes.entries()) {
        const made = await call('manage_editor_resource', {
          request: { action: 'create', resourceType: type, properties: {} },
        });
        const saved = await call('save_editor_resource', {
          ref: made.ref,
          filePath: `r${i}.tres`,
          operationId: `r${i}`,
          expectedSha256: null,
        });
        assert.equal(saved.persisted, true);
        assert.equal(saved.validation, 'PASS');
        assert.ok(saved.ref, JSON.stringify(saved));
        const text = await readFile(path.join(f.root, `r${i}.tres`), 'utf8');
        assert.match(text, /uid="uid:\/\//);
        files[`r${i}.tres`] = text;
        if (type === 'StyleBoxFlat') {
          // StyleBox is a Theme item, not a node material. Its composed Theme
          // save/reopen path is covered by ui-authoring-e2e; still export and
          // read back this external resource here rather than dropping the type.
          const readback = await call('manage_editor_resource', {
            request: { action: 'read', ref: saved.ref },
          });
          assert.equal(readback.ref.resourceType, type);
          assert.deepEqual(readback.properties, made.properties);
          continue;
        }
        const shape = type.includes('Shape'),
          physics = type === 'PhysicsMaterial',
          theme = type === 'Theme';
        const nodeType = theme
          ? 'Control'
          : shape
            ? type.endsWith('2D')
              ? 'CollisionShape2D'
              : 'CollisionShape3D'
            : physics
              ? 'StaticBody3D'
              : 'MeshInstance3D';
        const property = theme
          ? 'theme'
          : shape
            ? 'shape'
            : physics
              ? 'physics_material_override'
              : type.endsWith('Mesh')
                ? 'mesh'
                : 'material_override';
        ops.push(
          { kind: 'create', parent: '.', name: `R${i}`, type: nodeType },
          { kind: 'resource_assign', path: `R${i}`, property, ref: saved.ref, policy: 'shared' },
        );
        expected[`R${i}`] = { property, type, properties: made.properties };
        if (i === 0) {
          ops.push(
            { kind: 'create', parent: '.', name: 'Shared', type: 'MeshInstance3D' },
            { kind: 'resource_assign', path: 'Shared', property, ref: saved.ref, policy: 'shared' },
            { kind: 'create', parent: '.', name: 'Inline', type: 'MeshInstance3D' },
            { kind: 'resource_assign', path: 'Inline', property, ref: saved.ref, policy: 'make_unique' },
          );
        }
      }
      await call('apply_editor_scene', { operations: ops });
      assert.equal(Object.keys(files).length, resourceTypes.length);
      assert.equal(Object.keys(expected).length, resourceTypes.length - 1);
      assert.equal(approvals, resourceTypes.length + 1);
      const packed = await f.command('test-only-pack');
      assert.equal(packed.pack, 0);
      assert.equal(packed.save, 0);
      const scene = await readFile(path.join(f.root, 'main.tscn'), 'utf8');
      assert.doesNotMatch(scene, /\.harness\/resource-staging/);
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
      await client.close();
      await server.close();
      await f.stop();
      f = await startEditorFixture(process.env.GODOT_PATH!, { writeEnabled: true, scene, files });
      const { manageEditorResource } = await import('../src/editor/resource-service.js');
      const inspect = async (node: string, property: any) =>
        manageEditorResource({
          projectPath: f.root,
          ownerId: 'local-client',
          request: { action: 'reference', path: node, property },
        });
      for (const [node, entry] of Object.entries(expected)) {
        const r = await inspect(node, entry.property);
        assert.equal((r.ref as any).resourceType, entry.type);
        assert.deepEqual(r.properties, entry.properties);
      }
      assert.equal(
        ((await inspect('R0', 'material_override')).ref as any).fingerprint,
        ((await inspect('Shared', 'material_override')).ref as any).fingerprint,
      );
      assert.notEqual(
        ((await inspect('R0', 'material_override')).ref as any).fingerprint,
        ((await inspect('Inline', 'material_override')).ref as any).fingerprint,
      );
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
    } finally {
      await client.close();
      await server.close();
      await f.stop();
    }
  },
);
test(
  'external resources refuse shared mutation, type confusion and forged adoption without modifying files',
  real,
  async () => {
    const material = '[gd_resource type="StandardMaterial3D" format=3]\n[resource]\nroughness = 0.25\n';
    const scene =
      '[gd_scene load_steps=2 format=3]\n[ext_resource type="Material" path="res://shared.tres" id="1"]\n[node name="Main" type="Node3D"]\n[node name="A" type="MeshInstance3D" parent="."]\nmaterial_override = ExtResource("1")\n[node name="Collider" type="CollisionShape3D" parent="."]\n';
    const f = await startEditorFixture(process.env.GODOT_PATH!, {
      writeEnabled: true,
      scene,
      files: { 'shared.tres': material },
    });
    const { manageEditorResource } = await import('../src/editor/resource-service.js');
    const { applyEditorScene } = await import('../src/editor/scene-service.js');
    const base = { projectPath: f.root, ownerId: 'local-client' };
    try {
      const ref = (
        await manageEditorResource({
          ...base,
          request: { action: 'reference', path: 'A', property: 'material_override' },
        })
      ).ref as any;
      const apply = (operations: any[]) =>
        applyEditorScene({
          ...base,
          operations,
          approve: async (p) => ({ actor: base.ownerId, planHash: p.planHash, receipt: 'explicit-test-double' }),
        });
      await assert.rejects(
        apply([
          {
            kind: 'resource_set',
            path: 'A',
            property: 'material_override',
            properties: { roughness: 0.5 },
            policy: 'shared',
          },
        ]),
        { code: 'FORBIDDEN' },
      );
      await assert.rejects(
        apply([{ kind: 'resource_assign', path: 'Collider', property: 'shape', ref, policy: 'shared' }]),
        { code: 'INVALID_ARGUMENT' },
      );
      await assert.rejects(
        manageEditorResource({
          ...base,
          request: { action: 'adopt', path: 'res://shared.tres', sourceHash: '0'.repeat(64) },
        }),
        { code: 'FORBIDDEN' },
      );
      await apply([
        {
          kind: 'resource_set',
          path: 'A',
          property: 'material_override',
          properties: { roughness: 0.5 },
          policy: 'make_unique',
        },
      ]);
      assert.equal(await readFile(path.join(f.root, 'shared.tres'), 'utf8'), material);
      assert.equal(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), scene);
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
    } finally {
      await f.stop();
    }
  },
);

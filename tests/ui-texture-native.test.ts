import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';

const controller = `@tool
extends EditorPlugin
const Core = preload("res://addons/wheel_mcp/scene_service.gd")
const Textures = preload("res://addons/wheel_mcp/texture_service.gd")
func _enter_tree() -> void: set_process(true)
func _process(_delta: float) -> void:
\tvar root := EditorInterface.get_edited_scene_root()
\tif root == null or not FileAccess.file_exists("res://.harness/fixture-command.json"): return
\tvar c: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://.harness/fixture-command.json"))
\tDirAccess.remove_absolute(ProjectSettings.globalize_path("res://.harness/fixture-command.json"))
\tvar history := get_undo_redo().get_history_undo_redo(get_undo_redo().get_object_history_id(root))
\tif c.action == "undo": history.undo()
\tif c.action == "redo": history.redo()
\tif c.action == "mutate": root.get_node("A").texture.gradient.set_color(0, Color.GREEN)
\tif c.action == "restore": root.get_node("A").texture.gradient.set_color(0, Color.RED)
\tif c.action == "hdr": root.get_node("A").texture.use_hdr = c.value
\tif c.action in ["metadata", "clear-metadata"]:
\t\tvar resource: Resource = root.get_node("A").texture
\t\tif c.target == "gradient": resource = (resource as GradientTexture2D).gradient
\t\tif c.action == "metadata": resource.set_meta("opaque", {"path": "res://not-an-authorized-input.png"})
\t\telse: resource.remove_meta("opaque")
\tvar reply := {"id": c.id, "document": Core.document(root), "textures": {}, "config": {}}
\tfor name in ["A", "B", "Unique"]:
\t\tvar node := root.get_node_or_null(name) as TextureRect
\t\tif node != null:
\t\t\treply.config[name] = {"expand_mode": node.expand_mode, "stretch_mode": node.stretch_mode, "flip_h": node.flip_h, "flip_v": node.flip_v}
\t\t\tif node.texture != null: reply.textures[name] = Textures.properties(node.texture)
\tvar file := FileAccess.open("res://.harness/fixture-result.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify(reply))
\tfile.close()
\tif c.action == "quit": get_tree().call_deferred("quit")
`;

test(
  'real stdio TextureRect exact approvals, scoped native gradients, undo and actual save/reopen',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 },
  async () => {
    let f = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      writeEnabled: true,
      scene: '[gd_scene format=3]\n[node name="Main" type="Control"]\n',
    });
    let mutateOnApproval = false;
    const c = await wireEditor(f.root, {
      transport: 'stdio',
      approval: async () => {
        if (mutateOnApproval) {
          await f.command('mutate');
          mutateOnApproval = false;
        }
        return { action: 'accept', content: { confirm: true } }; // MOCK exact-plan approval; native actors are REAL.
      },
    });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await c.call(name, args);
      assert.notEqual(r.isError, true, JSON.stringify(r));
      return r.structuredContent as Record<string, any>;
    };
    const manage = (request: Record<string, unknown>) => call('manage_editor_resource', { request });
    const ui = (node: string, properties: Record<string, unknown>) => ({ kind: 'ui_set', path: node, properties });
    const create = { kind: 'create', parent: '.', name: 'A', type: 'TextureRect' };
    const source = {
      format: 'linear-gradient',
      width: 16,
      height: 8,
      colors: [
        { type: 'Color', r: 1, g: 0, b: 0, a: 1 },
        { type: 'Color', r: 0, g: 0, b: 1, a: 1 },
      ],
    };
    try {
      const original = await readFile(path.join(f.root, 'main.tscn'));
      const initial = (await f.command('inspect')).document;
      const ro = await wireEditor(f.root, { transport: 'stdio', scopes: ['read'] });
      try {
        for (const [tool, args] of [
          ['apply_editor_scene', { operations: [create] }],
          ['manage_editor_resource', { request: { action: 'texture', source } }],
        ] as const)
          assert.equal(((await ro.call(tool, args)).structuredContent as { code: string }).code, 'FORBIDDEN');
      } finally {
        await ro.close();
      }
      const endpointPath = path.join(f.root, '.harness/editor-endpoint.json');
      const endpointBytes = await readFile(endpointPath),
        endpoint = JSON.parse(endpointBytes.toString());
      assert.equal(endpoint.capabilities.length, 28);
      assert.ok(endpoint.capabilities.includes('scene.texture/v1'));
      try {
        for (const capabilities of [
          endpoint.capabilities.filter((x: string) => x !== 'scene.texture/v1'),
          [...endpoint.capabilities, 'overflow'],
        ]) {
          await writeFile(endpointPath, JSON.stringify({ ...endpoint, capabilities })); // Metadata TEST DOUBLE.
          for (const [tool, args] of [
            ['apply_editor_scene', { operations: [create] }],
            ['manage_editor_resource', { request: { action: 'texture', source } }],
          ] as const)
            assert.equal(((await c.call(tool, args)).structuredContent as { code: string }).code, 'PROTOCOL_MISMATCH');
        }
      } finally {
        await writeFile(endpointPath, endpointBytes);
      }
      const texture = await manage({ action: 'texture', source });
      assert.deepEqual(texture.properties, source);
      const ref = texture.ref;
      const assign = (node: string, resource = ref, policy = 'shared') => ({
        kind: 'resource_assign',
        path: node,
        property: 'texture',
        ref: resource,
        policy,
      });
      await call('apply_editor_scene', {
        operations: [
          create,
          ui('A', {
            offset_left: 24,
            offset_top: 24,
            offset_right: 264,
            offset_bottom: 144,
            expand_mode: 1,
            stretch_mode: 5,
          }),
          assign('A'),
          { ...create, name: 'B' },
          ui('B', { offset_left: 300, offset_top: 24, offset_right: 540, offset_bottom: 144, expand_mode: 1 }),
          assign('B'),
          { ...create, name: 'Unique' },
          ui('Unique', { offset_left: 24, offset_top: 180, offset_right: 264, offset_bottom: 300, expand_mode: 1 }),
          assign('Unique', ref, 'make_unique'),
        ],
      });
      const created = await f.command('inspect');
      assert.equal(created.document.nodes.length, 4);
      assert.deepEqual(created.textures.A, source);
      assert.deepEqual(created.textures.B, source);
      assert.deepEqual((await f.command('undo')).document, initial);
      assert.deepEqual((await f.command('redo')).document, created.document);
      const reference = async (node: string) => manage({ action: 'reference', path: node, property: 'texture' });
      const a = await reference('A'),
        b = await reference('B'),
        unique = await reference('Unique');
      assert.equal(a.ref.fingerprint, b.ref.fingerprint);
      assert.notEqual(a.ref.fingerprint, unique.ref.fingerprint);
      assert.deepEqual((await manage({ action: 'read', ref: unique.ref })).properties, source);
      const other = await wireEditor(f.root, { transport: 'memory' }); // Independent local-client owner, official SDK transport.
      try {
        assert.equal(
          (
            (await other.call('manage_editor_resource', { request: { action: 'read', ref } })).structuredContent as {
              code: string;
            }
          ).code,
          'FORBIDDEN',
        );
      } finally {
        await other.close();
      }
      const duplicate = await manage({ action: 'duplicate', ref });
      await manage({ action: 'release', ref: duplicate.ref });
      assert.equal(
        (
          (await c.call('manage_editor_resource', { request: { action: 'read', ref: duplicate.ref } }))
            .structuredContent as { code: string }
        ).code,
        'NOT_FOUND',
      );
      for (const mode of [0, 1, 2, 3, 4, 5, 6]) {
        await call('apply_editor_scene', {
          operations: [ui('A', { stretch_mode: mode, expand_mode: 0, flip_h: true, flip_v: true })],
        });
        const changed = await f.command('inspect');
        assert.deepEqual(changed.config.A, { stretch_mode: mode, expand_mode: 0, flip_h: true, flip_v: true });
        assert.deepEqual((await f.command('undo')).document, created.document);
        assert.deepEqual((await f.command('redo')).document, changed.document);
        assert.deepEqual((await f.command('undo')).document, created.document);
      }
      const refuse = async (operations: Record<string, unknown>[], code: string) => {
        const r = await c.call('apply_editor_scene', { operations });
        assert.equal((r.structuredContent as { code: string }).code, code, JSON.stringify(r));
        assert.deepEqual((await f.command('inspect')).document, created.document);
        assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), original);
      };
      await refuse([ui('.', { flip_h: true })], 'UNSUPPORTED');
      await refuse([{ ...create, name: 'NoResidue' }, ui('.', { expand_mode: 1 })], 'UNSUPPORTED');
      const wrong = await manage({ action: 'create', resourceType: 'StandardMaterial3D', properties: {} });
      await refuse([assign('A', wrong.ref)], 'INVALID_ARGUMENT');
      await refuse([assign('A', { ...ref, fingerprint: 'f'.repeat(64) })], 'FORBIDDEN');
      await refuse(
        [{ kind: 'resource_set', path: 'A', property: 'texture', properties: { width: 32 }, policy: 'shared' }],
        'UNSUPPORTED',
      );
      mutateOnApproval = true;
      const stale = await c.call('apply_editor_scene', { operations: [ui('A', { flip_h: true })] });
      assert.equal((stale.structuredContent as { code: string }).code, 'CONFLICT');
      assert.equal(
        (
          (await c.call('manage_editor_resource', { request: { action: 'read', ref } })).structuredContent as {
            code: string;
          }
        ).code,
        'CONFLICT',
      );
      await f.command('restore');
      assert.deepEqual((await f.command('inspect')).document, created.document);
      await f.command('hdr', { value: true }); // Out-of-contract live resource TEST DOUBLE.
      const rejectedSave = await c.call('save_editor_scene');
      assert.equal((rejectedSave.structuredContent as { code: string }).code, 'CONFLICT', JSON.stringify(rejectedSave));
      assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), original);
      await f.command('hdr', { value: false });
      assert.deepEqual((await f.command('inspect')).document, created.document);
      for (const target of ['texture', 'gradient']) {
        await f.command('metadata', { target }); // Explicit opaque live graph TEST DOUBLE.
        const save = await c.call('save_editor_scene');
        assert.equal((save.structuredContent as { code: string }).code, 'CONFLICT', JSON.stringify(save));
        assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), original);
        await f.command('clear-metadata', { target });
        assert.deepEqual((await f.command('inspect')).document, created.document);
      }
      const exported = await call('save_editor_resource', { ref, filePath: 'gradient.tres', expectedSha256: null });
      assert.equal(exported.persisted, true);
      assert.equal(exported.validation, 'PASS');
      assert.deepEqual((await manage({ action: 'read', ref: exported.ref })).properties, source);
      await refuse([assign('B', exported.ref)], 'FORBIDDEN');
      await call('apply_editor_scene', { operations: [assign('B', exported.ref, 'make_unique')] });
      const saved = await call('save_editor_scene');
      assert.equal(saved.persisted, true);
      assert.equal(saved.validation, 'PASS');
      const beforeReopen = await f.command('inspect');
      const resourceBytes = await readFile(path.join(f.root, 'gradient.tres'));
      assert.doesNotMatch((await readFile(path.join(f.root, 'main.tscn'))).toString(), /resource-staging/);
      const root = f.root;
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
      await f.command('quit');
      await f.exited;
      f = await startEditorFixture(process.env.GODOT_PATH!, { existingRoot: root, controller, writeEnabled: true });
      const reopened = await f.command('inspect');
      assert.deepEqual(reopened.config, beforeReopen.config);
      assert.deepEqual(reopened.textures, beforeReopen.textures);
      const authored = (d: any) => {
        const paths = new Map(d.nodes.map((n: any) => [n.id, n.path]));
        const ids = new Map();
        return d.nodes.map((n: any) => {
          const properties = { ...n.properties };
          if (properties.texture?.resourceType) {
            const r = properties.texture;
            if (!ids.has(r.id)) ids.set(r.id, ids.size);
            properties.texture = {
              ...r,
              id: ids.get(r.id),
              path: r.path === '' || r.path.includes('::') ? 'inline' : r.path,
            };
          }
          return {
            ...n,
            id: n.path,
            owner: paths.get(n.owner) ?? null,
            properties,
            signals: n.signals.map((s: any) => ({ ...s, target: paths.get(s.target) })),
          };
        });
      };
      assert.deepEqual(authored(reopened.document), authored(beforeReopen.document));
      assert.deepEqual(await readFile(path.join(root, 'gradient.tres')), resourceBytes);
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
    } finally {
      await c.close();
      await f.stop();
    }
  },
);

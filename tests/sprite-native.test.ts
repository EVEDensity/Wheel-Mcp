import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';
import { pixelPng } from './helpers/png-fixture.js';

const controller = `@tool
extends EditorPlugin
const Core = preload("res://addons/wheel_mcp/scene_service.gd")
const Sprites = preload("res://addons/wheel_mcp/sprite_service.gd")
var watched: Sprite2D
var callbacks := 0
var original_texture: Texture2D
func _changed() -> void: callbacks += 1
func _enter_tree() -> void: set_process(true)
func _process(_delta: float) -> void:
\tvar root := EditorInterface.get_edited_scene_root()
\tif root == null or not FileAccess.file_exists("res://.harness/fixture-command.json"): return
\tvar c: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://.harness/fixture-command.json"))
\tDirAccess.remove_absolute(ProjectSettings.globalize_path("res://.harness/fixture-command.json"))
\tvar history := get_undo_redo().get_history_undo_redo(get_undo_redo().get_object_history_id(root))
\tvar sprite := root.get_node_or_null("A") as Sprite2D
\tif c.action == "watch":
\t\twatched = sprite
\t\twatched.texture_changed.connect(_changed)
\tif c.action == "unwatch":
\t\twatched.texture_changed.disconnect(_changed)
\t\twatched = null
\tif c.action == "frame-on": sprite.hframes = 2
\tif c.action == "frame-off": sprite.hframes = 1
\tif c.action == "region-on": sprite.region_enabled = true
\tif c.action == "region-off": sprite.region_enabled = false
\tif c.action == "material-on": sprite.material = CanvasItemMaterial.new()
\tif c.action == "material-off": sprite.material = null
\tif c.action == "external-on":
\t\toriginal_texture = sprite.texture
\t\tsprite.texture = load("res://sprite.tres")
\tif c.action == "external-off":
\t\tsprite.texture = original_texture
\t\toriginal_texture = null
\tif c.action == "undo": history.undo()
\tif c.action == "redo": history.redo()
\tvar reply := {"id": c.id, "document": Core.document(root), "callbacks": callbacks, "textures": {}}
\tfor name in ["A", "B", "C"]:
\t\tvar node := root.get_node_or_null(name) as Sprite2D
\t\tif node != null and node.texture != null: reply.textures[name] = node.texture.get_instance_id()
\tvar file := FileAccess.open("res://.harness/fixture-result.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify(reply)); file.close()
\tif c.action == "quit": get_tree().call_deferred("quit")
`;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
test(
  'real stdio Sprite2D exact plans, native texture ownership, callback/CAS guards and saved reopen',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 },
  async () => {
    let f = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      writeEnabled: true,
      scene: '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n',
    });
    let attach = false,
      decline = false,
      tamper = false;
    const png = pixelPng(),
      file = path.join(f.root, 'icon.png');
    const c = await wireEditor(f.root, {
      transport: 'stdio',
      approval: async () => {
        if (attach) {
          await f.command('watch');
          attach = false;
        }
        if (tamper) {
          await writeFile(file, pixelPng(1, 1));
          tamper = false;
        }
        return { action: decline ? 'decline' : 'accept', content: { confirm: !decline } }; // MOCK only.
      },
    });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await c.call(name, args);
      assert.notEqual(r.isError, true, JSON.stringify(r));
      return r.structuredContent as Record<string, any>;
    };
    const sprite = (properties: Record<string, unknown>, node = 'A') => ({
      kind: 'sprite_set',
      path: node,
      properties,
    });
    const v2 = (x: number, y: number) => ({ type: 'Vector2', x, y });
    try {
      const original = await readFile(path.join(f.root, 'main.tscn'));
      const initial = (await f.command('inspect')).document;
      const create = { kind: 'create', parent: '.', name: 'A', type: 'Sprite2D' };
      const ro = await wireEditor(f.root, { transport: 'stdio', scopes: ['read'] });
      try {
        assert.equal(
          ((await ro.call('apply_editor_scene', { operations: [create] })).structuredContent as { code: string }).code,
          'FORBIDDEN',
        );
      } finally {
        await ro.close();
      }
      const endpointPath = path.join(f.root, '.harness/editor-endpoint.json'),
        metadata = await readFile(endpointPath);
      const endpoint = JSON.parse(metadata.toString());
      assert.equal(endpoint.capabilities.length, 29);
      try {
        for (const capabilities of [
          endpoint.capabilities.filter((v: string) => v !== 'scene.sprite2d/v1'),
          [...endpoint.capabilities, 'overflow'],
        ]) {
          await writeFile(endpointPath, JSON.stringify({ ...endpoint, capabilities })); // Metadata TEST DOUBLE.
          assert.equal(
            ((await c.call('apply_editor_scene', { operations: [create] })).structuredContent as { code: string }).code,
            'PROTOCOL_MISMATCH',
          );
        }
      } finally {
        await writeFile(endpointPath, metadata);
      }
      await writeFile(file, png);
      const image = await call('manage_editor_resource', {
        request: { action: 'png_texture', path: 'icon.png', sourceHash: sha(png) },
      });
      const assign = (node: string, policy = 'shared') => ({
        kind: 'resource_assign',
        path: node,
        property: 'texture',
        ref: image.ref,
        policy,
      });
      const operations = [
        create,
        { ...create, name: 'B' },
        { ...create, name: 'C' },
        sprite({ centered: false, flip_h: true, flip_v: true, offset: v2(-2, 3) }),
        { kind: 'set', path: 'A', property: 'position', value: v2(80, 90) },
        assign('A'),
        assign('B'),
        assign('C', 'make_unique'),
      ];
      decline = true;
      assert.equal(
        ((await c.call('apply_editor_scene', { operations })).structuredContent as { code: string }).code,
        'FORBIDDEN',
      );
      decline = false;
      tamper = true;
      assert.equal(
        ((await c.call('apply_editor_scene', { operations })).structuredContent as { code: string }).code,
        'CONFLICT',
      );
      assert.deepEqual((await f.command('inspect')).document, initial);
      await writeFile(file, png);
      await call('apply_editor_scene', { operations });
      const created = await f.command('inspect');
      assert.equal(created.textures.A, created.textures.B);
      assert.notEqual(created.textures.A, created.textures.C);
      // Late callbacks must not execute when native Undo/Redo reassigns texture.
      await f.command('watch');
      await f.command('undo');
      await f.command('redo');
      await f.command('unwatch');
      assert.equal((await f.command('inspect')).callbacks, 0);
      assert.deepEqual((await f.command('undo')).document, initial);
      assert.deepEqual((await f.command('redo')).document, created.document);
      const gradient = await call('manage_editor_resource', {
        request: {
          action: 'texture',
          source: {
            format: 'linear-gradient',
            width: 8,
            height: 8,
            colors: [
              { type: 'Color', r: 1, g: 0, b: 0, a: 1 },
              { type: 'Color', r: 0, g: 0, b: 1, a: 1 },
            ],
          },
        },
      });
      await call('apply_editor_scene', { operations: [{ ...assign('C'), ref: gradient.ref }] });
      const gradientState = await f.command('inspect');
      assert.equal(
        gradientState.document.nodes.find((n: any) => n.path === 'C').properties.texture.resourceType,
        'GradientTexture2D',
      );
      assert.deepEqual((await f.command('undo')).document, created.document);
      assert.deepEqual((await f.command('redo')).document, gradientState.document);
      assert.deepEqual((await f.command('undo')).document, created.document);
      const refuse = async (ops: Record<string, unknown>[], code: string) => {
        const r = await c.call('apply_editor_scene', { operations: ops });
        assert.equal((r.structuredContent as { code: string }).code, code, JSON.stringify(r));
        assert.deepEqual((await f.command('inspect')).document, created.document);
        assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), original);
      };
      await refuse([{ ...create, name: 'MustNotRemain' }, sprite({ centered: true }, '.')], 'UNSUPPORTED');
      await refuse([{ kind: 'ui_set', path: 'A', properties: { flip_h: false } }], 'INVALID_ARGUMENT');
      await f.command('watch');
      assert.equal(
        (
          (await c.call('apply_editor_scene', { operations: [sprite({ centered: true })] })).structuredContent as {
            code: string;
          }
        ).code,
        'CONFLICT',
      );
      await f.command('unwatch');
      attach = true;
      assert.equal(
        (
          (await c.call('apply_editor_scene', { operations: [sprite({ centered: true })] })).structuredContent as {
            code: string;
          }
        ).code,
        'CONFLICT',
      );
      await f.command('unwatch');
      for (const mode of ['frame', 'region', 'material']) {
        await f.command(mode + '-on');
        // Unknown CanvasItemMaterial is rejected first by the existing stored
        // resource graph guard, before the Sprite-specific setting validator.
        const expectedCode = mode === 'material' ? 'CONFLICT' : 'UNSUPPORTED';
        assert.equal(
          (
            (await c.call('apply_editor_scene', { operations: [sprite({ centered: true })] })).structuredContent as {
              code: string;
            }
          ).code,
          expectedCode,
          mode + ' edit refusal',
        );
        assert.equal(
          ((await c.call('save_editor_scene')).structuredContent as { code: string }).code,
          expectedCode,
          mode + ' save refusal',
        );
        assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), original);
        await f.command(mode + '-off');
        assert.deepEqual((await f.command('inspect')).document, created.document);
      }
      assert.deepEqual((await f.command('inspect')).document, created.document);
      const ref = await call('manage_editor_resource', {
        request: { action: 'reference', path: 'A', property: 'texture' },
      });
      const exported = await call('save_editor_resource', {
        ref: ref.ref,
        filePath: 'sprite.tres',
        expectedSha256: null,
      });
      await refuse([{ ...assign('A'), ref: exported.ref }], 'FORBIDDEN');
      await f.command('external-on'); // Known native exported texture, not an arbitrary resource loader.
      assert.equal(((await c.call('save_editor_scene')).structuredContent as { code: string }).code, 'CONFLICT');
      assert.equal(
        (
          (await c.call('apply_editor_scene', { operations: [sprite({ centered: true })] })).structuredContent as {
            code: string;
          }
        ).code,
        'CONFLICT',
      );
      assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), original);
      await f.command('external-off');
      assert.deepEqual((await f.command('inspect')).document, created.document);
      await call('apply_editor_scene', { operations: [{ ...assign('C', 'make_unique'), ref: exported.ref }] });
      const saved = await call('save_editor_scene');
      assert.equal(saved.persisted, true);
      assert.equal(saved.validation, 'PASS');
      const before = await f.command('inspect'),
        bytes = await readFile(path.join(f.root, 'main.tscn')),
        root = f.root;
      assert.doesNotMatch(bytes.toString(), /icon\.png|sprite\.tres|\.import/);
      await f.command('quit');
      await f.exited;
      f = await startEditorFixture(process.env.GODOT_PATH!, { existingRoot: root, controller, writeEnabled: true });
      const reopened = await f.command('inspect');
      const normalize = (doc: any) => {
        const ids = new Map(doc.nodes.map((n: any) => [n.id, n.path]));
        const resources = new Map();
        return doc.nodes.map((n: any) => {
          const texture = n.properties.texture;
          if (texture && !resources.has(texture.id)) resources.set(texture.id, resources.size);
          return {
            ...n,
            id: n.path,
            owner: ids.get(n.owner) ?? null,
            properties: texture
              ? { ...n.properties, texture: { ...texture, id: resources.get(texture.id), path: 'inline' } }
              : n.properties,
          };
        });
      };
      assert.deepEqual(normalize(reopened.document), normalize(before.document));
      assert.equal(reopened.textures.A, reopened.textures.B);
      assert.notEqual(reopened.textures.A, reopened.textures.C);
      assert.deepEqual(await readFile(path.join(root, 'main.tscn')), bytes);
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
    } finally {
      await c.close();
      await f.stop();
    }
  },
);

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';
import { EditorBridge } from '../src/editor/editor-bridge.js';
import { pixelPng } from './helpers/png-fixture.js';

const controller = `@tool
extends EditorPlugin
const Core = preload("res://addons/wheel_mcp/scene_service.gd")
const Png = preload("res://addons/wheel_mcp/png_texture.gd")
func _enter_tree() -> void: set_process(true)
func _process(_delta: float) -> void:
\tvar root := EditorInterface.get_edited_scene_root()
\tif root == null or not FileAccess.file_exists("res://.harness/fixture-command.json"): return
\tvar c: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://.harness/fixture-command.json"))
\tDirAccess.remove_absolute(ProjectSettings.globalize_path("res://.harness/fixture-command.json"))
\tvar history := get_undo_redo().get_history_undo_redo(get_undo_redo().get_object_history_id(root))
\tif c.action == "undo": history.undo()
\tif c.action == "redo": history.redo()
\tvar reply := {"id": c.id, "document": Core.document(root), "pixels": {}}
\tfor name in ["A", "B"]:
\t\tvar node := root.get_node_or_null(name) as TextureRect
\t\tif node != null and node.texture != null: reply.pixels[name] = Png.properties(node.texture)
\tvar file := FileAccess.open("res://.harness/fixture-result.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify(reply)); file.close()
\tif c.action == "quit": get_tree().call_deferred("quit")
`;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
test(
  'real stdio PNG snapshots bind source CAS through approval/native commit, then save independent native pixels',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 },
  async () => {
    let f = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      writeEnabled: true,
      scene: '[gd_scene format=3]\n[node name="Main" type="Control"]\n',
    });
    let tamper = false,
      decline = false;
    const png = pixelPng(),
      pngPath = path.join(f.root, 'icon.png');
    const previews: string[] = [];
    const c = await wireEditor(f.root, {
      transport: 'stdio',
      approval: async (message) => {
        previews.push(message);
        if (tamper) {
          await writeFile(pngPath, pixelPng(1, 1));
          tamper = false;
        }
        return { action: decline ? 'decline' : 'accept', content: { confirm: !decline } }; // MOCK approval only.
      },
    });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await c.call(name, args);
      assert.notEqual(r.isError, true, JSON.stringify(r));
      return r.structuredContent as Record<string, any>;
    };
    const manage = (request: Record<string, unknown>) => call('manage_editor_resource', { request });
    const request = { action: 'png_texture', path: 'res://icon.png', sourceHash: sha(png) };
    const create = { kind: 'create', parent: '.', name: 'A', type: 'TextureRect' };
    try {
      const imported = await call('import_project_png', {
        path: 'icon.png',
        dataBase64: png.toString('base64'),
        expectedSha256: null,
      });
      assert.equal(imported.validation, 'PASS');
      assert.equal(imported.editorSynchronization.status, 'OBSERVED');
      const state = await call('get_editor_state');
      assert.ok(state.filesystem.progress >= 0 && state.filesystem.progress <= 1);
      const original = await readFile(path.join(f.root, 'main.tscn'));
      const initial = (await f.command('inspect')).document;
      const ro = await wireEditor(f.root, { transport: 'stdio', scopes: ['read'] });
      try {
        assert.equal(
          ((await ro.call('manage_editor_resource', { request })).structuredContent as { code: string }).code,
          'FORBIDDEN',
        );
      } finally {
        await ro.close();
      }
      const endpointPath = path.join(f.root, '.harness/editor-endpoint.json');
      const endpointBytes = await readFile(endpointPath),
        endpoint = JSON.parse(endpointBytes.toString());
      assert.equal(endpoint.capabilities.length, 26);
      try {
        for (const capabilities of [
          endpoint.capabilities.filter((v: string) => v !== 'scene.png_texture/v1'),
          [...endpoint.capabilities, 'overflow'],
        ]) {
          await writeFile(endpointPath, JSON.stringify({ ...endpoint, capabilities })); // Metadata TEST DOUBLE.
          const denied = await c.call('manage_editor_resource', { request: { ...request, path: 'missing.png' } });
          assert.equal((denied.structuredContent as { code: string }).code, 'PROTOCOL_MISMATCH');
        }
      } finally {
        await writeFile(endpointPath, endpointBytes);
      }
      const made = await manage(request),
        ref = made.ref;
      assert.deepEqual(made.sourceHashes, { 'res://icon.png': sha(png) });
      assert.equal(made.properties.rgba8, 'ff0000ff0000ffff');
      const rgb = pixelPng(2, 1, true);
      await writeFile(path.join(f.root, 'rgb.png'), rgb);
      const rgbMade = await manage({ ...request, path: 'rgb.png', sourceHash: sha(rgb) });
      assert.deepEqual(rgbMade.properties, made.properties);
      const assign = { kind: 'resource_assign', path: 'A', property: 'texture', ref, policy: 'shared' };
      const operations = [
        create,
        { kind: 'ui_set', path: 'A', properties: { offset_right: 240, offset_bottom: 120, expand_mode: 1 } },
        assign,
      ];
      const duplicate = await manage({ action: 'duplicate', ref });
      await writeFile(pngPath, pixelPng(1, 1));
      for (const sourceRef of [ref, duplicate.ref])
        assert.equal(
          (
            (await c.call('manage_editor_resource', { request: { action: 'read', ref: sourceRef } }))
              .structuredContent as { code: string }
          ).code,
          'CONFLICT',
        );
      await writeFile(pngPath, png);
      assert.equal(
        (
          (await c.call('manage_editor_resource', { request: { action: 'export', ref } })).structuredContent as {
            code: string;
          }
        ).code,
        'UNSUPPORTED',
      );
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
      assert.ok(previews.some((p) => p.includes('res://icon.png') && p.includes(sha(png))));
      assert.deepEqual((await f.command('inspect')).document, initial);
      assert.deepEqual(await readFile(path.join(f.root, 'main.tscn')), original);
      await writeFile(pngPath, png);
      // Authorized private RPC TEST CONTROL bypasses the host only to verify
      // native final CAS. It is not a product approval or a second client claim.
      const bridge = await EditorBridge.connect({ projectPath: f.root, ownerId: ref.ownerId });
      try {
        const operationId = 'png-native-cas-negative';
        const plan = (await bridge.sceneRequest('scene.prepare', { operationId, operations })) as Record<string, any>;
        assert.equal(plan.status, 'PASS', JSON.stringify(plan));
        assert.deepEqual(plan.dependencyHashes, { 'res://icon.png': sha(png) });
        await writeFile(pngPath, pixelPng(1, 1));
        const result = (await bridge.sceneRequest('scene.commit', {
          operationId,
          planId: plan.planId,
          planHash: plan.planHash,
        })) as Record<string, any>;
        assert.equal(result.code, 'CONFLICT', JSON.stringify(result));
      } finally {
        bridge.close();
      }
      await writeFile(pngPath, png);
      assert.deepEqual((await f.command('inspect')).document, initial);
      await call('apply_editor_scene', { operations });
      const created = await f.command('inspect');
      assert.equal(created.pixels.A.rgba8, made.properties.rgba8);
      assert.deepEqual((await f.command('undo')).document, initial);
      assert.deepEqual((await f.command('redo')).document, created.document);
      await unlink(pngPath); // Deliberately remove only the test source after approved embedding.
      const inline = await manage({ action: 'reference', path: 'A', property: 'texture' });
      assert.equal((await manage({ action: 'read', ref: inline.ref })).properties.rgba8, made.properties.rgba8);
      const exported = await call('save_editor_resource', {
        ref: inline.ref,
        filePath: 'pixels.tres',
        expectedSha256: null,
      });
      assert.equal(exported.validation, 'PASS');
      assert.equal((await manage({ action: 'read', ref: exported.ref })).properties.rgba8, made.properties.rgba8);
      const saved = await call('save_editor_scene');
      assert.equal(saved.persisted, true);
      assert.equal(saved.validation, 'PASS');
      const savedBytes = await readFile(path.join(f.root, 'main.tscn'));
      assert.doesNotMatch(savedBytes.toString(), /icon\.png|rgb\.png|\.import|resource-staging/);
      const before = await f.command('inspect'),
        root = f.root;
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
      await f.command('quit');
      await f.exited;
      f = await startEditorFixture(process.env.GODOT_PATH!, { existingRoot: root, controller, writeEnabled: true });
      const reopened = await f.command('inspect');
      assert.deepEqual(reopened.pixels, before.pixels);
      const normalize = (d: any) =>
        d.nodes.map((n: any) => ({
          ...n,
          id: n.path,
          owner: n.owner ? '.' : null,
          properties: n.properties.texture
            ? { ...n.properties, texture: { ...n.properties.texture, id: 'inline-texture', path: 'inline' } }
            : n.properties,
        }));
      assert.deepEqual(normalize(reopened.document), normalize(before.document));
      assert.deepEqual(await readFile(path.join(root, 'main.tscn')), savedBytes);
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
    } finally {
      await c.close();
      await f.stop();
    }
  },
);

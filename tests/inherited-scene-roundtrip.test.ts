import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { link, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';
import { applyEditorScene } from '../src/editor/scene-service.js';
import { saveEditorScene } from '../src/editor/scene-save.js';
import { fixtureApproval } from './helpers/project-approval.js';

const real = { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 120000 };
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const base =
  '[gd_scene format=3]\n[node name="Base" type="Node2D"]\nposition = Vector2(1, 2)\n[node name="Tip" type="Marker2D" parent="."]\nposition = Vector2(10, 20)\n';
const derived = (file: string, name: string) =>
  `[gd_scene load_steps=2 format=3]\n[ext_resource type="PackedScene" path="res://${file}" id="base"]\n[node name="${name}" instance=ExtResource("base")]\n`;
const files = {
  'base.tscn': base,
  'middle.tscn': derived('base.tscn', 'Middle'),
  'top.tscn': derived('middle.tscn', 'Top'),
};
const controller = `@tool
extends EditorPlugin
const Core = preload("res://addons/wheel_mcp/scene_service.gd")
func _enter_tree() -> void: set_process(true)
func _process(_delta: float) -> void:
\tvar root := EditorInterface.get_edited_scene_root()
\tif root == null or not FileAccess.file_exists("res://.harness/fixture-command.json"): return
\tvar c: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://.harness/fixture-command.json"))
\tDirAccess.remove_absolute(ProjectSettings.globalize_path("res://.harness/fixture-command.json"))
\tvar manager := get_undo_redo()
\tvar history := manager.get_history_undo_redo(manager.get_object_history_id(root))
\tif c.action == "undo": history.undo()
\tif c.action == "redo": history.redo()
\tif c.action == "register-uid":
\t\tvar identity := ResourceUID.create_id()
\t\tResourceUID.add_id(identity, "res://main.tscn")
\t\tc["uid"] = ResourceUID.id_to_text(identity)
\tvar packed := PackedScene.new()
\tpacked.pack(root)
\tvar inherited: Array[String] = []
\tvar state: SceneState = packed.get_state().get_base_scene_state()
\twhile state != null and inherited.size() < 16:
\t\tinherited.append(state.get_path())
\t\tstate = state.get_base_scene_state()
\tvar values: Dictionary = {}
\tfor node in Core._nodes(root):
\t\tvalues[str(root.get_path_to(node))] = {"position": [node.position.x, node.position.y], "owner": str(root.get_path_to(node.owner)) if node.owner != null else null, "editable": root.is_editable_instance(node) if node != root else false}
\tvar reply := {"id": c.id, "uid": c.get("uid"), "values": values, "inherited": inherited, "history": history.get_version(), "document": Core.document(root)}
\tvar file := FileAccess.open("res://.harness/fixture-result.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify(reply))
\tfile.close()
\tif c.action == "quit": get_tree().call_deferred("quit")
`;
const result = (r: any) => {
  assert.notEqual(r.isError, true, JSON.stringify(r));
  return r.structuredContent;
};

test(
  'official MCP three-level inherited override saves and reopens without flattening; base changes still propagate',
  real,
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      writeEnabled: true,
      scene: derived('top.tscn', 'Main'),
      files,
    });
    const c = await wireEditor(f.root);
    let reopened: Awaited<ReturnType<typeof startEditorFixture>> | undefined;
    try {
      const initial = await f.command('inspect');
      assert.deepEqual(initial.inherited, ['res://top.tscn', 'res://middle.tscn', 'res://base.tscn']);
      assert.deepEqual(initial.values.Tip.position, [10, 20]);
      const forbidden = await c.call('apply_editor_scene', {
        operations: [{ kind: 'set', path: 'Tip', property: 'visible', value: false }],
      });
      assert.equal((forbidden.structuredContent as any).code, 'FORBIDDEN');
      result(
        await c.call('apply_editor_scene', {
          operations: [
            { kind: 'override', path: 'Tip', property: 'position', value: { type: 'Vector2', x: 99, y: 88 } },
          ],
        }),
      );
      assert.deepEqual((await f.command('inspect')).values.Tip.position, [99, 88]);
      assert.deepEqual((await f.command('undo')).values.Tip.position, [10, 20]);
      assert.deepEqual((await f.command('redo')).values.Tip.position, [99, 88]);
      assert.equal(result(await c.call('save_editor_scene')).validation, 'PASS');
      const saved = await readFile(path.join(f.root, 'main.tscn'), 'utf8');
      assert.match(saved, /path="res:\/\/top.tscn"/);
      assert.match(saved, /instance=ExtResource/);
      assert.doesNotMatch(saved, /node name="Tip" type=/, 'Inherited Tip must stay an override, not a local copy');
      for (const [file, bytes] of Object.entries(files))
        assert.equal(await readFile(path.join(f.root, file), 'utf8'), bytes);
      await f.command('quit');
      await f.exited;
      await writeFile(path.join(f.root, 'base.tscn'), base.replace('Vector2(1, 2)', 'Vector2(50, 60)'));
      reopened = await startEditorFixture(process.env.GODOT_PATH!, {
        existingRoot: f.root,
        controller,
        writeEnabled: true,
      });
      const after = await reopened.command('inspect');
      assert.deepEqual(after.values.Tip.position, [99, 88]);
      assert.deepEqual(
        after.values['.'].position,
        [50, 60],
        'Unmodified base properties must propagate through the chain',
      );
      assert.equal(after.inherited.length, 3);
      const freshClient = await wireEditor(reopened.root);
      try {
        result(
          await freshClient.call('apply_editor_scene', {
            operations: [
              { kind: 'override', path: 'Tip', property: 'position', value: { type: 'Vector2', x: 90, y: 80 } },
            ],
          }),
        );
        result(await freshClient.call('save_editor_scene'));
      } finally {
        await freshClient.close();
      }
      assert.doesNotMatch(f.output() + reopened.output(), /SCRIPT ERROR|\bERROR:/);
    } finally {
      await c.close();
      await reopened?.stop();
      await f.stop();
    }
  },
);

test(
  'three nested instances require editable children for deep overrides; native flags and owners survive undo/save/reopen',
  real,
  async () => {
    const leaf =
      '[gd_scene format=3]\n[node name="Leaf" type="Node2D"]\n[node name="Tip" type="Marker2D" parent="."]\nposition = Vector2(10, 20)\n';
    const instance = (file: string, name: string, child: string) =>
      `[gd_scene load_steps=2 format=3]\n[ext_resource type="PackedScene" path="res://${file}" id="child"]\n[node name="${name}" type="Node2D"]\n[node name="${child}" parent="." instance=ExtResource("child")]\n`;
    const f = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      writeEnabled: true,
      files: {
        'leaf.tscn': leaf,
        'middle.tscn': instance('leaf.tscn', 'Middle', 'Inner'),
        'top.tscn': instance('middle.tscn', 'Top', 'Middle'),
      },
      scene: instance('top.tscn', 'Main', 'Branch'),
    });
    const c = await wireEditor(f.root);
    let reopened: Awaited<ReturnType<typeof startEditorFixture>> | undefined;
    const target = 'Branch/Middle/Inner/Tip',
      boundary = 'Branch/Middle/Inner';
    try {
      const original = await f.command('inspect');
      assert.equal(original.inherited.length, 0, 'Nested instances must not be reported as root inheritance');
      const operations = [
        { kind: 'override', path: target, property: 'position', value: { type: 'Vector2', x: 77, y: 66 } },
      ];
      assert.equal(((await c.call('apply_editor_scene', { operations })).structuredContent as any)?.code, 'FORBIDDEN');
      const incomplete = await c.call('apply_editor_scene', {
        operations: [{ kind: 'editable_children', path: boundary, enabled: true }, ...operations],
      });
      assert.equal(
        (incomplete.structuredContent as any).code,
        'FORBIDDEN',
        'Every intervening instance boundary must be explicit to preserve nested overrides',
      );
      result(
        await c.call('apply_editor_scene', {
          operations: ['Branch', 'Branch/Middle', boundary]
            .map((p) => ({ kind: 'editable_children', path: p, enabled: true }))
            .concat(operations as any),
        }),
      );
      const edited = await f.command('inspect');
      assert.deepEqual(edited.values[target].position, [77, 66]);
      assert.equal(edited.values[boundary].editable, true);
      assert.equal(edited.values[target].owner, boundary);
      const undo = await f.command('undo');
      assert.deepEqual(undo.document, original.document);
      assert.deepEqual((await f.command('redo')).document, edited.document);
      result(
        await c.call('apply_editor_scene', {
          operations: [{ kind: 'editable_children', path: 'Branch', enabled: false }],
        }),
      );
      const refusedSave = await c.call('save_editor_scene');
      assert.equal(
        (refusedSave.structuredContent as any).code,
        'CONFLICT',
        'Losing nested overrides must fail before disk save',
      );
      await f.command('undo');
      result(await c.call('save_editor_scene'));
      await f.command('quit');
      await f.exited;
      reopened = await startEditorFixture(process.env.GODOT_PATH!, {
        existingRoot: f.root,
        controller,
        writeEnabled: true,
      });
      const persisted = await reopened.command('inspect');
      assert.deepEqual(persisted.values[target].position, [77, 66]);
      assert.equal(persisted.values[boundary].editable, true);
      assert.equal(persisted.values[target].owner, boundary);
      assert.doesNotMatch(f.output() + reopened.output(), /SCRIPT ERROR|\bERROR:/);
    } finally {
      await c.close();
      await reopened?.stop();
      await f.stop();
    }
  },
);

test(
  'dependency content changed before preview conflicts with stale live SceneState; no silent cache reuse',
  real,
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      writeEnabled: true,
      scene: derived('top.tscn', 'Main'),
      files,
    });
    try {
      await writeFile(path.join(f.root, 'base.tscn'), base.replace('Vector2(10, 20)', 'Vector2(100, 200)'));
      await assert.rejects(
        applyEditorScene({
          projectPath: f.root,
          ownerId: 'local-client',
          operations: [{ kind: 'override', path: 'Tip', property: 'visible', value: false }],
          approve: async () => {
            throw new Error('Stale native scene must not reach approval');
          },
        }),
        { code: 'CONFLICT' },
      );
    } finally {
      await f.stop();
    }
  },
);

test(
  'transitive dependency change after exact preview denies native commit and native save without overwriting files',
  real,
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      writeEnabled: true,
      scene: derived('top.tscn', 'Main'),
      files,
    });
    const options = { projectPath: f.root, ownerId: 'local-client' };
    try {
      await assert.rejects(
        applyEditorScene({
          ...options,
          operations: [
            { kind: 'override', path: 'Tip', property: 'position', value: { type: 'Vector2', x: 77, y: 66 } },
          ],
          approve: async (p) => {
            assert.equal(p.dependencyHashes['res://base.tscn'], digest(base));
            await writeFile(path.join(f.root, 'base.tscn'), base + '; changed during review\n');
            return { actor: 'local-client', planHash: p.planHash, receipt: 'MOCK-exact-approval' };
          },
        }),
        { code: 'CONFLICT' },
      );
      assert.deepEqual((await f.command('inspect')).values.Tip.position, [10, 20]);
      const main = await readFile(path.join(f.root, 'main.tscn'), 'utf8');
      await assert.rejects(
        saveEditorScene({
          ...options,
          verifyApproval: async (p) => {
            await writeFile(path.join(f.root, 'base.tscn'), base + '; changed during save review\n');
            return fixtureApproval(p);
          },
        }),
        { code: 'CONFLICT' },
      );
      assert.equal(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), main);
    } finally {
      await f.stop();
    }
  },
);

test('recursive cycles, missing dependencies and scripted grandchildren fail before instantiation', real, async () => {
  const cycle = derived('cycle.tscn', 'Cycle');
  const missing = derived('missing.tscn', 'Missing');
  const script =
    '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://bad.gd" id="script"]\n[node name="Bad" type="Node2D"]\nscript = ExtResource("script")\n';
  const parent = derived('bad.tscn', 'Parent');
  const f = await startEditorFixture(process.env.GODOT_PATH!, {
    writeEnabled: true,
    files: {
      'cycle.tscn': cycle,
      'missing-parent.tscn': missing,
      'parent.tscn': parent,
      'bad.tscn': script,
      'bad.gd':
        '@tool\nextends Node2D\nfunc _init():\n\tFileAccess.open("res://executed.txt", FileAccess.WRITE).store_string("bad")\n',
    },
  });
  try {
    for (const [file, text, code] of [
      ['cycle.tscn', cycle, 'CONFLICT'],
      ['missing-parent.tscn', missing, 'NOT_FOUND'],
      ['parent.tscn', parent, 'UNSUPPORTED'],
    ]) {
      await assert.rejects(
        applyEditorScene({
          projectPath: f.root,
          ownerId: 'local-client',
          operations: [
            {
              kind: 'instantiate',
              parent: '.',
              name: 'Rejected',
              scenePath: 'res://' + file,
              sourceHash: digest(text),
              policy: 'preserve',
            },
          ],
          approve: async () => {
            throw new Error('Invalid graph must not reach approval');
          },
        }),
        { code },
      );
    }
    assert.equal(existsSync(path.join(f.root, 'executed.txt')), false);
    assert.equal(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), f.scene);
  } finally {
    await f.stop();
  }
});

test(
  'native UID disagreement, excessive dependency depth and host hardlinks reject before approval',
  real,
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, { controller, writeEnabled: true });
    try {
      const registered = await f.command('register-uid');
      const uidScene = derived('main.tscn', 'WrongUid').replace(
        'path="res://main.tscn"',
        `uid="${registered.uid}" path="res://leaf.tscn"`,
      );
      await writeFile(path.join(f.root, 'leaf.tscn'), base);
      await writeFile(path.join(f.root, 'uid-parent.tscn'), uidScene);
      await writeFile(path.join(f.root, 'linked.tscn'), base);
      await link(path.join(f.root, 'linked.tscn'), path.join(f.root, 'linked-alias.tscn'));
      const linkedParent = derived('linked.tscn', 'LinkedParent');
      await writeFile(path.join(f.root, 'linked-parent.tscn'), linkedParent);
      for (let i = 17; i >= 0; i--)
        await writeFile(
          path.join(f.root, `depth-${i}.tscn`),
          i === 17 ? base : derived(`depth-${i + 1}.tscn`, `Depth${i}`),
        );
      const original = await f.command('inspect');
      for (const [file, text, code] of [
        ['uid-parent.tscn', uidScene, 'CONFLICT'],
        ['depth-0.tscn', derived('depth-1.tscn', 'Depth0'), 'UNSUPPORTED'],
        ['linked.tscn', base, 'UNSUPPORTED'], // Existing instantiate entrypoint rejects a linked source before RPC.
        ['linked-parent.tscn', linkedParent, 'FORBIDDEN'], // Transitive host checks must reject a linked dependency too.
      ]) {
        await assert.rejects(
          applyEditorScene({
            projectPath: f.root,
            ownerId: 'local-client',
            operations: [
              {
                kind: 'instantiate',
                parent: '.',
                name: 'Rejected',
                scenePath: `res://${file}`,
                sourceHash: digest(text),
                policy: 'preserve',
              },
            ],
            approve: async () => {
              throw new Error('Unqualified dependencies must not reach approval');
            },
          }),
          { code },
        );
      }
      assert.deepEqual((await f.command('inspect')).document, original.document);
      assert.equal(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), f.scene);
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
    } finally {
      await f.stop();
    }
  },
);

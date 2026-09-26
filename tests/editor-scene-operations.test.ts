import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startEditorFixture } from './helpers/editor-fixture.js';

// TEST-ONLY controller. Mutations run on the actual EditorPlugin main thread;
// the product still exposes read-only RPC, not this file-backed test channel.
const controller = `@tool
extends EditorPlugin
const Service = preload("res://addons/wheel_mcp/scene_service.gd")
var pending: RefCounted
var tracked: Dictionary = {}
func _enter_tree() -> void:
\tset_process(true)
func _exit_tree() -> void:
\tif pending != null:
\t\tpending.discard()
func _process(_delta: float) -> void:
\tvar root := EditorInterface.get_edited_scene_root()
\tif root == null or not FileAccess.file_exists("res://.harness/fixture-command.json"):
\t\treturn
\tvar command: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://.harness/fixture-command.json"))
\tDirAccess.remove_absolute(ProjectSettings.globalize_path("res://.harness/fixture-command.json"))
\tvar manager := get_undo_redo()
\tvar history := manager.get_history_undo_redo(manager.get_object_history_id(root))
\tvar result: Dictionary = {}
\tmatch command.action:
\t\t"prepare", "batch":
\t\t\tif pending != null:
\t\t\t\tpending.discard()
\t\t\t\tpending = null
\t\t\tresult = Service.prepare(root, command.operations, manager)
\t\t\tif result.has("batch"):
\t\t\t\tpending = result.batch
\t\t\t\tresult.erase("batch")
\t\t\t\tif command.action == "batch":
\t\t\t\t\tresult = pending.commit(manager)
\t\t\t\t\tpending = null # Native history must retain the callback without our reference.
\t\t"commit":
\t\t\tresult = pending.commit(manager)
\t\t\tpending = null
\t\t"poison-preflight":
\t\t\tpending.after_hash = "0".repeat(64) # TEST-ONLY fault injection after valid isolation preflight.
\t\t"abandon":
\t\t\tfor node in pending.created:
\t\t\t\ttracked[str(node.get_instance_id())] = node
\t\t\tpending = null # Test destructor cleanup, not just explicit discard.
\t\t"undo":
\t\t\tresult = {"changed": history.undo()}
\t\t"redo":
\t\t\tresult = {"changed": history.redo()}
\t\t"human-edit":
\t\t\tmanager.create_action("Fixture human edit", UndoRedo.MERGE_DISABLE, root)
\t\t\tmanager.add_do_property(root, "position", Vector2(123, 456))
\t\t\tmanager.add_undo_property(root, "position", root.position)
\t\t\tmanager.commit_action()
\tvar state: Dictionary = Service.document(root)
\tvar values: Dictionary = {}
\tfor entry in state.get("nodes", []):
\t\tvar node := root.get_node(NodePath(entry.path))
\t\ttracked[str(node.get_instance_id())] = node
\t\tvar position: Variant = node.get("position")
\t\tif position is Vector2:
\t\t\tvalues[entry.path] = {"position": [position.x, position.y], "visible": node.visible}
\t\telif position is Vector3:
\t\t\tvalues[entry.path] = {"position": [position.x, position.y, position.z], "visible": node.visible, "visibilityParent": str(node.visibility_parent)}
\tvar alive: Dictionary = {}
\tfor identity in tracked:
\t\talive[identity] = is_instance_valid(tracked[identity])
\tvar reply := {"id": command.id, "result": result, "document": state, "values": values, "alive": alive,
\t\t"historyVersion": history.get_version(), "canUndo": history.has_undo(), "canRedo": history.has_redo(),
\t\t"dirty": EditorInterface.get_unsaved_scenes()}
\tvar file := FileAccess.open("res://.harness/fixture-result.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify(reply))
\tfile.close()
`;

const realEditor = { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 };
function scene(type: 'Node2D' | 'Node3D') {
  return `[gd_scene format=3]
[node name="Main" type="${type}"]
[node name="Group" type="${type}" parent="."]
[node name="Marker" type="${type}" parent="Group"]
[node name="Nested" type="${type}" parent="Group/Marker"]
[node name="Destination" type="${type}" parent="."]
[node name="Old" type="${type}" parent="."]
[node name="Child" type="${type}" parent="Old"]
`;
}

for (const type of ['Node2D', 'Node3D'] as const) {
  test(
    `real ${type} editor batch is one native undo step and restores identity, properties, owners and signals`,
    realEditor,
    async () => {
      const fixture = await startEditorFixture(process.env.GODOT_PATH!, { controller, scene: scene(type) });
      try {
        const before = await fixture.command('document');
        assert.ok(before.document.hash, JSON.stringify(before));
        const vector = type === 'Node2D' ? { type: 'Vector2', x: 12, y: 34 } : { type: 'Vector3', x: 12, y: 34, z: 56 };
        const operations = [
          { kind: 'create', parent: 'Group', name: 'Added', type },
          { kind: 'set', path: 'Group/Added', property: 'position', value: vector },
          { kind: 'rename', path: 'Group/Marker', name: 'Moved' },
          { kind: 'reparent', path: 'Group/Moved', parent: 'Destination' },
          { kind: 'delete', path: 'Old' },
          { kind: 'connect', path: 'Destination/Moved', signal: 'visibility_changed', target: 'Group', method: 'hide' },
        ];
        const after = await fixture.command('batch', { operations });
        assert.equal(after.result.status, 'PASS', JSON.stringify(after));
        assert.equal(after.result.persisted, false);
        assert.equal(after.result.validation, 'NOT_RUN');
        assert.equal(after.result.undoSteps, 1);
        assert.equal(after.result.beforeHash, before.document.hash);
        assert.equal(after.result.afterHash, after.document.hash);
        assert.deepEqual(after.dirty, ['res://main.tscn']);
        const moved = after.document.nodes.find((node: any) => node.path === 'Destination/Moved');
        const original = before.document.nodes.find((node: any) => node.path === 'Group/Marker');
        assert.equal(moved.id, original.id);
        assert.equal(moved.owner, before.document.nodes[0].id);
        assert.equal(moved.signals.length, 1);
        assert.deepEqual(after.values['Group/Added'].position, type === 'Node2D' ? [12, 34] : [12, 34, 56]);
        assert.ok(!after.document.nodes.some((node: any) => node.path === 'Old'));
        const undo = await fixture.command('undo');
        assert.equal(undo.result.changed, true);
        assert.deepEqual(undo.document, before.document);
        assert.equal(undo.canUndo, false, 'Whole logical batch must require just one undo');
        const redo = await fixture.command('redo');
        assert.equal(redo.result.changed, true);
        assert.deepEqual(redo.document, after.document);
        // Disconnect has its own inverse, not a wholesale scene-tree replacement.
        const disconnected = await fixture.command('batch', {
          operations: [
            {
              kind: 'disconnect',
              path: 'Destination/Moved',
              signal: 'visibility_changed',
              target: 'Group',
              method: 'hide',
            },
          ],
        });
        assert.equal(disconnected.result.status, 'PASS', JSON.stringify(disconnected));
        assert.deepEqual((await fixture.command('undo')).document, after.document);
        assert.equal(await readFile(path.join(fixture.root, 'main.tscn'), 'utf8'), fixture.scene);
        assert.ok(!fixture.output().includes('ERROR:'), fixture.output());
      } finally {
        await fixture.stop();
      }
    },
  );
}

test(
  'real editor rejects failed multi-operation batches without nodes, history or dirty changes',
  realEditor,
  async () => {
    const fixture = await startEditorFixture(process.env.GODOT_PATH!, { controller, scene: scene('Node2D') });
    try {
      const before = await fixture.command('document');
      const failures: [Record<string, unknown>[], string][] = [
        [
          [
            { kind: 'create', parent: '.', name: 'Temporary', type: 'Node2D' },
            { kind: 'rename', path: 'Group', name: 'Destination' },
          ],
          'CONFLICT',
        ],
        [
          [
            { kind: 'delete', path: 'Old' },
            { kind: 'set', path: 'missing', property: 'visible', value: false },
          ],
          'NOT_FOUND',
        ],
        [[{ kind: 'reparent', path: 'Group', parent: 'Group/Marker' }], 'INVALID_ARGUMENT'],
        [[{ kind: 'delete', path: '.' }], 'FORBIDDEN'],
        [[{ kind: 'create', parent: '..', name: 'Outside', type: 'Node2D' }], 'INVALID_ARGUMENT'],
        [
          [{ kind: 'set', path: 'Group', property: 'position', value: { type: 'Vector3', x: 1, y: 2, z: 3 } }],
          'INVALID_ARGUMENT',
        ],
        [[{ kind: 'create', parent: '.', name: 'Unsafe', type: 'HTTPRequest' }], 'INVALID_ARGUMENT'],
      ];
      for (const [operations, code] of failures) {
        const after = await fixture.command('batch', { operations });
        assert.equal(after.result.code, code, JSON.stringify(after));
        assert.deepEqual(after.document, before.document);
        assert.equal(after.historyVersion, before.historyVersion);
        assert.deepEqual(after.dirty, before.dirty);
      }
      assert.ok(!fixture.output().includes('ERROR:'), fixture.output());
    } finally {
      await fixture.stop();
    }
  },
);

test('real editor rejects stale preflight after a human edit without overwriting that edit', realEditor, async () => {
  const fixture = await startEditorFixture(process.env.GODOT_PATH!, { controller, scene: scene('Node2D') });
  try {
    const before = await fixture.command('document');
    const prepared = await fixture.command('prepare', {
      operations: [{ kind: 'create', parent: '.', name: 'Stale', type: 'Node2D' }],
    });
    assert.ok(prepared.result.afterHash);
    assert.deepEqual(prepared.document, before.document);
    const human = await fixture.command('human-edit');
    const rejected = await fixture.command('commit');
    assert.equal(rejected.result.code, 'CONFLICT');
    assert.deepEqual(rejected.document, human.document);
    assert.equal(rejected.historyVersion, human.historyVersion);
    assert.deepEqual(rejected.values['.'].position, [123, 456]);
    assert.deepEqual((await fixture.command('undo')).document, before.document);
    assert.ok(!fixture.output().includes('ERROR:'), fixture.output());
  } finally {
    await fixture.stop();
  }
});

test(
  'real editor remaps local NodePath by identity across rename and reparent, with exact undo/redo',
  realEditor,
  async () => {
    const content =
      scene('Node3D').replace(
        '[node name="Marker" type="Node3D" parent="Group"]',
        '[node name="Marker" type="Node3D" parent="Group"]\nvisibility_parent = NodePath("../../Geometry")',
      ) + '[node name="Geometry" type="MeshInstance3D" parent="."]\n';
    const fixture = await startEditorFixture(process.env.GODOT_PATH!, { controller, scene: content });
    try {
      const before = await fixture.command('document');
      const after = await fixture.command('batch', {
        operations: [
          { kind: 'rename', path: 'Geometry', name: 'Sun' },
          { kind: 'reparent', path: 'Group', parent: 'Destination' },
          { kind: 'rename', path: 'Destination', name: 'Dock' },
        ],
      });
      assert.equal(after.result.status, 'PASS', JSON.stringify(after.result));
      assert.equal(after.values['Dock/Group/Marker'].visibilityParent, '../../../Sun');
      assert.deepEqual((await fixture.command('undo')).document, before.document);
      assert.deepEqual((await fixture.command('redo')).document, after.document);
      const conflict = await fixture.command('batch', { operations: [{ kind: 'delete', path: 'Sun' }] });
      assert.equal(conflict.result.code, 'CONFLICT');
      assert.deepEqual(conflict.document, after.document);
      const clear = await fixture.command('batch', {
        operations: [
          {
            kind: 'set',
            path: 'Dock/Group/Marker',
            property: 'visibility_parent',
            value: { type: 'NodePath', path: '' },
          },
          { kind: 'delete', path: 'Sun' },
        ],
      });
      assert.equal(clear.result.status, 'PASS', JSON.stringify(clear.result));
      assert.deepEqual((await fixture.command('undo')).document, after.document);
      assert.ok(!fixture.output().includes('ERROR:'), fixture.output());
    } finally {
      await fixture.stop();
    }
  },
);

test(
  'real editor refuses callback side effects and incoming signal references before mutation',
  realEditor,
  async () => {
    const content =
      scene('Node2D') + '[connection signal="visibility_changed" from="Group/Marker" to="Destination" method="hide"]\n';
    const fixture = await startEditorFixture(process.env.GODOT_PATH!, { controller, scene: content });
    try {
      const before = await fixture.command('document');
      for (const operations of [
        [{ kind: 'set', path: 'Group', property: 'visible', value: false }],
        [{ kind: 'reparent', path: 'Group/Marker', parent: 'Destination' }],
        [{ kind: 'delete', path: 'Destination' }],
        [{ kind: 'delete', path: 'Group' }],
      ]) {
        const rejected = await fixture.command('batch', { operations });
        assert.equal(rejected.result.code, 'CONFLICT', JSON.stringify(rejected.result));
        assert.deepEqual(rejected.document, before.document);
        assert.equal(rejected.historyVersion, before.historyVersion);
        assert.deepEqual(rejected.dirty, before.dirty);
      }
      const after = await fixture.command('batch', {
        operations: [
          {
            kind: 'disconnect',
            path: 'Group/Marker',
            signal: 'visibility_changed',
            target: 'Destination',
            method: 'hide',
          },
          { kind: 'set', path: 'Destination', property: 'visible', value: true },
          { kind: 'set', path: 'Group', property: 'visible', value: false },
        ],
      });
      assert.equal(after.result.status, 'PASS', JSON.stringify(after.result));
      assert.equal(after.values.Destination.visible, true, 'No hide callback should run');
      assert.deepEqual((await fixture.command('undo')).document, before.document);
      assert.deepEqual((await fixture.command('redo')).document, after.document);
      assert.ok(!fixture.output().includes('ERROR:'), fixture.output());
    } finally {
      await fixture.stop();
    }
  },
);

test(
  'real editor detects external disk changes and keeps the edited document and human disk bytes untouched',
  realEditor,
  async () => {
    const fixture = await startEditorFixture(process.env.GODOT_PATH!, { controller, scene: scene('Node2D') });
    try {
      const prepared = await fixture.command('prepare', {
        operations: [{ kind: 'create', parent: '.', name: 'Stale', type: 'Node2D' }],
      });
      assert.ok(prepared.result.afterHash);
      const disk = fixture.scene + '\n; external text edit\n';
      await writeFile(path.join(fixture.root, 'main.tscn'), disk);
      const rejected = await fixture.command('commit');
      assert.equal(rejected.result.code, 'CONFLICT');
      assert.deepEqual(rejected.document, prepared.document);
      assert.equal(rejected.historyVersion, prepared.historyVersion);
      assert.equal(await readFile(path.join(fixture.root, 'main.tscn'), 'utf8'), disk);
      assert.ok(!fixture.output().includes('ERROR:'), fixture.output());
    } finally {
      await fixture.stop();
    }
  },
);

for (const [name, content, files, code] of [
  [
    'inherited',
    '[gd_scene load_steps=2 format=3]\n[ext_resource type="PackedScene" path="res://base.tscn" id="1"]\n[node name="Main" instance=ExtResource("1")]\n',
    { 'base.tscn': '[gd_scene format=3]\n[node name="Base" type="Node2D"]\n' },
    'FORBIDDEN',
  ],
  [
    'external instance',
    '[gd_scene load_steps=2 format=3]\n[ext_resource type="PackedScene" path="res://base.tscn" id="1"]\n[node name="Main" type="Node2D"]\n[node name="Instance" parent="." instance=ExtResource("1")]\n',
    { 'base.tscn': '[gd_scene format=3]\n[node name="Base" type="Node2D"]\n' },
    'FORBIDDEN',
  ],
  [
    'scripted',
    '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://node.gd" id="1"]\n[node name="Main" type="Node2D"]\nscript = ExtResource("1")\n',
    { 'node.gd': 'extends Node2D\n' },
    'UNSUPPORTED',
  ],
] as const) {
  test(`real editor protects ${name} documents before a batch changes history or dirty state`, realEditor, async () => {
    const fixture = await startEditorFixture(process.env.GODOT_PATH!, { controller, scene: content, files });
    try {
      const before = await fixture.command('document');
      const after = await fixture.command('batch', {
        operations: [
          { kind: 'create', parent: name === 'external instance' ? 'Instance' : '.', name: 'Blocked', type: 'Node2D' },
        ],
      });
      assert.equal(after.result.code, code, JSON.stringify(after.result));
      assert.deepEqual(after.document, before.document);
      assert.equal(after.historyVersion, before.historyVersion);
      assert.deepEqual(after.dirty, before.dirty);
      assert.equal(await readFile(path.join(fixture.root, 'main.tscn'), 'utf8'), content);
      assert.ok(!fixture.output().includes('ERROR:'), fixture.output());
    } finally {
      await fixture.stop();
    }
  });
}

test('real editor readback failure rolls back without a failed undo/redo action or disk save', realEditor, async () => {
  const fixture = await startEditorFixture(process.env.GODOT_PATH!, { controller, scene: scene('Node2D') });
  try {
    const before = await fixture.command('document');
    const prepared = await fixture.command('prepare', {
      operations: [
        { kind: 'create', parent: '.', name: 'Temporary', type: 'Node2D' },
        { kind: 'delete', path: 'Old' },
        { kind: 'rename', path: 'Group', name: 'Renamed' },
      ],
    });
    assert.ok(prepared.result.afterHash);
    await fixture.command('poison-preflight');
    const rejected = await fixture.command('commit');
    assert.equal(rejected.result.code, 'INTERNAL_ERROR');
    assert.equal(rejected.result.rolledBack, true);
    assert.deepEqual(rejected.document, before.document);
    assert.equal(rejected.historyVersion, before.historyVersion);
    assert.equal(rejected.canUndo, false);
    assert.equal(rejected.canRedo, false);
    assert.deepEqual(rejected.dirty, before.dirty);
    assert.equal(await readFile(path.join(fixture.root, 'main.tscn'), 'utf8'), fixture.scene);
    assert.ok(!fixture.output().includes('ERROR:'), fixture.output());
  } finally {
    await fixture.stop();
  }
});

test(
  'real editor abandons detached staging nodes and native history releases undone creations on a new branch',
  realEditor,
  async () => {
    const fixture = await startEditorFixture(process.env.GODOT_PATH!, { controller, scene: scene('Node2D') });
    try {
      const before = await fixture.command('document');
      const operations = [{ kind: 'create', parent: '.', name: 'Added', type: 'Node2D' }];
      await fixture.command('prepare', { operations });
      const abandoned = await fixture.command('abandon');
      assert.deepEqual(abandoned.document, before.document);
      assert.equal(abandoned.historyVersion, before.historyVersion);
      const detachedIds = Object.keys(abandoned.alive).filter((id) => !(id in before.alive));
      assert.equal(detachedIds.length, 1);
      assert.equal(abandoned.alive[detachedIds[0]], false, 'Discarded preview must not leak a detached Node');
      const created = await fixture.command('batch', { operations });
      assert.equal(created.result.status, 'PASS', JSON.stringify(created.result));
      const addedId = String(created.document.nodes.find((node: any) => node.path === 'Added').id);
      const undo = await fixture.command('undo');
      assert.equal(undo.alive[addedId], true, 'Redo still needs the detached node');
      const branched = await fixture.command('human-edit');
      assert.equal(branched.canRedo, false);
      assert.equal(branched.alive[addedId], false, 'Native redo discard should release the created node');
      assert.ok(!fixture.output().includes('ERROR:'), fixture.output());
    } finally {
      await fixture.stop();
    }
  },
);

test(
  'real editor bounds batches/documents and rejects unknown fields before native history changes',
  realEditor,
  async () => {
    const fixture = await startEditorFixture(process.env.GODOT_PATH!, { controller, scene: scene('Node2D') });
    try {
      const before = await fixture.command('document');
      for (const operations of [
        [],
        Array.from({ length: 33 }, (_, i) => ({ kind: 'create', parent: '.', name: `N${i}`, type: 'Node2D' })),
        [{ kind: 'create', parent: '.', name: 'Extra', type: 'Node2D', approved: true }],
        [{ kind: 'reparent', path: 'Group', parent: '.', keepGlobalTransform: true }],
      ]) {
        const rejected = await fixture.command('batch', { operations });
        assert.equal(rejected.result.code, 'INVALID_ARGUMENT');
        assert.deepEqual(rejected.document, before.document);
        assert.equal(rejected.historyVersion, before.historyVersion);
      }
    } finally {
      await fixture.stop();
    }
    const wide =
      '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n' +
      Array.from({ length: 101 }, (_, i) => `[node name="N${i}" type="Node2D" parent="."]\n`).join('');
    const bounded = await startEditorFixture(process.env.GODOT_PATH!, { controller, scene: wide });
    try {
      const before = await bounded.command('document');
      assert.equal(before.document.code, 'UNSUPPORTED');
      const rejected = await bounded.command('batch', { operations: [{ kind: 'delete', path: 'N0' }] });
      assert.equal(rejected.result.code, 'UNSUPPORTED');
      assert.equal(rejected.historyVersion, before.historyVersion);
      assert.deepEqual(rejected.dirty, before.dirty);
      assert.ok(!bounded.output().includes('ERROR:'), bounded.output());
    } finally {
      await bounded.stop();
    }
  },
);

test(
  'real editor never observes a partial test command during a deliberately split staged write',
  realEditor,
  async () => {
    let stagedWrites = 0;
    const fixture = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      scene: scene('Node2D'),
      async writeCommand(staged, json) {
        const commandFile = path.join(path.dirname(staged), 'fixture-command.json');
        await writeFile(staged, json.slice(0, 9));
        assert.equal(existsSync(commandFile), false, 'Partial command must not be visible to the polling editor');
        await delay(150);
        assert.equal(existsSync(commandFile), false);
        await appendFile(staged, json.slice(9));
        stagedWrites++;
      },
    });
    try {
      const before = await fixture.command('document');
      const after = await fixture.command('batch', {
        operations: [{ kind: 'create', parent: '.', name: 'Atomic', type: 'Node2D' }],
      });
      assert.equal(after.result.status, 'PASS', JSON.stringify(after.result));
      assert.deepEqual((await fixture.command('undo')).document, before.document);
      assert.equal(stagedWrites, 3);
      assert.ok(!fixture.output().includes('ERROR:'), fixture.output());
    } finally {
      await fixture.stop();
    }
  },
);

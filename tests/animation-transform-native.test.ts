import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EditorBridge } from '../src/editor/editor-bridge.js';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';

// TEST ONLY: public native Undo/Redo and deterministic AnimationPlayer sampling.
// Sampling uses play/seek/advance on the actual authored library, never writes
// the expected transform. No fixture controller is shipped to consumer projects.
const controller = `@tool
extends EditorPlugin
const Core = preload("res://addons/wheel_mcp/scene_service.gd")
const Anim = preload("res://addons/wheel_mcp/animation_service.gd")
func _enter_tree() -> void: set_process(true)
func _process(_delta: float) -> void:
\tvar root := EditorInterface.get_edited_scene_root()
\tif root == null or not FileAccess.file_exists("res://.harness/fixture-command.json"): return
\tvar c: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://.harness/fixture-command.json"))
\tDirAccess.remove_absolute(ProjectSettings.globalize_path("res://.harness/fixture-command.json"))
\tvar history := get_undo_redo().get_history_undo_redo(get_undo_redo().get_object_history_id(root))
\tif c.action == "undo": history.undo()
\tif c.action == "redo": history.redo()
\tvar player := root.get_node_or_null("Animator") as AnimationPlayer
\tif c.action == "sample":
\t\tplayer.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
\t\tplayer.play("wheel/turn")
\t\tplayer.seek(c.time, true)
\t\tplayer.advance(0.0)
\tif c.action == "ease": player.get_animation("wheel/turn").track_set_key_transition(1, 0, 0.5)
\tif c.action == "unease": player.get_animation("wheel/turn").track_set_key_transition(1, 0, 1.0)
\tif c.action == "disable3d": player.get_animation("wheel/turn").track_set_enabled(3, false)
\tif c.action == "enable3d": player.get_animation("wheel/turn").track_set_enabled(3, true)
\tvar reply := {"id":c.id, "document":Core.document(root)}
\tif root.has_node("Hero"):
\t\tvar hero := root.get_node("Hero") as Node2D
\t\treply["actual"] = {"rotation":hero.rotation, "scale":[hero.scale.x, hero.scale.y], "position":[hero.position.x,hero.position.y]}
\tvar file := FileAccess.open("res://.harness/fixture-result.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify(reply)); file.close()
\tif c.action == "quit": get_tree().call_deferred("quit")
`;
const operations = [
  { kind: 'create', parent: '.', name: 'Animator', type: 'AnimationPlayer' },
  {
    kind: 'animation_clips',
    path: 'Animator',
    clips: [
      {
        id: 'turn',
        length: 1,
        loop: false,
        tracks: [
          {
            id: 'move',
            target: 'Hero',
            property: 'position',
            keys: [
              { time: 0, value: { x: 0, y: 0 } },
              { time: 1, value: { x: 40, y: 20 } },
            ],
          },
          {
            id: 'turn',
            target: 'Hero',
            property: 'rotation',
            keys: [
              { time: 0, value: 0 },
              { time: 1, value: 2 },
            ],
          },
          {
            id: 'grow',
            target: 'Hero',
            property: 'scale',
            keys: [
              { time: 0, value: { x: 1, y: 1 } },
              { time: 1, value: { x: 3, y: 2 } },
            ],
          },
          {
            id: 'space_turn',
            target: 'Space',
            property: 'rotation_3d',
            keys: [
              { time: 0, value: { x: 0, y: 0, z: 0, w: 1 } },
              {
                time: 1,
                value: { x: Math.SQRT1_2 / 3, y: (2 * Math.SQRT1_2) / 3, z: (2 * Math.SQRT1_2) / 3, w: Math.SQRT1_2 },
              },
            ],
          },
          {
            id: 'space_grow',
            target: 'Space',
            property: 'scale_3d',
            keys: [
              { time: 0, value: { x: 1, y: 1, z: 1 } },
              { time: 1, value: { x: 2, y: 3, z: 4 } },
            ],
          },
          {
            id: 'space_move',
            target: 'Space',
            property: 'position',
            keys: [
              { time: 0, value: { x: 0, y: 0, z: 0 } },
              { time: 1, value: { x: 2, y: 4, z: 6 } },
            ],
          },
        ],
      },
    ],
  },
];

test(
  'native 2D/3D transform tracks: exact approval, independent capabilities, atomic rejection, undo and saved interpolation',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 },
  async () => {
    let f = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      writeEnabled: true,
      scene:
        '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n[node name="Hero" type="Node2D" parent="."]\n[node name="Space" type="Node3D" parent="."]\n',
    });
    let decline = false;
    let approvalAction = '';
    let approvals = 0;
    let sessionId = '';
    const c = await wireEditor(f.root, {
      transport: 'stdio',
      approval: async (message) => {
        approvals++;
        if (message.includes('NATIVE SAVE:')) {
          assert.match(message, /Plan SHA-256: [a-f0-9]{64}/);
          assert.match(message, /Exact before\/after preview:/);
          assert.match(message, /Hero:rotation/);
          assert.match(message, /Hero:scale/);
        } else assert.match(message, /source SHA-256/);
        if (approvalAction) {
          const action = approvalAction;
          approvalAction = '';
          await f.command(action);
        }
        return { action: decline ? 'decline' : 'accept', content: { confirm: !decline } }; // MOCK.
      },
    });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const reply = await c.call(name, args);
      assert.notEqual(reply.isError, true, JSON.stringify(reply));
      return reply.structuredContent as any;
    };
    try {
      const original = (await f.command('inspect')).document;
      const sceneFile = path.join(f.root, 'main.tscn');
      const bytes = await readFile(sceneFile);
      const unchanged = async () => {
        assert.deepEqual((await f.command('inspect')).document, original);
        assert.deepEqual(await readFile(sceneFile), bytes);
      };
      const ro = await wireEditor(f.root, { transport: 'stdio', scopes: ['read'] });
      try {
        assert.equal((await ro.call('apply_editor_scene', { operations })).isError, true);
      } finally {
        await ro.close();
      }
      await unchanged();
      const endpointFile = path.join(f.root, '.harness/editor-endpoint.json');
      const endpointBytes = await readFile(endpointFile);
      const endpoint = JSON.parse(endpointBytes.toString());
      assert.equal(endpoint.bridgeVersion, '0.3.9');
      assert.equal(endpoint.capabilities.length, 29);
      try {
        await writeFile(
          endpointFile,
          JSON.stringify({
            ...endpoint,
            capabilities: endpoint.capabilities.filter((v: string) => v !== 'scene.animation_transform2d/v1'),
          }),
        );
        const r = await c.call('apply_editor_scene', { operations });
        assert.equal((r.structuredContent as any).code, 'PROTOCOL_MISMATCH');
        assert.equal(approvals, 0);
        // Existing position requests remain valid against an old capability set.
        const legacy = structuredClone(operations) as any[];
        legacy[1].clips[0].tracks = legacy[1].clips[0].tracks.filter((t: any) => t.property === 'position');
        decline = true;
        assert.equal(
          ((await c.call('apply_editor_scene', { operations: legacy })).structuredContent as any).code,
          'FORBIDDEN',
        );
        decline = false;
        const only3d = structuredClone(operations) as any[];
        only3d[1].clips[0].tracks = only3d[1].clips[0].tracks.filter((t: any) => t.property.endsWith('_3d'));
        decline = true;
        const declined3d = await c.call('apply_editor_scene', { operations: only3d });
        assert.equal((declined3d.structuredContent as any).code, 'FORBIDDEN', JSON.stringify(declined3d));
        decline = false;
        await writeFile(
          endpointFile,
          JSON.stringify({
            ...endpoint,
            capabilities: endpoint.capabilities.filter((v: string) => v !== 'scene.animation_transform3d/v1'),
          }),
        );
        const count = approvals;
        assert.equal(
          ((await c.call('apply_editor_scene', { operations: only3d })).structuredContent as any).code,
          'PROTOCOL_MISMATCH',
        );
        assert.equal(approvals, count);
        const only2d = structuredClone(operations) as any[];
        only2d[1].clips[0].tracks = only2d[1].clips[0].tracks.filter((t: any) => !t.property.endsWith('_3d'));
        decline = true;
        assert.equal(
          ((await c.call('apply_editor_scene', { operations: only2d })).structuredContent as any).code,
          'FORBIDDEN',
        );
        decline = false;
      } finally {
        await writeFile(endpointFile, endpointBytes);
      }
      await unchanged();
      // Bypass host schema only for native protocol negative controls.
      const bridge = await EditorBridge.connect({ projectPath: f.root, ownerId: 'local-client' });
      try {
        for (const [label, mutate, code] of [
          [
            'quaternion_norm',
            (t: any[]) => {
              t[3].keys[0].value.w = 0;
            },
            'INVALID_ARGUMENT',
          ],
          [
            'quaternion_shape',
            (t: any[]) => {
              delete t[3].keys[0].value.w;
            },
            'INVALID_ARGUMENT',
          ],
          [
            'three_d_on_two_d',
            (t: any[]) => {
              t[3].target = 'Hero';
            },
            'UNSUPPORTED',
          ],
          [
            'three_d_alias',
            (t: any[]) => {
              t[3].target = './Space';
            },
            'FORBIDDEN',
          ],
          [
            'three_d_rounding',
            (t: any[]) => {
              t[4].keys[0].value.z = 0.06249999999;
            },
            'INVALID_ARGUMENT',
          ],
          [
            'three_d_duplicate',
            (t: any[]) => {
              t.push({ ...t[3], id: 'duplicate3d' });
            },
            'INVALID_ARGUMENT',
          ],
          [
            'three_d',
            (t: any[]) => {
              t[1].target = 'Space';
            },
            'UNSUPPORTED',
          ],
          [
            'negative',
            (t: any[]) => {
              t[2].keys[1].value.x = -1;
            },
            'INVALID_ARGUMENT',
          ],
          [
            'rounding',
            (t: any[]) => {
              t[2].keys[1].value.x = 0.06249999999;
            },
            'INVALID_ARGUMENT',
          ],
          [
            'alias',
            (t: any[]) => {
              t[1].target = './Hero';
            },
            'FORBIDDEN',
          ],
          [
            'missing',
            (t: any[]) => {
              t[1].target = 'Missing';
            },
            'NOT_FOUND',
          ],
          [
            'dimension',
            (t: any[]) => {
              t[1].keys[1].value = { x: 1, y: 2 };
            },
            'INVALID_ARGUMENT',
          ],
          [
            'duplicate',
            (t: any[]) => {
              t.push({ ...t[1], id: 'duplicate' });
            },
            'INVALID_ARGUMENT',
          ],
        ] as const) {
          const invalid = structuredClone(operations) as any[];
          mutate(invalid[1].clips[0].tracks);
          const r = (await bridge.sceneRequest('scene.prepare', {
            operationId: `reject-${label}`,
            operations: invalid,
          })) as any;
          assert.equal(r.code, code, JSON.stringify(r));
          await unchanged();
        }
      } finally {
        bridge.close();
      }
      decline = true;
      assert.equal(((await c.call('apply_editor_scene', { operations })).structuredContent as any).code, 'FORBIDDEN');
      decline = false;
      await unchanged();
      assert.equal((await call('apply_editor_scene', { operations, operationId: 'transform-batch' })).undoSteps, 1);
      const changed = (await f.command('inspect')).document;
      const signature = changed.nodes.find((n: any) => n.path === 'Animator').animation;
      assert.deepEqual(
        signature.clips[0].tracks.slice(0, 3).map((t: any) => [t.path, t.keys]),
        [
          [
            'Hero:position',
            [
              [0, 0, 0],
              [1, 40, 20],
            ],
          ],
          [
            'Hero:rotation',
            [
              [0, 0],
              [1, 2],
            ],
          ],
          [
            'Hero:scale',
            [
              [0, 1, 1],
              [1, 3, 2],
            ],
          ],
        ],
      );
      const count = approvals;
      assert.equal((await call('apply_editor_scene', { operations, operationId: 'transform-batch' })).replayed, true);
      assert.equal(approvals, count);
      const different = structuredClone(operations) as any[];
      different[1].clips[0].tracks[3].keys[1].value.w += 1e-15;
      const conflict = await c.call('apply_editor_scene', { operations: different, operationId: 'transform-batch' });
      assert.equal((conflict.structuredContent as any).code, 'CONFLICT', JSON.stringify(conflict));
      assert.equal(approvals, count);
      assert.deepEqual((await f.command('inspect')).document, changed);
      assert.deepEqual((await f.command('undo')).document, original);
      assert.deepEqual((await f.command('redo')).document, changed);
      assert.deepEqual(
        signature.clips[0].tracks.slice(3).map((t: any) => [t.path, t.property ?? 'position']),
        [
          ['Space', 'rotation_3d'],
          ['Space', 'scale_3d'],
          ['Space:position', 'position'],
        ],
      );
      await f.command('disable3d');
      assert.equal(((await c.call('save_editor_scene')).structuredContent as any).code, 'UNSUPPORTED');
      assert.equal(
        (
          (
            await c.call('apply_editor_scene', {
              operations: [{ kind: 'create', parent: '.', name: 'MustNotRemain', type: 'Node2D' }],
            })
          ).structuredContent as any
        ).code,
        'UNSUPPORTED',
      );
      assert.deepEqual(await readFile(sceneFile), bytes);
      await f.command('enable3d');
      assert.deepEqual((await f.command('inspect')).document, changed);
      // Mid-approval human easing changes cannot be saved using a stale plan.
      approvalAction = 'ease';
      const stale = await c.call('save_editor_scene');
      assert.equal((stale.structuredContent as any).code, 'CONFLICT', JSON.stringify(stale));
      assert.deepEqual(await readFile(sceneFile), bytes);
      await f.command('unease');
      assert.equal((await call('save_editor_scene')).validation, 'PASS');
      const saved = await readFile(sceneFile);
      const root = f.root;
      await f.command('quit');
      await f.exited;
      f = await startEditorFixture(process.env.GODOT_PATH!, { existingRoot: root, controller, writeEnabled: true });
      assert.deepEqual(
        (await f.command('inspect')).document.nodes.find((n: any) => n.path === 'Animator').animation,
        signature,
      );
      for (const time of [0, 0.25, 0.5, 1]) {
        const actual = (await f.command('sample', { time })).actual;
        assert.ok(Math.abs(actual.rotation - time * 2) < 0.0001, JSON.stringify(actual));
        assert.deepEqual(actual.scale, [1 + 2 * time, 1 + time]);
        assert.deepEqual(actual.position, [40 * time, 20 * time]);
      }
      assert.deepEqual(await readFile(sceneFile), saved);
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|ERROR:/);
      await f.command('quit');
      await f.exited;
      sessionId = (
        await call('open_runtime_bridge', {
          bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
          headless: true,
        })
      ).session_id;
      const method = (method: string, args: unknown[]) =>
        call('call_runtime_method', { sessionId, nodePath: 'Animator', method, args });
      await method('set_callback_mode_process', [2]); // Native manual sampling, not a transform setter.
      await method('play', ['wheel/turn']);
      for (const time of [0, 0.25, 0.5, 1]) {
        await method('seek', [time, true]);
        await method('advance', [0]);
        const read = async (property: string) =>
          (
            await call('call_runtime_bridge', {
              sessionId,
              method: 'get_property',
              params: { nodePath: 'Hero', property },
            })
          ).response.value;
        assert.ok(Math.abs((await read('rotation')) - 2 * time) < 0.0001);
        assert.deepEqual(await read('scale'), { type: 'Vector2', x: 1 + 2 * time, y: 1 + time });
        assert.deepEqual(await read('position'), { type: 'Vector2', x: 40 * time, y: 20 * time });
        const read3d = async (property: string) =>
          (
            await call('call_runtime_bridge', {
              sessionId,
              method: 'get_property',
              params: { nodePath: 'Space', property },
            })
          ).response.value;
        const q = await read3d('quaternion');
        assert.equal(q.type, 'Quaternion');
        const angle = (time * Math.PI) / 4;
        const expectedQ = {
          x: Math.sin(angle) / 3,
          y: (2 * Math.sin(angle)) / 3,
          z: (2 * Math.sin(angle)) / 3,
          w: Math.cos(angle),
        };
        const dot = q.x * expectedQ.x + q.y * expectedQ.y + q.z * expectedQ.z + q.w * expectedQ.w;
        const sign = dot < 0 ? -1 : 1; // q and -q encode the same orientation.
        for (const axis of ['x', 'y', 'z', 'w'] as const)
          assert.ok(Math.abs(sign * q[axis] - expectedQ[axis]) < 0.00001, JSON.stringify(q));
        const scale = await read3d('scale');
        assert.equal(scale.type, 'Vector3');
        for (const [axis, expected] of [
          ['x', 1 + time],
          ['y', 1 + 2 * time],
          ['z', 1 + 3 * time],
        ] as const)
          assert.ok(Math.abs(scale[axis] - expected) < 0.00001, JSON.stringify(scale));
        const position = await read3d('position');
        assert.deepEqual(position, { type: 'Vector3', x: 2 * time, y: 4 * time, z: 6 * time });
      }
      assert.deepEqual(await readFile(sceneFile), saved);
    } finally {
      if (sessionId) await c.call('stop_runtime_bridge', { sessionId }).catch(() => undefined);
      await c.close();
      await f.stop();
    }
  },
);

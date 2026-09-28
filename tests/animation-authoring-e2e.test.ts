import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';

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
\tif c.action == "share-animation":
\t\tvar first := AnimationPlayer.new()
\t\tfirst.name = "First"
\t\troot.add_child(first)
\t\tfirst.owner = root
\t\tvar second := AnimationPlayer.new()
\t\tsecond.name = "Second"
\t\troot.add_child(second)
\t\tsecond.owner = root
\t\tvar clip := Animation.new()
\t\tvar track := clip.add_track(Animation.TYPE_VALUE)
\t\tclip.track_set_path(track, NodePath("Hero:position"))
\t\tclip.track_insert_key(track, 0.0, Vector2.ZERO)
\t\tclip.set_meta("wheel_track_ids", PackedStringArray(["position"]))
\t\tvar library := AnimationLibrary.new()
\t\tlibrary.add_animation("idle", clip)
\t\tfirst.add_animation_library("wheel", library)
\t\tsecond.add_animation_library("wheel", library)
\tvar file := FileAccess.open("res://.harness/fixture-result.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify({"id":c.id, "document":Core.document(root)}))
\tfile.close()
\tif c.action == "quit": get_tree().call_deferred("quit")
`;

test(
  'T19 real editor creates bounded animation clips with native undo, rejection and save/reopen',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 120000 },
  async () => {
    let fixture = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      writeEnabled: true,
      scene: '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n',
    });
    let client = await wireEditor(fixture.root);
    const dir = path.resolve('runs/production-roadmap/T19', new Date().toISOString().replaceAll(':', '-'));
    await mkdir(dir, { recursive: true });
    let reply: unknown;
    let sessionId = '';
    const report: Record<string, unknown> = { source: 'REAL', approval: 'MOCK', root: fixture.root };
    try {
      const original = (await fixture.command('inspect')).document;
      const operations = [
        { kind: 'create', parent: '.', name: 'Hero', type: 'Node2D' },
        { kind: 'create', parent: '.', name: 'Animator', type: 'AnimationPlayer' },
        { kind: 'create', parent: '.', name: 'Graph', type: 'AnimationTree' },
        {
          kind: 'animation_clips',
          path: 'Animator',
          clips: [
            {
              id: 'idle',
              length: 1,
              loop: true,
              tracks: [
                {
                  id: 'hero_position',
                  target: 'Hero',
                  property: 'position',
                  keys: [{ time: 0, value: { x: 0, y: 0 } }],
                },
              ],
            },
            {
              id: 'walk',
              length: 1,
              loop: true,
              tracks: [
                {
                  id: 'hero_position',
                  target: 'Hero',
                  property: 'position',
                  keys: [
                    { time: 0, value: { x: 0, y: 0 } },
                    { time: 1, value: { x: 40, y: 0 } },
                  ],
                },
              ],
            },
            {
              id: 'attack',
              length: 0.5,
              loop: false,
              tracks: [
                {
                  id: 'hero_position',
                  target: 'Hero',
                  property: 'position',
                  keys: [
                    { time: 0, value: { x: 40, y: 0 } },
                    { time: 0.5, value: { x: 60, y: 0 } },
                  ],
                },
              ],
            },
          ],
        },
        {
          kind: 'animation_graph',
          path: 'Graph',
          graph: {
            playerPath: 'Animator',
            entry: 'idle',
            states: [
              { id: 'idle', label: 'Idle', clip: 'idle' },
              { id: 'walk', label: 'Walk', clip: 'walk' },
              { id: 'attack', label: 'Attack', clip: 'attack' },
            ],
            transitions: [
              { id: 'start_walking', from: 'idle', to: 'walk', condition: 'move' },
              { id: 'strike', from: 'walk', to: 'attack', condition: 'attack' },
            ],
          },
        },
      ];
      const bad = structuredClone(operations) as any[];
      bad[3].clips[0].tracks[0].target = 'Ghost';
      const rejected = await client.call('apply_editor_scene', { operations: bad });
      assert.equal(rejected.isError, true, JSON.stringify(rejected));
      report.invalidTargetCode = (rejected.structuredContent as any)?.code ?? 'SCHEMA_REJECTED';
      assert.deepEqual((await fixture.command('inspect')).document, original);
      const cycle = structuredClone(operations) as any[];
      cycle[4].graph.transitions.push({ id: 'illegal_loop', from: 'attack', to: 'idle', condition: 'reset' });
      const rejectedCycle = await client.call('apply_editor_scene', { operations: cycle });
      assert.equal(rejectedCycle.isError, true, JSON.stringify(rejectedCycle));
      report.cycleCode = (rejectedCycle.structuredContent as any)?.code ?? 'SCHEMA_REJECTED';
      assert.deepEqual((await fixture.command('inspect')).document, original);
      reply = await client.call('apply_editor_scene', { operations });
      assert.equal((reply as { isError?: boolean }).isError, undefined, JSON.stringify(reply));
      const changed = (await fixture.command('inspect')).document;
      report.afterHash = changed.hash;
      assert.equal(changed.nodes.find((node: { path: string }) => node.path === 'Animator')?.type, 'AnimationPlayer');
      assert.equal(changed.nodes.find((node: { path: string }) => node.path === 'Graph')?.type, 'AnimationTree');
      const clips = changed.nodes.find((node: { path: string }) => node.path === 'Animator')?.animation?.clips;
      assert.deepEqual(
        clips.map((clip: { id: string }) => clip.id),
        ['attack', 'idle', 'walk'],
      );
      assert.deepEqual(
        changed.nodes
          .find((node: { path: string }) => node.path === 'Graph')
          ?.animationGraph?.states.map((state: { id: string }) => state.id),
        ['attack', 'idle', 'walk'],
      );
      for (const operation of [
        { kind: 'rename', path: 'Hero', name: 'Other' },
        { kind: 'delete', path: 'Hero' },
        { kind: 'reparent', path: 'Animator', parent: 'Hero' },
      ]) {
        const stale = await client.call('apply_editor_scene', { operations: [operation] });
        assert.equal(stale.isError, true, JSON.stringify(stale));
        assert.deepEqual((await fixture.command('inspect')).document, changed);
      }
      assert.deepEqual((await fixture.command('undo')).document, original);
      assert.deepEqual((await fixture.command('redo')).document, changed);
      const saved = await client.call('save_editor_scene');
      assert.equal(saved.isError, undefined, JSON.stringify(saved));
      report.saved = saved.structuredContent;
      assert.doesNotMatch(fixture.output(), /SCRIPT ERROR|ERROR:/);
      const root = fixture.root;
      await fixture.command('quit');
      await fixture.exited;
      await client.close();
      fixture = await startEditorFixture(process.env.GODOT_PATH!, {
        existingRoot: root,
        controller,
        writeEnabled: true,
      });
      client = await wireEditor(root);
      const reopened = (await fixture.command('inspect')).document;
      assert.deepEqual(
        reopened.nodes.find((node: { path: string }) => node.path === 'Animator')?.animation,
        changed.nodes.find((node: { path: string }) => node.path === 'Animator')?.animation,
      );
      assert.deepEqual(
        reopened.nodes.find((node: { path: string }) => node.path === 'Graph')?.animationGraph,
        changed.nodes.find((node: { path: string }) => node.path === 'Graph')?.animationGraph,
      );
      report.reopened = {
        animation: reopened.nodes.find((node: { path: string }) => node.path === 'Animator')?.animation,
        graph: reopened.nodes.find((node: { path: string }) => node.path === 'Graph')?.animationGraph,
      };
      await fixture.command('quit');
      await fixture.exited;
      // TEST-ONLY game input wiring: the authored graph remains the saved MCP
      // output; this tiny script proves a real Godot input event can drive its
      // declared conditions without claiming script authoring as a T19 feature.
      await writeFile(
        path.join(root, 'input.gd'),
        'extends Node2D\nfunc _input(event: InputEvent) -> void:\n\tif event is InputEventKey and event.pressed and not event.echo:\n\t\tif event.keycode == KEY_D: $Graph.set("parameters/conditions/move", true)\n\t\tif event.keycode == KEY_A: $Graph.set("parameters/conditions/attack", true)\n',
      );
      const sceneText = await readFile(path.join(root, 'main.tscn'), 'utf8');
      const inputScene = sceneText
        .replace(/load_steps=(\d+)/, (_match, count: string) => `load_steps=${Number(count) + 1}`)
        .replace(/(\[gd_scene[^\n]*\]\n)/, '$1\n[ext_resource type="Script" path="res://input.gd" id="1_input"]\n')
        .replace(/(\[node name="Main" type="Node2D"[^\n]*\])/, '$1\nscript = ExtResource("1_input")');
      assert.match(inputScene, /\[node name="Main"[^\n]*\]\nscript = ExtResource\("1_input"\)/);
      await writeFile(path.join(root, 'main.tscn'), inputScene);
      const opened = await client.call('open_runtime_bridge', {
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        headless: true,
      });
      assert.equal(opened.isError, undefined, JSON.stringify(opened));
      sessionId = (opened.structuredContent as any).session_id;
      const state = await client.call('get_specialized_state', { sessionId, nodePath: 'Graph' });
      assert.equal(state.isError, undefined, JSON.stringify(state));
      assert.equal((state.structuredContent as any).response.state.animation.graphType, 'state_machine');
      assert.equal((state.structuredContent as any).response.state.animation.current, 'idle');
      const move = await client.call('call_runtime_bridge', {
        sessionId,
        method: 'inject_input',
        params: { keycode: 68, pressed: true },
      });
      assert.equal(move.isError, undefined, JSON.stringify(move));
      await client.call('call_runtime_bridge', { sessionId, method: 'wait_physics_frames', params: { frames: 3 } });
      const walking = await client.call('get_specialized_state', { sessionId, nodePath: 'Graph' });
      assert.equal((walking.structuredContent as any).response.state.animation.current, 'walk');
      const attack = await client.call('call_runtime_bridge', {
        sessionId,
        method: 'inject_input',
        params: { keycode: 65, pressed: true },
      });
      assert.equal(attack.isError, undefined, JSON.stringify(attack));
      await client.call('call_runtime_bridge', { sessionId, method: 'wait_physics_frames', params: { frames: 3 } });
      const attacking = await client.call('get_specialized_state', { sessionId, nodePath: 'Graph' });
      assert.equal((attacking.structuredContent as any).response.state.animation.current, 'attack');
      report.runtime = {
        initial: (state.structuredContent as any).response.state.animation,
        walking: (walking.structuredContent as any).response.state.animation,
        attacking: (attacking.structuredContent as any).response.state.animation,
        inputBinding: 'TEST_ONLY_SCRIPT',
      };
    } finally {
      if (sessionId) await client.call('stop_runtime_bridge', { sessionId }).catch(() => undefined);
      await writeFile(path.join(dir, 'animation-authoring.json'), JSON.stringify({ ...report, reply }, null, 2));
      await client.close();
      await fixture.stop();
    }
  },
);

test(
  'T19 shared native AnimationLibrary is refused before save or unrelated authoring',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 120000 },
  async () => {
    const fixture = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      writeEnabled: true,
      scene: '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n[node name="Hero" type="Node2D" parent="."]\n',
    });
    const client = await wireEditor(fixture.root);
    const dir = path.resolve('runs/production-roadmap/T19', new Date().toISOString().replaceAll(':', '-'));
    await mkdir(dir, { recursive: true });
    const report: Record<string, unknown> = { source: 'REAL', root: fixture.root };
    try {
      const before = await readFile(path.join(fixture.root, 'main.tscn'));
      await fixture.command('share-animation');
      const save = await client.call('save_editor_scene');
      assert.equal(save.isError, true, JSON.stringify(save));
      assert.equal((save.structuredContent as any).code, 'CONFLICT');
      report.saveCode = (save.structuredContent as any).code;
      const unrelated = await client.call('apply_editor_scene', {
        operations: [{ kind: 'create', parent: '.', name: 'Other', type: 'Node2D' }],
      });
      assert.equal(unrelated.isError, true, JSON.stringify(unrelated));
      assert.deepEqual(await readFile(path.join(fixture.root, 'main.tscn')), before);
      report.unrelatedCode = (unrelated.structuredContent as any)?.code;
      report.diskUnchanged = true;
    } finally {
      await writeFile(path.join(dir, 'shared-resources.json'), JSON.stringify(report, null, 2));
      await client.close();
      await fixture.stop();
    }
  },
);

test(
  'T19 real editor creates bounded Blend2 graph with native save/reopen and live parameter readback',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 120000 },
  async () => {
    let fixture = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      writeEnabled: true,
      scene: '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n',
    });
    let client = await wireEditor(fixture.root);
    let sessionId = '';
    const dir = path.resolve('runs/production-roadmap/T19', new Date().toISOString().replaceAll(':', '-'));
    await mkdir(dir, { recursive: true });
    const report: Record<string, unknown> = { source: 'REAL', approval: 'MOCK', root: fixture.root };
    try {
      const result = await client.call('apply_editor_scene', {
        operations: [
          { kind: 'create', parent: '.', name: 'Hero', type: 'Node2D' },
          { kind: 'create', parent: '.', name: 'Animator', type: 'AnimationPlayer' },
          { kind: 'create', parent: '.', name: 'Blend', type: 'AnimationTree' },
          {
            kind: 'animation_clips',
            path: 'Animator',
            clips: [
              {
                id: 'idle',
                length: 1,
                loop: true,
                tracks: [
                  { id: 'position', target: 'Hero', property: 'position', keys: [{ time: 0, value: { x: 0, y: 0 } }] },
                ],
              },
              {
                id: 'walk',
                length: 1,
                loop: true,
                tracks: [
                  {
                    id: 'position',
                    target: 'Hero',
                    property: 'position',
                    keys: [
                      { time: 0, value: { x: 0, y: 0 } },
                      { time: 1, value: { x: 40, y: 0 } },
                    ],
                  },
                ],
              },
            ],
          },
          {
            kind: 'animation_blend',
            path: 'Blend',
            blend: {
              playerPath: 'Animator',
              left: { id: 'idle_source', clip: 'idle' },
              right: { id: 'walk_source', clip: 'walk' },
              blendId: 'locomotion',
            },
          },
        ],
      });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      const changed = (await fixture.command('inspect')).document;
      const graph = changed.nodes.find((node: { path: string }) => node.path === 'Blend')?.animationGraph;
      assert.equal(graph.kind, 'blend2');
      assert.deepEqual(
        graph.states.map((state: { id: string }) => state.id),
        ['idle_source', 'walk_source'],
      );
      report.graph = graph;
      const saved = await client.call('save_editor_scene');
      assert.equal(saved.isError, undefined, JSON.stringify(saved));
      const root = fixture.root;
      await fixture.command('quit');
      await fixture.exited;
      await client.close();
      fixture = await startEditorFixture(process.env.GODOT_PATH!, {
        existingRoot: root,
        controller,
        writeEnabled: true,
      });
      client = await wireEditor(root);
      const reopened = (await fixture.command('inspect')).document;
      assert.deepEqual(reopened.nodes.find((node: { path: string }) => node.path === 'Blend')?.animationGraph, graph);
      report.reopenedGraph = reopened.nodes.find((node: { path: string }) => node.path === 'Blend')?.animationGraph;
      await fixture.command('quit');
      await fixture.exited;
      const opened = await client.call('open_runtime_bridge', {
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        headless: true,
      });
      assert.equal(opened.isError, undefined, JSON.stringify(opened));
      sessionId = (opened.structuredContent as any).session_id;
      const setting = await client.call('call_runtime_bridge', {
        sessionId,
        method: 'set_property',
        params: { nodePath: 'Blend', property: 'parameters/locomotion/blend_amount', value: 0.75 },
      });
      assert.equal(setting.isError, undefined, JSON.stringify(setting));
      const observed = await client.call('get_specialized_state', { sessionId, nodePath: 'Blend' });
      assert.equal(observed.isError, undefined, JSON.stringify(observed));
      assert.equal((observed.structuredContent as any).response.state.animation.blendAmount, 0.75);
      report.runtime = (observed.structuredContent as any).response.state.animation;
    } finally {
      if (sessionId) await client.call('stop_runtime_bridge', { sessionId }).catch(() => undefined);
      await writeFile(path.join(dir, 'blend-tree.json'), JSON.stringify(report, null, 2));
      await client.close().catch(() => undefined);
      await fixture.stop();
    }
  },
);

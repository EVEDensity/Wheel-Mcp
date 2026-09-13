import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSceneResourceGraph } from '../src/godot-development.js';

test('parseSceneResourceGraph builds resource and reverse dependency graph', () => {
  const content = [
    '[gd_scene load_steps=4 format=3]',
    '',
    '[ext_resource type="Script" path="res://player.gd" id="1_script"]',
    '[ext_resource type="PackedScene" path="res://base.tscn" id="2_base"]',
    '[sub_resource type="RectangleShape2D" id="RectangleShape2D_body"]',
    'size = Vector2(32, 16)',
    '',
    '[node name="Player" instance=ExtResource("2_base")]',
    'script = ExtResource("1_script")',
    'shape = SubResource("RectangleShape2D_body")',
  ].join(String.fromCharCode(10));

  const graph = parseSceneResourceGraph(content, 'res://player.tscn');
  assert.equal(graph.format, '3');
  assert.equal(graph.loadSteps, 4);
  assert.deepEqual(
    graph.extResources.map((item) => item.id),
    ['1_script', '2_base'],
  );
  assert.equal(graph.subResources[0].type, 'RectangleShape2D');
  assert.equal(graph.subResources[0].properties.size, 'Vector2(32, 16)');
  assert.equal(graph.nodes[0].path, 'Player');
  assert.deepEqual(graph.nodes[0].resourceRefs.sort(), ['1_script', '2_base', 'RectangleShape2D_body'].sort());
  assert.deepEqual(graph.inheritedScene, { path: 'res://base.tscn', type: 'PackedScene', ref: '2_base' });
  assert.deepEqual(graph.reverseDependencies['1_script'], ['Player.script']);
  assert.deepEqual(graph.reverseDependencies['2_base'], ['Player.instance']);
  assert.deepEqual(graph.reverseDependencies['RectangleShape2D_body'], ['Player.shape']);
});

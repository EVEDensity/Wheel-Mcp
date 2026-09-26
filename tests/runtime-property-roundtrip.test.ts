import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const godotPath = process.env.GODOT_PATH ?? '';
const v2 = (x: number, y: number) => ({ type: 'Vector2', x, y });
const v3 = (x: number, y: number, z: number) => ({ type: 'Vector3', x, y, z });
const basis = { type: 'Basis', x: v3(1, 0, 0), y: v3(0, 1, 0), z: v3(0, 0, 1) };

function body(result: unknown): Record<string, any> {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  return JSON.parse(content?.find((item) => item.type === 'text')?.text ?? '{}') as Record<string, any>;
}

function assertVariant(actual: unknown, expected: unknown): void {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number');
    assert.ok(Math.abs((actual as number) - expected) <= 0.000001 * Math.max(1, Math.abs(expected)));
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual));
    assert.equal(actual.length, expected.length);
    expected.forEach((item, index) => assertVariant(actual[index], item));
  } else if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object' && !Array.isArray(actual));
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
    for (const [key, item] of Object.entries(expected)) assertVariant((actual as Record<string, unknown>)[key], item);
  } else assert.equal(actual, expected);
}

test(
  'real Godot Variant round-trips and invalid writes leave state unchanged',
  { skip: !existsSync(godotPath), timeout: 60000 },
  async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), 'wheel-variant-'));
    await writeFile(path.join(projectPath, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
    await writeFile(
      path.join(projectPath, 'main.tscn'),
      '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://typed.gd" id="1"]\n[node name="Main" type="Node2D"]\nscript = ExtResource("1")\n',
    );
    await writeFile(
      path.join(projectPath, 'typed.gd'),
      `extends Node2D
var bool_value: bool = false
var int_value: int = 0
var float_value: float = 0.0
var string_value: String = ""
var vector2_value: Vector2 = Vector2.ZERO
var vector2i_value: Vector2i = Vector2i.ZERO
var vector3_value: Vector3 = Vector3.ZERO
var vector3i_value: Vector3i = Vector3i.ZERO
var color_value: Color = Color.WHITE
var node_path_value: NodePath = NodePath("")
var quaternion_value: Quaternion = Quaternion.IDENTITY
var basis_value: Basis = Basis.IDENTITY
var transform2d_value: Transform2D = Transform2D.IDENTITY
var transform3d_value: Transform3D = Transform3D.IDENTITY
var array_value: Array = []
var dictionary_value: Dictionary = {}
var resource_value: Resource = null
@export_range(0, 10, 1) var bounded_value: int = 2
func change_int(next_value: int) -> void:
  int_value = next_value
func unsupported_bytes() -> PackedByteArray:
  return PackedByteArray([1, 2, 3])
func unexpected_object() -> RefCounted:
  return RefCounted.new()
func unexpected_resource() -> Resource:
  return Resource.new()
func non_finite_value() -> float:
  return INF
func unsafe_int_value() -> int:
  return 9223372036854775807
`,
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('build/src/mcp-server-sdk.js')],
      stderr: 'pipe',
    });
    const client = new Client({ name: 'variant-roundtrip', version: '1.0.0' });
    let sessionId = '';
    const call = (name: string, args: Record<string, unknown>) =>
      client.callTool({ name, arguments: args }, undefined, { timeout: 20000 });
    const rpc = (method: string, params: Record<string, unknown>) =>
      call('call_runtime_bridge', { sessionId, method, params });
    try {
      await client.connect(transport);
      const opened = await call('open_runtime_bridge', {
        godotPath,
        projectPath,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        headless: true,
        timeoutMs: 15000,
      });
      assert.equal(opened.isError, undefined, JSON.stringify(opened));
      sessionId = body(opened).session_id;
      const examples: Array<[string, unknown]> = [
        ['bool_value', true],
        ['int_value', 42],
        ['float_value', 0.125],
        ['string_value', 'Vector2(1,2)'],
        ['vector2_value', v2(12.5, -7.25)],
        ['vector2i_value', { type: 'Vector2i', x: 7, y: -4 }],
        ['vector3_value', v3(1.25, 2.5, -3.75)],
        ['vector3i_value', { type: 'Vector3i', x: 3, y: -2, z: 1 }],
        ['color_value', { type: 'Color', r: 0.2, g: 0.4, b: 0.6, a: 0.8 }],
        ['node_path_value', { type: 'NodePath', path: 'Child' }],
        ['quaternion_value', { type: 'Quaternion', x: 0, y: 0, z: 0, w: 1 }],
        ['basis_value', basis],
        ['transform2d_value', { type: 'Transform2D', x: v2(1, 0), y: v2(0, 1), origin: v2(8, 9) }],
        ['transform3d_value', { type: 'Transform3D', basis, origin: v3(10, 20, 30) }],
        ['array_value', [v2(3, 4), { nested: 'plain' }]],
        ['dictionary_value', { nested: v3(5, 6, 7), label: 'Vector3(5,6,7)' }],
        ['resource_value', null],
      ];
      for (const [property, value] of examples) {
        const write = await rpc('set_property', { nodePath: '.', property, value });
        assert.equal(write.isError, undefined, `${property}: ${JSON.stringify(write)}`);
        assertVariant(body(write).response.after, value);
        const read = await rpc('get_property', { nodePath: '.', property });
        assert.equal(read.isError, undefined, `${property}: ${JSON.stringify(read)}`);
        assertVariant(body(read).response.value, value);
      }
      const wrongType = await rpc('set_property', {
        nodePath: '.',
        property: 'vector2_value',
        value: 'Vector2(1,2)',
      });
      assert.equal(wrongType.isError, true);
      assert.equal(body(wrongType).code, 'INVALID_ARGUMENT');
      const unchanged = await rpc('get_property', { nodePath: '.', property: 'vector2_value' });
      assertVariant(body(unchanged).response.value, v2(12.5, -7.25));
      const outOfRange = await rpc('set_property', { nodePath: '.', property: 'bounded_value', value: 11 });
      assert.equal(outOfRange.isError, true);
      assert.equal(body(outOfRange).code, 'INVALID_ARGUMENT');
      const boundedUnchanged = await rpc('get_property', { nodePath: '.', property: 'bounded_value' });
      assert.equal(body(boundedUnchanged).response.value, 2);
      const boundedValid = await rpc('set_property', { nodePath: '.', property: 'bounded_value', value: 7 });
      assert.equal(boundedValid.isError, undefined, JSON.stringify(boundedValid));
      const legacyWrite = await call('set_runtime_property', {
        godotPath,
        projectPath,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        evidenceDir: path.join(projectPath, 'legacy-variant-write'),
        nodePath: '.',
        property: 'vector2_value',
        value: v2(6, 7),
      });
      assert.equal(legacyWrite.isError, undefined, JSON.stringify(legacyWrite));
      assertVariant(body(legacyWrite).response.after, v2(6, 7));
      const legacyWrong = await call('set_runtime_property', {
        godotPath,
        projectPath,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        evidenceDir: path.join(projectPath, 'legacy-variant-error'),
        nodePath: '.',
        property: 'vector2_value',
        value: 'Vector2(6,7)',
      });
      assert.equal(legacyWrong.isError, true);
      assert.equal(body(legacyWrong).code, 'INVALID_ARGUMENT');
      const resource = await rpc('set_property', {
        nodePath: '.',
        property: 'resource_value',
        value: { type: 'Resource', path: 'res://secret.tres' },
      });
      assert.equal(resource.isError, true);
      assert.equal(body(resource).code, 'UNSUPPORTED');
      const badMethodType = await rpc('call_method', {
        nodePath: '.',
        method: 'change_int',
        args: ['42'],
      });
      assert.equal(badMethodType.isError, true);
      assert.equal(body(badMethodType).code, 'INVALID_ARGUMENT');
      const badMethodArity = await rpc('call_method', {
        nodePath: '.',
        method: 'change_int',
        args: [],
      });
      assert.equal(badMethodArity.isError, true);
      assert.equal(body(badMethodArity).code, 'INVALID_ARGUMENT');
      const intRead = await rpc('get_property', { nodePath: '.', property: 'int_value' });
      assert.equal(body(intRead).response.value, 42);
      const goodMethod = await rpc('call_method', {
        nodePath: '.',
        method: 'change_int',
        args: [43],
      });
      assert.equal(goodMethod.isError, undefined, JSON.stringify(goodMethod));
      const updatedInt = await rpc('get_property', { nodePath: '.', property: 'int_value' });
      assert.equal(body(updatedInt).response.value, 43);
      for (const method of [
        'unsupported_bytes',
        'unexpected_object',
        'unexpected_resource',
        'non_finite_value',
        'unsafe_int_value',
      ]) {
        const unsupportedResult = await rpc('call_method', { nodePath: '.', method, args: [] });
        assert.equal(unsupportedResult.isError, true, JSON.stringify(unsupportedResult));
        assert.equal(body(unsupportedResult).code, 'UNSUPPORTED');
      }
      const failedCreate = await call('create_runtime_node', {
        sessionId,
        parentPath: '.',
        type: 'Node2D',
        name: 'ShouldNotExist',
        properties: { rotation: 1.5, position: 'Vector2(1,2)' },
      });
      assert.equal(failedCreate.isError, true);
      const absent = await rpc('get_property', { nodePath: 'ShouldNotExist', property: 'position' });
      assert.equal(absent.isError, true);
      assert.equal(body(absent).code, 'NOT_FOUND');
    } finally {
      if (sessionId) await call('stop_runtime_bridge', { sessionId }).catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  },
);

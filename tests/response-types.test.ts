import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnifiedResponse, serializeGodotValue } from '../src/response-types.js';

test('serializes common Godot variants into stable typed objects', () => {
  assert.deepEqual(serializeGodotValue({ position: '(1, 2)' }), { position: '(1, 2)' });
  assert.deepEqual(serializeGodotValue('Vector2(1.5, -2)'), { type: 'Vector2', x: 1.5, y: -2 });
  assert.deepEqual(serializeGodotValue('Vector3(1, 2, 3)'), { type: 'Vector3', x: 1, y: 2, z: 3 });
  assert.deepEqual(serializeGodotValue('Color(1, 0.5, 0)'), { type: 'Color', r: 1, g: 0.5, b: 0, a: 1 });
  assert.deepEqual(serializeGodotValue('NodePath("Player/Camera2D")'), { type: 'NodePath', path: 'Player/Camera2D' });
});

test('creates a unified MCP response envelope', () => {
  assert.deepEqual(createUnifiedResponse({ status: 'PASS', position: 'Vector2(4, 8)' }), {
    schema_version: '0.1',
    source: 'REAL',
    status: 'PASS',
    position: { type: 'Vector2', x: 4, y: 8 },
  });
});

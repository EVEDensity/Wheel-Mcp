import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnifiedResponse, serializeGodotValue } from '../src/response-types.js';

test('preserves ordinary strings and already tagged Godot variants', () => {
  assert.deepEqual(serializeGodotValue({ position: '(1, 2)' }), { position: '(1, 2)' });
  assert.equal(serializeGodotValue('Vector2(1.5, -2)'), 'Vector2(1.5, -2)');
  assert.deepEqual(serializeGodotValue({ type: 'Vector3', x: 1, y: 2, z: 3 }), {
    type: 'Vector3',
    x: 1,
    y: 2,
    z: 3,
  });
});

test('creates a unified MCP response envelope', () => {
  assert.deepEqual(createUnifiedResponse({ status: 'PASS', position: 'Vector2(4, 8)' }), {
    schema_version: '0.1',
    source: 'REAL',
    status: 'PASS',
    position: 'Vector2(4, 8)',
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVariantInput, validateVariantOutput } from '../src/protocol/variant.js';
import { classifyError } from '../src/error-schema.js';

const v2 = (x: number, y: number) => ({ type: 'Vector2', x, y });
const v3 = (x: number, y: number, z: number) => ({ type: 'Vector3', x, y, z });
function errorCode(operation: () => void): string {
  let error: unknown;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, 'operation should reject invalid Variant');
  return classifyError(error).code;
}

test('explicit Variant tags, nested transforms, arrays and dictionaries validate without parsing strings', () => {
  const value = {
    flag: true,
    count: 42,
    ratio: 0.125,
    literal: 'Vector2(1,2)',
    optional: null,
    vector2: v2(1, 2),
    vector2i: { type: 'Vector2i', x: -3, y: 4 },
    vector3: v3(1, 2, 3),
    vector3i: { type: 'Vector3i', x: -1, y: 2, z: 3 },
    color: { type: 'Color', r: 0.2, g: 0.4, b: 0.6, a: 0.8 },
    nodePath: { type: 'NodePath', path: 'Child' },
    quaternion: { type: 'Quaternion', x: 0, y: 0, z: 0, w: 1 },
    basis: { type: 'Basis', x: v3(1, 0, 0), y: v3(0, 1, 0), z: v3(0, 0, 1) },
    transform2d: { type: 'Transform2D', x: v2(1, 0), y: v2(0, 1), origin: v2(10, 20) },
    transform3d: {
      type: 'Transform3D',
      basis: { type: 'Basis', x: v3(1, 0, 0), y: v3(0, 1, 0), z: v3(0, 0, 1) },
      origin: v3(10, 20, 30),
    },
    array: [v2(1, 2), { nested: 'plain' }],
  };
  assert.doesNotThrow(() => validateVariantInput(value));
  assert.doesNotThrow(() => validateVariantOutput(value));
});

test('malformed, non-finite, unsafe and unsupported variants have stable errors', () => {
  for (const value of [
    { type: 'Vector2', x: 1 },
    { type: 'Vector2i', x: 1.25, y: 2 },
    { type: 'Transform3D', basis: v3(1, 2, 3), origin: v3(0, 0, 0) },
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.equal(
      errorCode(() => validateVariantInput(value)),
      'INVALID_ARGUMENT',
    );
  }
  for (const value of [{ type: 'Resource', path: 'res://secret.tres' }, { type: 'Unsupported' }]) {
    assert.equal(
      errorCode(() => validateVariantInput(value)),
      'UNSUPPORTED',
    );
  }
  assert.equal(
    errorCode(() => validateVariantOutput({ type: 'Unsupported', reason: 'PackedByteArray' })),
    'UNSUPPORTED',
  );
});

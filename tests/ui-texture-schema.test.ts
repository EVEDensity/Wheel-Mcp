import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneOperationsSchema } from '../src/editor/scene-service.js';
import { resourceRequestSchema } from '../src/editor/resource-service.js';

const color = { type: 'Color', r: 1, g: 0, b: 0, a: 1 };
test('TextureRect stable layouts and bounded two-stop texture sources pass public schemas', () => {
  for (let mode = 0; mode <= 6; mode++)
    assert.equal(
      sceneOperationsSchema.safeParse([
        { kind: 'create', parent: '.', name: 'Icon', type: 'TextureRect' },
        {
          kind: 'ui_set',
          path: 'Icon',
          properties: { stretch_mode: mode, expand_mode: 1, flip_h: true, flip_v: false },
        },
      ]).success,
      true,
    );
  for (const size of [1, 32])
    assert.equal(
      resourceRequestSchema.safeParse({
        action: 'texture',
        source: { format: 'linear-gradient', width: size, height: size, colors: [color, color] },
      }).success,
      true,
    );
});
test('texture schemas reject files, opaque graphs, unstable expand modes and invalid budgets', () => {
  for (const properties of [
    { expand_mode: 2 },
    { expand_mode: -1 },
    { stretch_mode: 7 },
    { stretch_mode: 1.5 },
    { flip_h: 1 },
    { texture: 'res://icon.png' },
  ])
    assert.equal(sceneOperationsSchema.safeParse([{ kind: 'ui_set', path: 'Icon', properties }]).success, false);
  const source = { format: 'linear-gradient', width: 16, height: 16, colors: [color, color] };
  for (const invalid of [
    { ...source, width: 33 },
    { ...source, height: 0 },
    { ...source, width: 1.5 },
    { ...source, colors: [color] },
    { ...source, colors: [color, { ...color, a: 2 }] },
    { ...source, path: 'res://icon.png' },
    { ...source, use_hdr: true },
    { ...source, format: 'image' },
  ])
    assert.equal(resourceRequestSchema.safeParse({ action: 'texture', source: invalid }).success, false);
});

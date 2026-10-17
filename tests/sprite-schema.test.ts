import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneOperationsSchema } from '../src/editor/scene-service.js';
test('Sprite2D creation and bounded single-frame sprite fields have explicit schemas', () => {
  assert.equal(
    sceneOperationsSchema.safeParse([
      { kind: 'create', parent: '.', name: 'Sprite', type: 'Sprite2D' },
      {
        kind: 'sprite_set',
        path: 'Sprite',
        properties: {
          centered: false,
          flip_h: true,
          flip_v: false,
          offset: { type: 'Vector2', x: -100000, y: 100000 },
        },
      },
    ]).success,
    true,
  );
});
test('sprite schema refuses raw textures, frame/region/material/script edits and invalid field budgets', () => {
  for (const properties of [
    {},
    { centered: 1 },
    { flip_h: 'yes' },
    { offset: { type: 'Vector2', x: Infinity, y: 0 } },
    { offset: { type: 'Vector2', x: 100001, y: 0 } },
    { offset: { type: 'Vector2i', x: 0, y: 0 } },
    { texture: 'res://icon.png' },
    { hframes: 2 },
    { frame: 1 },
    { region_enabled: true },
    { material: {} },
    { script: 'res://x.gd' },
  ])
    assert.equal(
      sceneOperationsSchema.safeParse([{ kind: 'sprite_set', path: 'Sprite', properties }]).success,
      false,
      JSON.stringify(properties),
    );
});

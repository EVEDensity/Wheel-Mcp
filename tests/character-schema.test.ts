import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneOperationsSchema } from '../src/editor/scene-service.js';

test('CharacterBody2D uses an explicit native configuration grammar, not script attachment or velocity', () => {
  assert.equal(
    sceneOperationsSchema.safeParse([
      { kind: 'create', parent: '.', name: 'Player', type: 'CharacterBody2D' },
      {
        kind: 'character_set',
        path: 'Player',
        properties: {
          collision_layer: 0xffffffff,
          collision_mask: 0,
          motion_mode: 1,
          safe_margin: 0.125,
          max_slides: 8,
          floor_snap_length: 100,
        },
      },
    ]).success,
    true,
  );
});

test('character schema rejects unknown classes, executable fields, empty and out-of-budget configuration', () => {
  for (const properties of [
    {},
    { velocity: { type: 'Vector2', x: 100, y: 0 } },
    { script: 'res://controller.gd' },
    { motion_mode: 2 },
    { collision_layer: -1 },
    { collision_mask: 0x100000000 },
    { collision_mask: 1.5 },
    { max_slides: 0 },
    { max_slides: 9 },
    { max_slides: true },
    { safe_margin: 0 },
    { safe_margin: Infinity },
    { floor_snap_length: -1 },
    { floor_snap_length: 101 },
  ])
    assert.equal(
      sceneOperationsSchema.safeParse([{ kind: 'character_set', path: 'Player', properties }]).success,
      false,
    );
  assert.equal(
    sceneOperationsSchema.safeParse([{ kind: 'create', parent: '.', name: 'Player', type: 'CharacterBody3D' }]).success,
    false,
  );
});

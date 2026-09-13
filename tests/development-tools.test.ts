import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeCollisions } from '../src/godot-development.js';

test('analyze collisions reports nodes and empty shapes', async () => {
  const d = await mkdtemp(path.join(os.tmpdir(), 'gd-'));
  const content = [
    '[gd_scene format=3]',
    '[node name="Player" type="CharacterBody2D"]',
    'collision_layer = 1',
    'collision_mask = 0',
    '[node name="Shape" type="CollisionShape2D" parent="Player"]',
    'shape = null',
  ].join('\n');
  await writeFile(path.join(d, 'x.tscn'), content);
  const result = await analyzeCollisions(d, 'x.tscn');
  assert.equal(result.collisionCount, 2);
  assert.ok(result.warnings.some((item: any) => item.code === 'EMPTY_COLLISION_SHAPE'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { animationClipsSchema } from '../src/editor/animation-schema.js';

const track = (property: string, value: unknown, id = property) => ({
  id,
  target: 'Hero',
  property,
  keys: [{ time: 0, value }],
});
const clips = (tracks: unknown[]) => [{ id: 'turn', length: 1, loop: false, tracks }];

test('3D animation uses explicit unit quaternion and positive Vector3 channels, without changing legacy grammar', () => {
  for (const q of [
    { x: 0, y: 0, z: 0, w: 1 },
    { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    { x: 0, y: 0, z: 0, w: -1 },
  ])
    assert.equal(
      animationClipsSchema.safeParse(clips([track('rotation_3d', q), track('scale_3d', { x: 0.0625, y: 16, z: 2 })]))
        .success,
      true,
    );
});

test('3D animation refuses unnormalized, zero, non-finite or wrongly shaped quaternions and unsafe scales', () => {
  for (const value of [
    0,
    {},
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0, w: 0 },
    { x: 0, y: 0, z: 0, w: 2 },
    { x: NaN, y: 0, z: 0, w: 1 },
    { x: 0, y: 0, z: 0, w: 1.000001 },
    { x: 0, y: 0, z: 0, w: 1, order: 'YXZ' },
  ])
    assert.equal(animationClipsSchema.safeParse(clips([track('rotation_3d', value)])).success, false);
  for (const value of [
    { x: 1, y: 1 },
    { x: 1, y: 1, z: 0 },
    { x: 1, y: 1, z: -1 },
    { x: 1, y: 1, z: 0.06249999999 },
    { x: 1, y: 1, z: 16.00000001 },
    { x: 1, y: 1, z: Infinity },
  ])
    assert.equal(animationClipsSchema.safeParse(clips([track('scale_3d', value)])).success, false);
});

test('3D channels retain duplicate-channel, key-count, time and unknown-track refusal', () => {
  const rotation = track('rotation_3d', { x: 0, y: 0, z: 0, w: 1 });
  for (const tracks of [
    [rotation, { ...rotation, id: 'other' }],
    [{ ...rotation, keys: [{ time: -1, value: rotation.keys[0].value }] }],
    [{ ...rotation, keys: [{ time: 1.1, value: rotation.keys[0].value }] }],
    [{ ...rotation, keys: Array.from({ length: 33 }, (_, i) => ({ time: i / 33, value: rotation.keys[0].value })) }],
    [track('rotation_degrees', { x: 0, y: 90, z: 0 })],
    [{ ...rotation, interpolation: 'cubic' }],
  ])
    assert.equal(animationClipsSchema.safeParse(clips(tracks)).success, false);
});

test('animation channels distinguish radians, positive 2D scale and legacy 2D/3D position', () => {
  assert.equal(
    animationClipsSchema.safeParse(
      clips([
        track('position', { x: -100000, y: 100000 }),
        track('rotation', -32),
        track('scale', { x: 0.0625, y: 16 }),
      ]),
    ).success,
    true,
  );
  assert.equal(animationClipsSchema.safeParse(clips([track('position', { x: 1, y: 2, z: 3 })])).success, true);
});

test('animation channel schemas reject wrong dimensions, unsafe scales, units and executable tracks', () => {
  for (const [property, value] of [
    ['rotation', { x: 0, y: 0 }],
    ['rotation', NaN],
    ['rotation', Infinity],
    ['rotation', 32.01],
    ['rotation', '90deg'],
    ['scale', 1],
    ['scale', { x: 1, y: 1, z: 1 }],
    ['scale', { x: 0, y: 1 }],
    ['scale', { x: -1, y: 1 }],
    ['scale', { x: 0.0624, y: 1 }],
    ['scale', { x: 1, y: 16.01 }],
    ['scale', { x: 1, y: Infinity }],
    ['position', 1],
    ['rotation_degrees', 90],
    ['method', 'queue_free'],
    ['scale:x', 2],
  ] as const)
    assert.equal(animationClipsSchema.safeParse(clips([track(property, value)])).success, false, property);
});

test('animation channels retain key/time/ID budgets and reject duplicate target properties', () => {
  const t = track('rotation', 1);
  for (const tracks of [
    [t, { ...t, id: 'other' }],
    [t, { ...t, property: 'scale', keys: [{ time: 0, value: { x: 1, y: 1 } }] }],
    [
      {
        ...t,
        keys: [
          { time: 0, value: 0 },
          { time: 0, value: 1 },
        ],
      },
    ],
    [{ ...t, keys: [{ time: 1.01, value: 0 }] }],
    [{ ...t, keys: [{ time: -1, value: 0 }] }],
    [{ ...t, keys: Array.from({ length: 33 }, (_, i) => ({ time: i / 33, value: 0 })) }],
    [{ ...t, interpolation: 'cubic' }],
    [{ ...t, keys: [{ time: 0, value: 0, transition: 0 }] }],
  ])
    assert.equal(animationClipsSchema.safeParse(clips(tracks)).success, false);
});

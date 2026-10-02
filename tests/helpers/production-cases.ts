import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sceneOperationsSchema } from '../../src/editor/scene-service.js';

export const caseScene =
  '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n[node name="Marker" type="Node2D" parent="."]\nposition = Vector2(40, 0)\n[node name="Target" type="Node2D" parent="."]\n';
export const caseComponent =
  '[gd_scene format=3]\n[node name="Component" type="Node2D"]\n[node name="Tip" type="Marker2D" parent="."]\n';
export const caseDigest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export const productionCaseSchema = z
  .object({
    id: z.string().regex(/^[NUPAS]0[1-6]$/),
    family: z.enum(['nodes', 'ui', 'physics', 'animation', 'scripts']),
    scopes: z.tuple([z.literal('read'), z.literal('write'), z.literal('run')]),
    operations: sceneOperationsSchema,
    negative: sceneOperationsSchema,
    negativeCode: z.enum(['INVALID_ARGUMENT', 'CONFLICT', 'FORBIDDEN', 'UNSUPPORTED']),
    expectedPaths: z.array(z.string().min(1)).min(1),
    absentPaths: z.array(z.string().min(1)),
    savedFragments: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type ProductionCase = z.infer<typeof productionCaseSchema>;
const create = (parent: string, name: string, type = 'Node2D') => ({ kind: 'create', parent, name, type });
const invalidParent = [create('Missing', 'Invalid')];
const scopes = ['read', 'write', 'run'];
/** Fixed requests, not a task planner. The partial catalog is never a G5 qualification. */
const definitions = [
  {
    id: 'N01',
    family: 'nodes',
    scopes,
    operations: [
      create('.', 'NewMarker', 'Marker2D'),
      { kind: 'set', path: 'NewMarker', property: 'position', value: { type: 'Vector2', x: 8, y: 9 } },
    ],
    negative: invalidParent,
    negativeCode: 'INVALID_ARGUMENT',
    expectedPaths: ['NewMarker'],
    absentPaths: ['Invalid'],
    savedFragments: ['position = Vector2(8, 9)'],
  },
  {
    id: 'N02',
    family: 'nodes',
    scopes,
    operations: [{ kind: 'rename', path: 'Marker', name: 'Renamed' }],
    negative: [{ kind: 'rename', path: 'Marker', name: 'Target' }],
    negativeCode: 'CONFLICT',
    expectedPaths: ['Renamed'],
    absentPaths: ['Marker'],
    savedFragments: ['name="Renamed"'],
  },
  {
    id: 'N03',
    family: 'nodes',
    scopes,
    operations: [{ kind: 'reparent', path: 'Marker', parent: 'Target' }],
    negative: [{ kind: 'reparent', path: 'Marker', parent: 'Marker' }],
    negativeCode: 'INVALID_ARGUMENT',
    expectedPaths: ['Target/Marker'],
    absentPaths: ['Marker'],
    savedFragments: ['name="Marker" type="Node2D" parent="Target"'],
  },
  {
    id: 'N04',
    family: 'nodes',
    scopes,
    operations: [
      {
        kind: 'instantiate',
        parent: '.',
        name: 'Instance',
        scenePath: 'res://component.tscn',
        sourceHash: caseDigest(caseComponent),
        policy: 'preserve',
      },
    ],
    negative: [
      {
        kind: 'instantiate',
        parent: '.',
        name: 'Invalid',
        scenePath: 'res://component.tscn',
        sourceHash: '0'.repeat(64),
        policy: 'preserve',
      },
    ],
    negativeCode: 'CONFLICT',
    expectedPaths: ['Instance', 'Instance/Tip'],
    absentPaths: ['Invalid'],
    savedFragments: ['res://component.tscn', 'name="Instance"'],
  },
  {
    id: 'N05',
    family: 'nodes',
    scopes,
    operations: [
      create('.', 'SignalButton', 'Button'),
      { kind: 'connect', path: 'SignalButton', signal: 'pressed', target: 'Target', method: 'hide' },
    ],
    negative: [
      create('.', 'SignalButton', 'Button'),
      { kind: 'connect', path: 'SignalButton', signal: 'pressed', target: 'Missing', method: 'hide' },
    ],
    negativeCode: 'UNSUPPORTED',
    expectedPaths: ['Marker', 'Target', 'SignalButton'],
    absentPaths: ['Invalid'],
    savedFragments: ['connection signal="pressed" from="SignalButton" to="Target" method="hide"'],
  },
  {
    id: 'N06',
    family: 'nodes',
    scopes,
    operations: [create('.', 'Batch'), create('Batch', 'Child')],
    negative: [create('.', 'Partial'), create('Missing', 'Invalid')],
    negativeCode: 'INVALID_ARGUMENT',
    expectedPaths: ['Batch', 'Batch/Child'],
    absentPaths: ['Partial', 'Invalid'],
    savedFragments: ['name="Batch"', 'name="Child" type="Node2D" parent="Batch"'],
  },
];
export function nodeProductionCases(): ProductionCase[] {
  return definitions.map((definition) => productionCaseSchema.parse(structuredClone(definition)));
}
export function assertProductionCaseCoverage(input: unknown) {
  const cases = z.array(productionCaseSchema).parse(input);
  if (new Set(cases.map((item) => item.id)).size !== cases.length) throw new Error('Duplicate production case ID');
  const families = { N: 'nodes', U: 'ui', P: 'physics', A: 'animation', S: 'scripts' };
  for (const item of cases)
    if (families[item.id[0] as keyof typeof families] !== item.family) throw new Error('Case ID/family mismatch');
  if (
    cases.length < 30 ||
    Object.values(families).some((family) => cases.filter((item) => item.family === family).length < 5)
  )
    throw new Error('Qualification requires at least 30 cases and five per family');
  return cases;
}

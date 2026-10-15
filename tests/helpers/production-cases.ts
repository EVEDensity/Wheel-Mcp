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

const stepSchema = z
  .object({
    tool: z.string().min(1).optional(),
    action: z.enum(['hashFile', 'comparePng', 'fixture', 'fileIncludes']).optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    bind: z.string().min(1).optional(),
    bindFrom: z.string().min(1).optional(),
    expectCode: z.enum(['INVALID_ARGUMENT', 'CONFLICT', 'FORBIDDEN', 'UNSUPPORTED', 'NOT_FOUND', 'TIMEOUT']).optional(),
    expectInvalidParams: z.literal(true).optional(),
    expectMatch: z.string().min(1).max(200).optional(),
    equals: z
      .object({ path: z.string().min(1), value: z.unknown() })
      .strict()
      .optional(),
    approx: z
      .object({ path: z.string().min(1), value: z.number().finite(), tolerance: z.number().positive().max(1) })
      .strict()
      .optional(),
    orderedPathSuffixes: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .refine((step) => Boolean(step.tool) !== Boolean(step.action), 'A step needs exactly one tool or local action');
export const extendedProductionCaseSchema = z
  .object({
    id: z.string().regex(/^[UPAS]0[1-6]$/),
    family: z.enum(['ui', 'physics', 'animation', 'scripts']),
    scopes: z.tuple([z.literal('read'), z.literal('write'), z.literal('run')]),
    scene: z.string().min(1),
    files: z.record(z.string(), z.string()).optional(),
    denial: stepSchema,
    negative: z.array(stepSchema).min(1),
    positive: z.array(stepSchema).min(1),
    undo: z.boolean(),
    expectedPaths: z.array(z.string().min(1)).min(1),
    absentPaths: z.array(z.string().min(1)),
    savedFragments: z.array(z.string().min(1)).min(1),
    runtime: z.array(stepSchema).optional(),
    restartAfterNegative: z.literal(true).optional(),
  })
  .strict();
export type ExtendedProductionCase = z.infer<typeof extendedProductionCaseSchema>;
const uiScene = '[gd_scene format=3]\n[node name="Main" type="Control"]\n';
const color = (r: number, g: number, b: number, a = 1) => ({ type: 'Color', r, g, b, a });
const vector2 = (x: number, y: number) => ({ type: 'Vector2', x, y });
const createNode = (parent: string, name: string, type: string) => ({ kind: 'create', parent, name, type });
const uiSet = (nodePath: string, properties: Record<string, unknown>) => ({
  kind: 'ui_set',
  path: nodePath,
  properties,
});
const foreignSession = 'f'.repeat(32);
const uiDefinitions = [
  {
    id: 'U01',
    family: 'ui',
    scopes,
    scene: uiScene,
    denial: {
      tool: 'apply_editor_scene',
      args: {
        operations: [
          createNode('.', 'Frame', 'Control'),
          uiSet('Frame', {
            anchor_left: 0,
            anchor_top: 0,
            anchor_right: 1,
            anchor_bottom: 1,
            offset_left: 12,
            offset_top: 8,
            offset_right: -12,
            offset_bottom: -8,
            grow_horizontal: 2,
            grow_vertical: 2,
          }),
        ],
      },
    },
    negative: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'U01-negative',
          operations: [createNode('.', 'Bad', 'Control'), uiSet('Bad', { size_flags_horizontal: 12 })],
        },
        expectCode: 'INVALID_ARGUMENT',
      },
    ],
    positive: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'U01-positive',
          operations: [
            createNode('.', 'Frame', 'Control'),
            uiSet('Frame', {
              anchor_left: 0,
              anchor_top: 0,
              anchor_right: 1,
              anchor_bottom: 1,
              offset_left: 12,
              offset_top: 8,
              offset_right: -12,
              offset_bottom: -8,
              grow_horizontal: 2,
              grow_vertical: 2,
            }),
          ],
        },
      },
    ],
    undo: true,
    expectedPaths: ['Frame'],
    absentPaths: ['Bad'],
    savedFragments: ['offset_left = 12', 'anchor_right = 1', 'grow_horizontal = 2', 'grow_vertical = 2'],
  },
  {
    id: 'U02',
    family: 'ui',
    scopes,
    scene: uiScene,
    denial: {
      tool: 'apply_editor_scene',
      args: {
        operations: [
          createNode('.', 'Title', 'Label'),
          uiSet('Title', { text: 'Score', autowrap_mode: 3 }),
          createNode('.', 'Action', 'Button'),
          uiSet('Action', { text: 'Play', disabled: true }),
        ],
      },
    },
    negative: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'U02-negative',
          operations: [createNode('.', 'BadLabel', 'Label'), uiSet('BadLabel', { button_pressed: true })],
        },
        expectCode: 'UNSUPPORTED',
      },
    ],
    positive: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'U02-positive',
          operations: [
            createNode('.', 'Title', 'Label'),
            uiSet('Title', { text: 'Score', autowrap_mode: 3 }),
            createNode('.', 'Action', 'Button'),
            uiSet('Action', { text: 'Play', disabled: true }),
          ],
        },
      },
    ],
    undo: true,
    expectedPaths: ['Title', 'Action'],
    absentPaths: ['BadLabel'],
    savedFragments: ['text = "Score"', 'text = "Play"', 'disabled = true'],
  },
  {
    id: 'U03',
    family: 'ui',
    scopes,
    scene: uiScene,
    denial: {
      tool: 'apply_editor_scene',
      args: { operations: [createNode('.', 'Column', 'VBoxContainer')] },
    },
    negative: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'U03-negative',
          operations: [
            createNode('.', 'Box', 'VBoxContainer'),
            createNode('Box', 'Child', 'Button'),
            uiSet('Box/Child', { offset_left: 4 }),
          ],
        },
        expectCode: 'CONFLICT',
      },
    ],
    positive: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'U03-positive',
          operations: [
            createNode('.', 'Column', 'VBoxContainer'),
            createNode('Column', 'First', 'Button'),
            createNode('Column', 'Second', 'Button'),
            uiSet('Column/First', { text: 'First', custom_minimum_size: vector2(80, 24) }),
            uiSet('Column/Second', { text: 'Second', custom_minimum_size: vector2(80, 24) }),
          ],
        },
      },
    ],
    undo: true,
    expectedPaths: ['Column', 'Column/First', 'Column/Second'],
    absentPaths: ['Box', 'Box/Child'],
    savedFragments: ['type="VBoxContainer"', 'text = "First"', 'text = "Second"'],
    runtime: [
      {
        tool: 'open_runtime_bridge',
        args: {
          headless: true,
          evidenceDir: { rootRelative: '.harness/u03-evidence' },
          bridgePath: { repoFile: 'godot-plugin/runtime_bridge.gd' },
        },
        bind: 'session',
        bindFrom: 'session_id',
      },
      {
        tool: 'call_runtime_bridge',
        args: {
          sessionId: { bind: 'session' },
          method: 'get_scene_tree',
          params: { subtree: '.' },
        },
        orderedPathSuffixes: ['Column', 'Column/First', 'Column/Second'],
      },
      {
        tool: 'call_runtime_bridge',
        args: {
          sessionId: { bind: 'session' },
          method: 'get_property',
          params: { nodePath: 'Column/First', property: 'text' },
        },
        equals: { path: 'response.value', value: 'First' },
      },
      {
        tool: 'call_runtime_bridge',
        args: {
          sessionId: { bind: 'session' },
          method: 'get_property',
          params: { nodePath: 'Column/Second', property: 'text' },
        },
        equals: { path: 'response.value', value: 'Second' },
      },
      { tool: 'stop_runtime_bridge', args: { sessionId: { bind: 'session' } } },
    ],
  },
  {
    id: 'U04',
    family: 'ui',
    scopes,
    scene: uiScene,
    denial: {
      tool: 'manage_editor_resource',
      args: {
        request: {
          action: 'theme',
          items: [{ kind: 'font_size', themeType: 'Label', name: 'font_size', value: 18 }],
        },
      },
    },
    negative: [
      {
        tool: 'manage_editor_resource',
        args: {
          request: {
            action: 'theme',
            items: [{ kind: 'color', themeType: 'Label', name: 'not_a_slot', value: color(1, 1, 1) }],
          },
        },
        expectCode: 'UNSUPPORTED',
      },
    ],
    positive: [
      {
        tool: 'manage_editor_resource',
        args: {
          request: {
            action: 'create',
            resourceType: 'StyleBoxFlat',
            properties: { bg_color: color(0.25, 0.5, 0.75) },
          },
        },
        bind: 'style',
        bindFrom: 'ref',
      },
      {
        tool: 'manage_editor_resource',
        args: {
          request: {
            action: 'theme',
            items: [
              { kind: 'font_size', themeType: 'Label', name: 'font_size', value: 18 },
              { kind: 'color', themeType: 'Label', name: 'font_color', value: color(0.875, 0.9375, 1) },
              { kind: 'constant', themeType: 'VBoxContainer', name: 'separation', value: 12 },
              {
                kind: 'stylebox',
                themeType: 'Button',
                name: 'normal',
                ref: { bind: 'style' },
                policy: 'make_unique',
              },
            ],
          },
        },
        bind: 'theme',
        bindFrom: 'ref',
      },
      {
        tool: 'manage_editor_resource',
        args: { request: { action: 'read', ref: { bind: 'style' } } },
        equals: { path: 'properties.bg_color', value: color(0.25, 0.5, 0.75) },
      },
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'U04-positive',
          operations: [
            createNode('.', 'Screen', 'Control'),
            { kind: 'resource_assign', path: 'Screen', property: 'theme', ref: { bind: 'theme' }, policy: 'shared' },
          ],
        },
      },
    ],
    undo: true,
    expectedPaths: ['Screen'],
    absentPaths: ['Bad'],
    savedFragments: [
      'type="Theme"',
      'Label/font_sizes/font_size = 18',
      'Label/colors/font_color = Color(0.875, 0.9375, 1, 1)',
      'VBoxContainer/constants/separation = 12',
      'Button/styles/normal = SubResource',
    ],
  },
  {
    id: 'U05',
    family: 'ui',
    scopes,
    scene: uiScene,
    denial: {
      tool: 'manage_editor_resource',
      args: {
        request: { action: 'create', resourceType: 'StyleBoxFlat', properties: { bg_color: color(0.25, 0.25, 0.25) } },
      },
    },
    negative: [
      {
        tool: 'manage_editor_resource',
        args: {
          request: { action: 'create', resourceType: 'StyleBoxFlat', properties: { bg_color: color(0.5, 0.25, 0.25) } },
        },
        bind: 'badStyle',
        bindFrom: 'ref',
      },
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'U05-negative',
          operations: [
            createNode('.', 'Foreign', 'Button'),
            {
              kind: 'resource_assign',
              path: 'Foreign',
              property: 'theme',
              ref: { bind: 'badStyle', mutateField: 'sessionId', mutateValue: foreignSession },
              policy: 'shared',
            },
          ],
        },
        expectCode: 'FORBIDDEN',
      },
    ],
    positive: [
      {
        tool: 'manage_editor_resource',
        args: {
          request: { action: 'create', resourceType: 'StyleBoxFlat', properties: { bg_color: color(0.25, 0.5, 0.25) } },
        },
        bind: 'style',
        bindFrom: 'ref',
      },
      {
        tool: 'manage_editor_resource',
        args: {
          request: {
            action: 'theme',
            items: [
              {
                kind: 'stylebox',
                themeType: 'Button',
                name: 'normal',
                ref: { bind: 'style' },
                policy: 'make_unique',
              },
            ],
          },
        },
        bind: 'theme',
        bindFrom: 'ref',
      },
      {
        tool: 'manage_editor_resource',
        args: { request: { action: 'read', ref: { bind: 'style' } } },
        equals: { path: 'properties.bg_color', value: color(0.25, 0.5, 0.25) },
      },
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'U05-positive',
          operations: [
            createNode('.', 'UniqueButton', 'Button'),
            {
              kind: 'resource_assign',
              path: 'UniqueButton',
              property: 'theme',
              ref: { bind: 'theme' },
              policy: 'make_unique',
            },
          ],
        },
      },
    ],
    undo: true,
    expectedPaths: ['UniqueButton'],
    absentPaths: ['Foreign'],
    savedFragments: ['type="StyleBoxFlat"', 'name="UniqueButton"'],
  },
  {
    id: 'U06',
    family: 'ui',
    scopes,
    scene: uiScene,
    denial: {
      tool: 'apply_editor_scene',
      args: { operations: [createNode('.', 'Apply', 'Button')] },
    },
    negative: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'U06-negative',
          operations: [createNode('.', 'Bad', 'Button'), uiSet('Bad', { button_pressed: true })],
        },
        expectCode: 'CONFLICT',
      },
    ],
    positive: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'U06-positive',
          operations: [
            createNode('.', 'Panel', 'PanelContainer'),
            uiSet('Panel', { custom_minimum_size: vector2(220, 96) }),
            createNode('.', 'Apply', 'Button'),
            uiSet('Apply', { text: 'Go', custom_minimum_size: vector2(120, 40) }),
            { kind: 'connect', path: 'Apply', signal: 'pressed', target: 'Panel', method: 'hide' },
          ],
        },
      },
    ],
    undo: true,
    expectedPaths: ['Panel', 'Apply'],
    absentPaths: ['Bad'],
    savedFragments: ['signal="pressed"', 'method="hide"', 'text = "Go"'],
    runtime: [
      {
        tool: 'open_runtime_bridge',
        args: {
          headless: false,
          evidenceDir: { rootRelative: '.harness/u06-evidence' },
          bridgePath: { repoFile: 'godot-plugin/runtime_bridge.gd' },
        },
        bind: 'session',
        bindFrom: 'session_id',
      },
      {
        tool: 'call_runtime_bridge',
        args: {
          sessionId: { bind: 'session' },
          method: 'get_property',
          params: { nodePath: 'Panel', property: 'visible' },
        },
        equals: { path: 'response.value', value: true },
      },
      {
        tool: 'call_runtime_bridge',
        args: {
          sessionId: { bind: 'session' },
          method: 'capture_screenshot',
          params: { path: { rootRelative: '.harness/u06-evidence/baseline.png' } },
        },
      },
      {
        action: 'hashFile',
        args: { path: { rootRelative: '.harness/u06-evidence/baseline.png' } },
        bind: 'baselineHash',
      },
      {
        tool: 'call_runtime_bridge',
        args: {
          sessionId: { bind: 'session' },
          method: 'call_method',
          params: { nodePath: 'Apply', method: 'grab_focus', args: [] },
        },
      },
      {
        tool: 'call_runtime_bridge',
        args: {
          sessionId: { bind: 'session' },
          method: 'inject_input',
          params: { keycode: 4194309, pressed: true },
        },
      },
      {
        tool: 'call_runtime_bridge',
        args: {
          sessionId: { bind: 'session' },
          method: 'inject_input',
          params: { keycode: 4194309, pressed: false },
        },
      },
      {
        tool: 'call_runtime_bridge',
        args: { sessionId: { bind: 'session' }, method: 'wait_physics_frames', params: { frames: 2 } },
      },
      {
        tool: 'call_runtime_bridge',
        args: {
          sessionId: { bind: 'session' },
          method: 'get_property',
          params: { nodePath: 'Panel', property: 'visible' },
        },
        equals: { path: 'response.value', value: false },
      },
      {
        tool: 'call_runtime_bridge',
        args: {
          sessionId: { bind: 'session' },
          method: 'capture_screenshot',
          params: { path: { rootRelative: '.harness/u06-evidence/after.png' } },
        },
      },
      {
        action: 'comparePng',
        args: {
          first: { rootRelative: '.harness/u06-evidence/baseline.png' },
          second: { rootRelative: '.harness/u06-evidence/after.png' },
          minDifferentPixels: 100,
          stableBind: 'baselineHash',
        },
      },
      { tool: 'stop_runtime_bridge', args: { sessionId: { bind: 'session' } } },
    ],
  },
];
export function uiProductionCases(): ExtendedProductionCase[] {
  return uiDefinitions.map((definition) => extendedProductionCaseSchema.parse(structuredClone(definition)));
}
const node3dScene = '[gd_scene format=3]\n[node name="Main" type="Node3D"]\n';
const vector3 = (x: number, y: number, z: number) => ({ type: 'Vector3', x, y, z });
const physicsSet = (nodePath: string, properties: Record<string, unknown>) => ({
  kind: 'physics_set',
  path: nodePath,
  properties,
});
const bridgeOpen = (directory: string) => ({
  tool: 'open_runtime_bridge',
  args: {
    headless: true,
    evidenceDir: { rootRelative: directory },
    bridgePath: { repoFile: 'godot-plugin/runtime_bridge.gd' },
  },
  bind: 'session',
  bindFrom: 'session_id',
});
const physicsRig = [
  createNode('.', 'Rig', 'Node3D'),
  createNode('Rig', 'Slab', 'StaticBody3D'),
  physicsSet('Rig/Slab', { collision_layer: 4, collision_mask: 2 }),
  createNode('Rig/Slab', 'Shape', 'CollisionShape3D'),
  { kind: 'resource_assign', path: 'Rig/Slab/Shape', property: 'shape', ref: { bind: 'shape' }, policy: 'shared' },
  createNode('Rig', 'Ray', 'RayCast3D'),
  { kind: 'set', path: 'Rig/Ray', property: 'position', value: vector3(0, 2, 0) },
  physicsSet('Rig/Ray', {
    target_position: vector3(0, -4, 0),
    collision_mask: 4,
    enabled: true,
    collide_with_areas: false,
    collide_with_bodies: true,
  }),
];
const physicsDefinitions = [
  {
    id: 'P01',
    family: 'physics',
    scopes,
    scene: node3dScene,
    denial: {
      tool: 'apply_editor_scene',
      args: {
        operations: [
          createNode('.', 'Rig', 'Node3D'),
          { kind: 'set', path: 'Rig', property: 'position', value: vector3(1, 2, 3) },
        ],
      },
    },
    negative: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'P01-negative',
          operations: [
            createNode('.', 'Bad', 'Node3D'),
            { kind: 'set', path: 'Bad', property: 'position', value: true },
          ],
        },
        expectCode: 'INVALID_ARGUMENT',
      },
    ],
    positive: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'P01-positive',
          operations: [
            createNode('.', 'Rig', 'Node3D'),
            { kind: 'set', path: 'Rig', property: 'position', value: vector3(1, 2, 3) },
            { kind: 'set', path: 'Rig', property: 'rotation', value: vector3(0, 0, 0) },
            { kind: 'set', path: 'Rig', property: 'scale', value: vector3(2, 2, 2) },
          ],
        },
      },
    ],
    undo: true,
    expectedPaths: ['Rig'],
    absentPaths: ['Bad'],
    savedFragments: ['name="Rig"', 'Transform3D(2, 0, 0, 0, 2, 0, 0, 0, 2, 1, 2, 3)'],
    runtime: [
      bridgeOpen('.harness/p01-evidence'),
      {
        tool: 'call_runtime_bridge',
        args: {
          sessionId: { bind: 'session' },
          method: 'get_property',
          params: { nodePath: 'Rig', property: 'position' },
        },
        equals: { path: 'response.value', value: vector3(1, 2, 3) },
      },
      { tool: 'stop_runtime_bridge', args: { sessionId: { bind: 'session' } } },
    ],
  },
  {
    id: 'P02',
    family: 'physics',
    scopes,
    scene: node3dScene,
    denial: {
      tool: 'manage_editor_resource',
      args: { request: { action: 'create', resourceType: 'BoxMesh', properties: { size: vector3(1, 1, 1) } } },
    },
    negative: [
      {
        tool: 'manage_editor_resource',
        args: { request: { action: 'create', resourceType: 'BoxMesh', properties: { size: vector3(1, 1, 1) } } },
        bind: 'mesh',
        bindFrom: 'ref',
      },
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'P02-negative',
          operations: [
            createNode('.', 'Wrong', 'CollisionShape3D'),
            { kind: 'resource_assign', path: 'Wrong', property: 'shape', ref: { bind: 'mesh' }, policy: 'shared' },
          ],
        },
        expectCode: 'INVALID_ARGUMENT',
      },
    ],
    positive: [
      {
        tool: 'manage_editor_resource',
        args: { request: { action: 'create', resourceType: 'BoxMesh', properties: { size: vector3(1, 2, 3) } } },
        bind: 'mesh',
        bindFrom: 'ref',
      },
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'P02-positive',
          operations: [
            createNode('.', 'Body', 'MeshInstance3D'),
            { kind: 'resource_assign', path: 'Body', property: 'mesh', ref: { bind: 'mesh' }, policy: 'make_unique' },
          ],
        },
      },
    ],
    undo: true,
    expectedPaths: ['Body'],
    absentPaths: ['Wrong'],
    savedFragments: ['type="BoxMesh"', 'name="Body"'],
  },
  {
    id: 'P03',
    family: 'physics',
    scopes,
    scene: node3dScene,
    denial: { tool: 'apply_editor_scene', args: { operations: [createNode('.', 'Rig', 'Node3D')] } },
    negative: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'P03-negative',
          operations: [createNode('.', 'Bad', 'StaticBody3D'), physicsSet('Bad', { collision_mask: -1 })],
        },
        expectInvalidParams: true,
      },
    ],
    positive: [
      {
        tool: 'manage_editor_resource',
        args: { request: { action: 'create', resourceType: 'BoxShape3D', properties: { size: vector3(2, 0.5, 2) } } },
        bind: 'shape',
        bindFrom: 'ref',
      },
      { tool: 'apply_editor_scene', args: { operationId: 'P03-positive', operations: physicsRig } },
    ],
    undo: true,
    expectedPaths: ['Rig/Slab', 'Rig/Slab/Shape', 'Rig/Ray'],
    absentPaths: ['Bad'],
    savedFragments: ['type="BoxShape3D"', 'type="RayCast3D"', 'collision_layer = 4', 'collision_mask = 4'],
    runtime: [
      bridgeOpen('.harness/p03-evidence'),
      {
        tool: 'call_runtime_bridge',
        args: { sessionId: { bind: 'session' }, method: 'wait_physics_frames', params: { frames: 4 } },
      },
      {
        tool: 'query_runtime_collisions',
        args: { sessionId: { bind: 'session' }, nodePath: 'Rig/Ray', refresh: true },
        equals: { path: 'response.overlaps.0.name', value: 'Slab' },
      },
      { tool: 'stop_runtime_bridge', args: { sessionId: { bind: 'session' } } },
    ],
  },
  {
    id: 'P04',
    family: 'physics',
    scopes,
    scene: node3dScene,
    denial: { tool: 'apply_editor_scene', args: { operations: [createNode('.', 'Rig', 'Node3D')] } },
    negative: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'P04-negative',
          operations: [createNode('.', 'Bad', 'RayCast3D'), physicsSet('Bad', { collision_mask: -1 })],
        },
        expectInvalidParams: true,
      },
    ],
    positive: [
      {
        tool: 'manage_editor_resource',
        args: { request: { action: 'create', resourceType: 'BoxShape3D', properties: { size: vector3(2, 0.5, 2) } } },
        bind: 'shape',
        bindFrom: 'ref',
      },
      { tool: 'apply_editor_scene', args: { operationId: 'P04-positive', operations: physicsRig } },
    ],
    undo: true,
    expectedPaths: ['Rig/Ray'],
    absentPaths: ['Bad'],
    savedFragments: ['type="RayCast3D"', 'target_position = Vector3(0, -4, 0)'],
    runtime: [
      bridgeOpen('.harness/p04-evidence'),
      {
        tool: 'call_runtime_bridge',
        args: { sessionId: { bind: 'session' }, method: 'wait_physics_frames', params: { frames: 4 } },
      },
      {
        tool: 'query_runtime_collisions',
        args: { sessionId: { bind: 'session' }, nodePath: 'Rig/Ray', refresh: true },
        bind: 'sample',
        bindFrom: 'response.overlaps',
      },
      {
        tool: 'query_runtime_collisions',
        args: { sessionId: { bind: 'session' }, nodePath: 'Rig/Ray', refresh: false },
        equals: { path: 'response.cached', value: true },
      },
      {
        tool: 'query_runtime_collisions',
        args: { sessionId: { bind: 'session' }, nodePath: 'Rig/Ray', refresh: false, collisionMask: 2 },
        expectCode: 'CONFLICT',
      },
      {
        tool: 'query_runtime_collisions',
        args: { sessionId: { bind: 'session' }, nodePath: 'Rig/Ray', refresh: false },
        equals: { path: 'response.overlaps.0.name', value: 'Slab' },
      },
      { tool: 'stop_runtime_bridge', args: { sessionId: { bind: 'session' } } },
    ],
  },
  {
    id: 'P05',
    family: 'physics',
    scopes,
    scene: node3dScene,
    denial: { tool: 'apply_editor_scene', args: { operations: [createNode('.', 'Area', 'Area3D')] } },
    negative: [
      {
        tool: 'apply_editor_scene',
        args: { operationId: 'P05-negative', operations: [createNode('.', 'Cast', 'ShapeCast3D')] },
        expectInvalidParams: true,
      },
    ],
    positive: [
      {
        tool: 'manage_editor_resource',
        args: { request: { action: 'create', resourceType: 'BoxShape3D', properties: { size: vector3(2, 0.5, 2) } } },
        bind: 'shape',
        bindFrom: 'ref',
      },
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'P05-positive',
          operations: [
            createNode('.', 'Rig', 'Node3D'),
            createNode('Rig', 'Slab', 'StaticBody3D'),
            physicsSet('Rig/Slab', { collision_layer: 1, collision_mask: 1 }),
            createNode('Rig/Slab', 'Shape', 'CollisionShape3D'),
            {
              kind: 'resource_assign',
              path: 'Rig/Slab/Shape',
              property: 'shape',
              ref: { bind: 'shape' },
              policy: 'shared',
            },
            createNode('Rig', 'Sensor', 'Area3D'),
            physicsSet('Rig/Sensor', { collision_layer: 2, collision_mask: 1, monitoring: true, monitorable: true }),
            createNode('Rig/Sensor', 'Shape', 'CollisionShape3D'),
            {
              kind: 'resource_assign',
              path: 'Rig/Sensor/Shape',
              property: 'shape',
              ref: { bind: 'shape' },
              policy: 'make_unique',
            },
          ],
        },
      },
    ],
    undo: true,
    expectedPaths: ['Rig/Sensor', 'Rig/Slab'],
    absentPaths: ['Cast'],
    savedFragments: ['type="Area3D"', 'collision_layer = 2'],
    runtime: [
      bridgeOpen('.harness/p05-evidence'),
      {
        tool: 'call_runtime_bridge',
        args: { sessionId: { bind: 'session' }, method: 'wait_physics_frames', params: { frames: 4 } },
      },
      {
        tool: 'query_runtime_collisions',
        args: {
          sessionId: { bind: 'session' },
          nodePath: 'Rig/Sensor',
          queryMode: 'intersect_shape',
          refresh: true,
          maxResults: 4,
        },
        equals: { path: 'response.overlaps.0.name', value: 'Slab' },
      },
      {
        tool: 'query_runtime_collisions',
        args: { sessionId: { bind: 'session' }, nodePath: 'Rig/Sensor', historyLimit: 257 },
        expectInvalidParams: true,
      },
      {
        tool: 'query_runtime_collisions',
        args: {
          sessionId: { bind: 'session' },
          nodePath: 'Rig/Sensor',
          queryMode: 'intersect_shape',
          refresh: false,
          maxResults: 4,
        },
        equals: { path: 'response.overlaps.0.name', value: 'Slab' },
      },
      { tool: 'stop_runtime_bridge', args: { sessionId: { bind: 'session' } } },
    ],
  },
  {
    id: 'P06',
    family: 'physics',
    scopes,
    scene: node3dScene,
    denial: {
      tool: 'apply_editor_scene',
      args: { operations: [createNode('.', 'Marker', 'Marker3D')] },
    },
    negative: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'P06-negative',
          operations: [
            createNode('.', 'Bad', 'Node3D'),
            { kind: 'set', path: 'Bad', property: 'position', value: true },
          ],
        },
        expectCode: 'INVALID_ARGUMENT',
      },
    ],
    positive: [
      {
        tool: 'apply_editor_scene',
        args: { operationId: 'P06-positive', operations: [createNode('.', 'Marker', 'Marker3D')] },
      },
    ],
    undo: true,
    expectedPaths: ['Marker'],
    absentPaths: ['Bad'],
    savedFragments: ['type="Marker3D"'],
    runtime: [
      bridgeOpen('.harness/p06-evidence'),
      {
        tool: 'call_runtime_bridge',
        args: {
          sessionId: { bind: 'session' },
          method: 'inject_input',
          params: { keycode: 4194309, pressed: true },
        },
      },
      {
        tool: 'call_runtime_bridge',
        args: { sessionId: { bind: 'session' }, method: 'wait_physics_frames', params: { frames: 2 } },
      },
      {
        tool: 'wait_for_event',
        args: { sessionId: { bind: 'session' }, event: 'input_injected', includeHistory: true, timeoutMs: 5000 },
      },
      {
        tool: 'wait_for_event',
        args: { sessionId: { bind: 'session' }, event: 'input_injected', timeoutMs: 300 },
        expectCode: 'TIMEOUT',
      },
      {
        tool: 'call_runtime_bridge',
        args: {
          sessionId: { bind: 'session' },
          method: 'inject_input',
          params: { keycode: 4194309, pressed: false },
        },
      },
      {
        tool: 'stop_runtime_bridge',
        args: { sessionId: { bind: 'session' } },
        equals: { path: 'forced', value: false },
      },
    ],
  },
];
export function physicsProductionCases(): ExtendedProductionCase[] {
  return physicsDefinitions.map((definition) => extendedProductionCaseSchema.parse(structuredClone(definition)));
}
const node2dScene = '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n';
const positionKeys = (points: Array<[number, number, number]>) =>
  points.map(([time, x, y]) => ({ time, value: { x, y } }));
const idleClip = (target: string) => ({
  id: 'idle',
  length: 1,
  loop: true,
  tracks: [{ id: 'position', target, property: 'position', keys: positionKeys([[0, 0, 0]]) }],
});
const tint = { type: 'Color', r: 0.25, g: 0.5, b: 0.75, a: 1 };
const tintShader =
  'shader_type spatial;\nrender_mode unshaded;\nuniform vec4 tint : source_color = vec4(1.0);\nvoid fragment() { ALBEDO = tint.rgb; }';
const visualShader = {
  format: 'visual',
  nodes: [
    { id: 2, kind: 'color', color: { type: 'Color', r: 1, g: 0, b: 0, a: 1 } },
    { id: 3, kind: 'color', color: { type: 'Color', r: 0, g: 0, b: 1, a: 1 } },
    { id: 4, kind: 'mix' },
  ],
  edges: [
    { from: 2, fromPort: 0, to: 4, toPort: 0 },
    { from: 3, fromPort: 0, to: 4, toPort: 1 },
    { from: 4, fromPort: 0, to: 0, toPort: 0 },
  ],
};
const animationDefinitions = [
  {
    id: 'A01',
    family: 'animation',
    scopes,
    scene: node2dScene,
    denial: { tool: 'apply_editor_scene', args: { operations: [createNode('.', 'Hero', 'Node2D')] } },
    negative: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'A01-negative',
          operations: [
            createNode('.', 'Hero', 'Node2D'),
            createNode('.', 'Animator', 'AnimationPlayer'),
            { kind: 'animation_clips', path: 'Animator', clips: [idleClip('Missing')] },
          ],
        },
        expectCode: 'NOT_FOUND',
      },
    ],
    positive: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'A01-positive',
          operations: [
            createNode('.', 'Hero', 'Node2D'),
            createNode('.', 'Animator', 'AnimationPlayer'),
            {
              kind: 'animation_clips',
              path: 'Animator',
              clips: [
                {
                  id: 'idle',
                  length: 1,
                  loop: true,
                  tracks: [
                    {
                      id: 'position',
                      target: 'Hero',
                      property: 'position',
                      keys: positionKeys([
                        [0, 0, 0],
                        [1, 40, 0],
                      ]),
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
    undo: true,
    expectedPaths: ['Hero', 'Animator'],
    absentPaths: ['Missing'],
    savedFragments: ['NodePath("Hero:position")', '&"idle"', 'libraries/wheel'],
  },
  {
    id: 'A02',
    family: 'animation',
    scopes,
    scene: node2dScene,
    denial: { tool: 'apply_editor_scene', args: { operations: [createNode('.', 'Animator', 'AnimationPlayer')] } },
    negative: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'A02-negative',
          operations: [
            createNode('.', 'Animator', 'AnimationPlayer'),
            { kind: 'animation_clips', path: 'Animator', clips: [idleClip('Missing')] },
          ],
        },
        expectCode: 'NOT_FOUND',
      },
    ],
    positive: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'A02-positive',
          operations: [
            createNode('.', 'Hero', 'Node2D'),
            createNode('.', 'Animator', 'AnimationPlayer'),
            { kind: 'animation_clips', path: 'Animator', clips: [idleClip('Hero')] },
          ],
        },
      },
    ],
    undo: true,
    expectedPaths: ['Animator'],
    absentPaths: ['Missing'],
    savedFragments: ['NodePath("Hero:position")'],
    runtime: [
      bridgeOpen('.harness/a02-evidence'),
      {
        tool: 'call_runtime_bridge',
        args: { sessionId: { bind: 'session' }, method: 'do_anything', params: {} },
        expectMatch: 'Invalid enum value',
      },
      {
        tool: 'call_runtime_method',
        args: { sessionId: { bind: 'session' }, nodePath: 'Animator', method: 'not_a_player_method', args: [] },
        expectCode: 'NOT_FOUND',
      },
      {
        tool: 'call_runtime_method',
        args: { sessionId: { bind: 'session' }, nodePath: 'Animator', method: 'play', args: ['wheel/idle'] },
      },
      {
        tool: 'get_specialized_state',
        args: { sessionId: { bind: 'session' }, nodePath: 'Animator' },
        equals: { path: 'response.state.animation.playing', value: true },
      },
      {
        tool: 'call_runtime_method',
        args: { sessionId: { bind: 'session' }, nodePath: 'Animator', method: 'pause', args: [] },
      },
      {
        tool: 'call_runtime_method',
        args: { sessionId: { bind: 'session' }, nodePath: 'Animator', method: 'seek', args: [0.25, true] },
      },
      {
        tool: 'get_specialized_state',
        args: { sessionId: { bind: 'session' }, nodePath: 'Animator' },
        approx: { path: 'response.state.animation.position', value: 0.25, tolerance: 0.02 },
      },
      { tool: 'stop_runtime_bridge', args: { sessionId: { bind: 'session' } } },
    ],
  },
  {
    id: 'A03',
    family: 'animation',
    scopes,
    scene: node2dScene,
    restartAfterNegative: true,
    denial: { tool: 'apply_editor_scene', args: { operations: [createNode('.', 'Other', 'Node2D')] } },
    negative: [
      { action: 'fixture', args: { name: 'share-animation' } },
      {
        tool: 'apply_editor_scene',
        args: { operationId: 'A03-negative', operations: [createNode('.', 'Other', 'Node2D')] },
        expectCode: 'CONFLICT',
      },
    ],
    positive: [
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'A03-positive',
          operations: [
            createNode('.', 'Hero', 'Node2D'),
            createNode('.', 'First', 'AnimationPlayer'),
            createNode('.', 'Second', 'AnimationPlayer'),
            { kind: 'animation_clips', path: 'First', clips: [idleClip('Hero')] },
            { kind: 'animation_clips', path: 'Second', clips: [idleClip('Hero')] },
          ],
        },
      },
    ],
    undo: true,
    expectedPaths: ['First', 'Second', 'Hero'],
    absentPaths: ['Other'],
    savedFragments: ['name="First"', 'name="Second"', 'NodePath("Hero:position")'],
  },
  {
    id: 'A04',
    family: 'animation',
    scopes,
    scene: node3dScene,
    denial: {
      tool: 'manage_editor_resource',
      args: {
        request: { action: 'create', resourceType: 'StandardMaterial3D', properties: { roughness: 0.25 } },
      },
    },
    negative: [
      {
        tool: 'manage_editor_resource',
        args: {
          request: { action: 'create', resourceType: 'StandardMaterial3D', properties: { roughness: 1.5 } },
        },
        expectCode: 'INVALID_ARGUMENT',
      },
    ],
    positive: [
      {
        tool: 'manage_editor_resource',
        args: {
          request: {
            action: 'create',
            resourceType: 'StandardMaterial3D',
            properties: { roughness: 0.25, albedo_color: tint },
          },
        },
        bind: 'material',
        bindFrom: 'ref',
      },
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'A04-positive',
          operations: [
            createNode('.', 'Body', 'MeshInstance3D'),
            {
              kind: 'resource_assign',
              path: 'Body',
              property: 'material_override',
              ref: { bind: 'material' },
              policy: 'make_unique',
            },
          ],
        },
      },
    ],
    undo: true,
    expectedPaths: ['Body'],
    absentPaths: ['Bad'],
    savedFragments: ['type="StandardMaterial3D"', 'roughness = 0.25'],
  },
  {
    id: 'A05',
    family: 'animation',
    scopes,
    scene: node3dScene,
    denial: {
      tool: 'manage_editor_resource',
      args: { request: { action: 'shader', source: { format: 'text', code: tintShader, uniforms: { tint } } } },
    },
    negative: [
      {
        tool: 'manage_editor_resource',
        args: {
          request: {
            action: 'shader',
            source: {
              format: 'text',
              code: 'shader_type spatial; void fragment() { ALBEDO = nonexistent; }',
              uniforms: { tint },
            },
          },
        },
        expectCode: 'UNSUPPORTED',
        equals: { path: 'details.diagnostics.0.stage', value: 'shader-preflight' },
      },
    ],
    positive: [
      {
        tool: 'manage_editor_resource',
        args: { request: { action: 'shader', source: { format: 'text', code: tintShader, uniforms: { tint } } } },
        bind: 'shader',
        bindFrom: 'ref',
      },
      {
        tool: 'save_editor_resource',
        args: { ref: { bind: 'shader' }, filePath: 'shader.tres', operationId: 'A05-shader', expectedSha256: null },
      },
      { action: 'fileIncludes', args: { path: { rootRelative: 'shader.tres' }, fragment: 'shader_type spatial' } },
      {
        tool: 'manage_editor_resource',
        args: { request: { action: 'create', resourceType: 'BoxMesh', properties: { size: vector3(1, 1, 1) } } },
        bind: 'mesh',
        bindFrom: 'ref',
      },
      {
        tool: 'apply_editor_scene',
        args: {
          operationId: 'A05-positive',
          operations: [
            createNode('.', 'Body', 'MeshInstance3D'),
            { kind: 'resource_assign', path: 'Body', property: 'mesh', ref: { bind: 'mesh' }, policy: 'make_unique' },
            {
              kind: 'resource_assign',
              path: 'Body',
              property: 'material_override',
              ref: { bind: 'shader' },
              policy: 'make_unique',
            },
          ],
        },
      },
    ],
    undo: true,
    expectedPaths: ['Body'],
    absentPaths: ['Bad'],
    savedFragments: ['type="ShaderMaterial"', 'shader_type spatial'],
  },
  {
    id: 'A06',
    family: 'animation',
    scopes,
    scene: node3dScene,
    denial: {
      tool: 'manage_editor_resource',
      args: { request: { action: 'shader', source: visualShader } },
    },
    negative: [
      {
        tool: 'manage_editor_resource',
        args: {
          request: {
            action: 'shader',
            source: {
              ...visualShader,
              edges: [{ from: 2, fromPort: 1, to: 4, toPort: 0 }, ...visualShader.edges.slice(1)],
            },
          },
        },
        expectCode: 'INVALID_ARGUMENT',
        equals: { path: 'details.diagnostics.0.severity', value: 'error' },
      },
    ],
    positive: [
      {
        tool: 'manage_editor_resource',
        args: { request: { action: 'shader', source: visualShader } },
        bind: 'visual',
        bindFrom: 'ref',
      },
      {
        tool: 'save_editor_resource',
        args: { ref: { bind: 'visual' }, filePath: 'visual.tres', operationId: 'A06-visual', expectedSha256: null },
      },
      { action: 'fileIncludes', args: { path: { rootRelative: 'visual.tres' }, fragment: 'VisualShader' } },
    ],
    undo: false,
    expectedPaths: ['.'],
    absentPaths: ['Bad'],
    savedFragments: ['name="Main"'],
  },
];
export function animationProductionCases(): ExtendedProductionCase[] {
  return animationDefinitions.map((definition) => extendedProductionCaseSchema.parse(structuredClone(definition)));
}

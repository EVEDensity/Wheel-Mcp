import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneOperationsSchema } from '../src/editor/scene-service.js';

test('ScrollContainer creation and the declared modes/follow-focus pass the public schema', () => {
  for (const mode of [0, 1, 2, 3, 4])
    assert.equal(
      sceneOperationsSchema.safeParse([
        { kind: 'create', parent: '.', name: 'Scroll', type: 'ScrollContainer' },
        {
          kind: 'ui_set',
          path: 'Scroll',
          properties: { horizontal_scroll_mode: mode, vertical_scroll_mode: mode, follow_focus: true },
        },
      ]).success,
      true,
    );
});

test('ScrollContainer schema rejects undeclared modes, types and runtime-only scroll offsets', () => {
  for (const properties of [
    { horizontal_scroll_mode: -1 },
    { vertical_scroll_mode: 5 },
    { horizontal_scroll_mode: 1.5 },
    { follow_focus: 1 },
    { scroll_vertical: 20 },
    { scroll_horizontal: 20 },
    { scroll_hint_mode: 1 },
  ])
    assert.equal(sceneOperationsSchema.safeParse([{ kind: 'ui_set', path: 'Scroll', properties }]).success, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneOperationsSchema } from '../src/editor/scene-service.js';

test('LineEdit creation and bounded declared input properties pass the tool schema', () => {
  assert.equal(
    sceneOperationsSchema.safeParse([
      { kind: 'create', parent: '.', name: 'Input', type: 'LineEdit' },
      {
        kind: 'ui_set',
        path: 'Input',
        properties: { text: 'wheel', placeholder_text: 'Your name', editable: true, max_length: 32 },
      },
    ]).success,
    true,
  );
});
test('LineEdit budgets and types cannot bypass the public schema', () => {
  for (const properties of [
    { max_length: -1 },
    { max_length: 513 },
    { max_length: 1.5 },
    { editable: 1 },
    { placeholder_text: 'x'.repeat(513) },
    { secret: true },
  ])
    assert.equal(sceneOperationsSchema.safeParse([{ kind: 'ui_set', path: 'Input', properties }]).success, false);
});

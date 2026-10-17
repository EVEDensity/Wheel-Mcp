import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneOperationsSchema } from '../src/editor/scene-service.js';

test('plain RichTextLabel creation and bounded display fields pass the public schema', () => {
  for (const text of ['', 'Literal [img]res://never-load.png[/img]\nSecond paragraph', 'x'.repeat(512)])
    assert.equal(
      sceneOperationsSchema.safeParse([
        { kind: 'create', parent: '.', name: 'Description', type: 'RichTextLabel' },
        {
          kind: 'ui_set',
          path: 'Description',
          properties: { text, fit_content: true, scroll_active: false, autowrap_mode: 3 },
        },
      ]).success,
      true,
    );
});

test('RichTextLabel schema rejects BBCode, effects, resources, threading and out-of-budget text', () => {
  for (const properties of [
    { text: 'x'.repeat(513) },
    { fit_content: 1 },
    { scroll_active: 'true' },
    { bbcode_enabled: true },
    { bbcode_enabled: false },
    { custom_effects: [] },
    { threaded: true },
    { selection_enabled: true },
    { context_menu_enabled: true },
    { visible_characters: 4 },
    { scroll_following: true },
    { scroll_offset: 20 },
    { autowrap_mode: 4 },
    { texture: 'res://image.png' },
  ])
    assert.equal(sceneOperationsSchema.safeParse([{ kind: 'ui_set', path: 'Description', properties }]).success, false);
});

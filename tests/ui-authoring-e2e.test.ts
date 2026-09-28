import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';
import { compareScreenshots } from '../src/godot-development.js';
import { sceneOperationsSchema } from '../src/editor/scene-service.js';
import { resourceRequestSchema } from '../src/editor/resource-service.js';

const real = { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 180000 };
const controller = `@tool
extends EditorPlugin
const Core = preload("res://addons/wheel_mcp/scene_service.gd")
func _enter_tree() -> void: set_process(true)
func _process(_delta: float) -> void:
\tvar root := EditorInterface.get_edited_scene_root()
\tif root == null or not FileAccess.file_exists("res://.harness/fixture-command.json"): return
\tvar c: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://.harness/fixture-command.json"))
\tDirAccess.remove_absolute(ProjectSettings.globalize_path("res://.harness/fixture-command.json"))
\tvar manager := get_undo_redo()
\tvar history := manager.get_history_undo_redo(manager.get_object_history_id(root))
\tif c.action == "undo": history.undo()
\tif c.action == "redo": history.redo()
\tvar reply := {"id": c.id, "document": Core.document(root)}
\tvar file := FileAccess.open("res://.harness/fixture-result.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify(reply))
\tfile.close()
\tif c.action == "quit": get_tree().call_deferred("quit")
`;
const create = (parent: string, name: string, type: string) => ({ kind: 'create', parent, name, type });
const ui = (nodePath: string, properties: Record<string, unknown>) => ({ kind: 'ui_set', path: nodePath, properties });
const v2 = (x: number, y: number) => ({ type: 'Vector2', x, y });
const color = (r: number, g: number, b: number) => ({ type: 'Color', r, g, b, a: 1 });
const title = 'Deine Einstellungen — Untertitel, Lautstärke und ein Inventar für das nächste große Abenteuer';
const settings = [
  ui('.', { anchor_right: 1, anchor_bottom: 1, grow_horizontal: 2, grow_vertical: 2 }),
  create('.', 'Screen', 'Control'),
  ui('Screen', { anchor_right: 1, anchor_bottom: 1, grow_horizontal: 2, grow_vertical: 2 }),
  create('Screen', 'Frame', 'MarginContainer'),
  ui('Screen/Frame', {
    anchor_right: 1,
    anchor_bottom: 1,
    offset_left: 24,
    offset_top: 24,
    offset_right: -24,
    offset_bottom: -24,
    grow_horizontal: 2,
    grow_vertical: 2,
  }),
  create('Screen/Frame', 'Column', 'VBoxContainer'),
  create('Screen/Frame/Column', 'Heading', 'Label'),
  ui('Screen/Frame/Column/Heading', { text: title, autowrap_mode: 3, custom_minimum_size: v2(0, 70) }),
  create('Screen/Frame/Column', 'Audio', 'HBoxContainer'),
  create('Screen/Frame/Column/Audio', 'Caption', 'Label'),
  ui('Screen/Frame/Column/Audio/Caption', { text: 'Lautstärke', custom_minimum_size: v2(180, 44) }),
  create('Screen/Frame/Column/Audio', 'Volume', 'HSlider'),
  ui('Screen/Frame/Column/Audio/Volume', {
    custom_minimum_size: v2(180, 44),
    size_flags_horizontal: 3,
    min_value: 0,
    max_value: 100,
    step: 1,
    value: 70,
    accessibility_name: 'Audio volume',
  }),
  create('Screen/Frame/Column', 'Subtitles', 'CheckButton'),
  ui('Screen/Frame/Column/Subtitles', {
    text: 'Untertitel aktivieren',
    custom_minimum_size: v2(0, 48),
    accessibility_name: 'Enable subtitles',
  }),
  create('Screen/Frame/Column', 'Apply', 'Button'),
  ui('Screen/Frame/Column/Apply', {
    text: 'Einstellungen speichern',
    custom_minimum_size: v2(0, 48),
    accessibility_name: 'Save settings',
    focus_mode: 2,
  }),
  create('Screen/Frame/Column', 'Inventory', 'PanelContainer'),
  create('Screen/Frame/Column/Inventory', 'Grid', 'GridContainer'),
  ui('Screen/Frame/Column/Inventory/Grid', { columns: 3 }),
];
const base = 'Screen/Frame/Column';
function authoredDocument(doc: any) {
  const paths = new Map(doc.nodes.map((n: any) => [n.id, n.path]));
  return doc.nodes.map((n: any) => ({
    path: n.path,
    name: n.name,
    type: n.type,
    owner: paths.get(n.owner) ?? null,
    layoutOwner: n.layoutOwner,
    properties: Object.fromEntries(
      Object.entries(n.properties).map(([key, value]: [string, any]) => [
        key,
        value?.resourceType
          ? { resourceType: value.resourceType, properties: value.properties, storage: value.storage }
          : value,
      ]),
    ),
    signals: n.signals.map((s: any) => ({ ...s, target: paths.get(s.target) })),
  }));
}

test(
  'official MCP native settings/inventory UI: exact preview, undo, theme, save-reopen, real button input and three localized viewports',
  real,
  async () => {
    let f = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      writeEnabled: true,
      scene: '[gd_scene format=3]\n[node name="Main" type="Control"]\n',
    });
    let c = await wireEditor(f.root);
    let sessionId = '';
    const directory = path.resolve('runs/production-roadmap/T17', new Date().toISOString().replace(/[:.]/g, '-'));
    await mkdir(directory, { recursive: true });
    const calls: unknown[] = [];
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const reply = await c.call(name, args);
      calls.push({ name, args, reply });
      assert.notEqual(reply.isError, true, JSON.stringify(reply));
      return reply.structuredContent as any;
    };
    const rpc = async (method: string, params: Record<string, unknown>) =>
      (await call('call_runtime_bridge', { sessionId, method, params })).response;
    try {
      const original = (await f.command('inspect')).document;
      const made = await call('apply_editor_scene', { operations: settings });
      assert.equal(made.undoSteps, 1);
      assert.deepEqual((await f.command('undo')).document, original);
      await f.command('redo');
      const items = ['Werkzeug', 'Kristall', 'Karte', 'Schlüssel', 'Trank', 'Kompass'].flatMap((text, index) => [
        create(`${base}/Inventory/Grid`, `Slot${index}`, 'Button'),
        ui(`${base}/Inventory/Grid/Slot${index}`, { text, custom_minimum_size: v2(0, 52), size_flags_horizontal: 3 }),
      ]);
      await call('apply_editor_scene', { operations: items });
      const style = (
        await call('manage_editor_resource', {
          request: {
            action: 'create',
            resourceType: 'StyleBoxFlat',
            properties: {
              bg_color: color(0.0625, 0.125, 0.25),
              content_margin_left: 12,
              content_margin_right: 12,
              corner_radius_top_left: 6,
              corner_radius_top_right: 6,
            },
          },
        })
      ).ref;
      const theme = (
        await call('manage_editor_resource', {
          request: {
            action: 'theme',
            items: [
              { kind: 'font_size', themeType: 'Label', name: 'font_size', value: 18 },
              { kind: 'font_size', themeType: 'Button', name: 'font_size', value: 18 },
              { kind: 'color', themeType: 'Label', name: 'font_color', value: color(0.875, 0.9375, 1) },
              { kind: 'color', themeType: 'Button', name: 'font_color', value: color(0.875, 0.9375, 1) },
              { kind: 'constant', themeType: 'VBoxContainer', name: 'separation', value: 12 },
              { kind: 'constant', themeType: 'GridContainer', name: 'h_separation', value: 12 },
              { kind: 'constant', themeType: 'GridContainer', name: 'v_separation', value: 12 },
              { kind: 'stylebox', themeType: 'Button', name: 'normal', ref: style, policy: 'make_unique' },
            ],
          },
        })
      ).ref;
      const beforeTheme = (await f.command('inspect')).document;
      await call('apply_editor_scene', {
        operations: [
          { kind: 'resource_assign', path: 'Screen', property: 'theme', ref: theme, policy: 'shared' },
          { kind: 'connect', path: `${base}/Apply`, signal: 'pressed', target: `${base}/Inventory`, method: 'hide' },
        ],
      });
      const beforeRefusal = (await f.command('inspect')).document;
      assert.deepEqual(
        (await f.command('undo')).document,
        beforeTheme,
        'Theme and persistent signal are one native undo action',
      );
      assert.deepEqual((await f.command('redo')).document, beforeRefusal);
      const refused = await c.call('apply_editor_scene', { operations: [ui(`${base}/Apply`, { offset_left: 100 })] });
      assert.equal((refused.structuredContent as any).code, 'CONFLICT', 'Container owns child offsets');
      assert.deepEqual((await f.command('inspect')).document, beforeRefusal);
      assert.equal((await call('save_editor_scene')).validation, 'PASS');
      const bytes = await readFile(path.join(f.root, 'main.tscn'), 'utf8');
      assert.match(bytes, /signal="pressed"/);
      assert.match(bytes, /accessibility_name = "Save settings"/);
      assert.match(bytes, /type="Theme"/);
      const root = f.root;
      await f.command('quit');
      await f.exited;
      await c.close();
      f = await startEditorFixture(process.env.GODOT_PATH!, { existingRoot: root, controller, writeEnabled: true });
      c = await wireEditor(root);
      const reopened = (await f.command('inspect')).document;
      assert.deepEqual(
        authoredDocument(reopened),
        authoredDocument(beforeRefusal),
        'All authored UI/storage, owners and signals must persist, not just node counts',
      );
      await f.command('quit');
      await f.exited;
      for (const [width, height] of [
        [800, 600],
        [1280, 720],
        [1600, 900],
      ]) {
        // TEST-ONLY fixture rendering configuration, not an implicit user-project write.
        await writeFile(
          path.join(root, 'project.godot'),
          f.project +
            `\n[display]\nwindow/size/viewport_width=${width}\nwindow/size/viewport_height=${height}\n[rendering]\nenvironment/defaults/default_clear_color=Color(0.025, 0.05, 0.09, 1)\n`,
        );
        const evidenceDir = path.join(root, '.harness', `ui-${width}x${height}`);
        sessionId = (
          await call('open_runtime_bridge', {
            headless: false,
            evidenceDir,
            bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
          })
        ).session_id;
        const boxes: Record<string, any> = {};
        for (const nodePath of [
          `${base}/Heading`,
          `${base}/Audio`,
          `${base}/Subtitles`,
          `${base}/Apply`,
          `${base}/Inventory`,
          ...Array.from({ length: 6 }, (_, i) => `${base}/Inventory/Grid/Slot${i}`),
        ]) {
          // Rect2 is outside the current Variant codec. Read actual native
          // global_position/size and require identity transforms for these bounds.
          const position = (await rpc('get_property', { nodePath, property: 'global_position' })).value;
          const size = (await rpc('get_property', { nodePath, property: 'size' })).value;
          assert.equal(position.type, 'Vector2');
          assert.equal(size.type, 'Vector2');
          assert.equal((await rpc('get_property', { nodePath, property: 'rotation' })).value, 0);
          assert.deepEqual((await rpc('get_property', { nodePath, property: 'scale' })).value, v2(1, 1));
          const rect = { position, size };
          assert.ok(rect.size.x > 0 && rect.size.y > 0, JSON.stringify({ nodePath, rect }));
          assert.ok(rect.position.x >= 23 && rect.position.y >= 23);
          assert.ok(
            rect.position.x + rect.size.x <= width - 23 && rect.position.y + rect.size.y <= height - 23,
            JSON.stringify({ nodePath, rect, width, height }),
          );
          boxes[nodePath] = rect;
        }
        assert.equal(
          boxes[`${base}/Heading`].size.x,
          width - 48,
          'Authored full-width anchors must respond to viewport size, not just avoid clipping',
        );
        const png = path.join(evidenceDir, 'settings.png');
        await rpc('capture_screenshot', { path: png });
        const image = await compareScreenshots(png, png, { threshold: 0 });
        assert.equal(image.width, width);
        assert.equal(image.height, height);
        assert.equal(
          (await rpc('get_property', { nodePath: `${base}/Apply`, property: 'accessibility_name' })).value,
          'Save settings',
        );
        await rpc('call_method', { nodePath: `${base}/Apply`, method: 'grab_focus', args: [] });
        await rpc('inject_input', { keycode: 4194309, pressed: true });
        await rpc('inject_input', { keycode: 4194309, pressed: false });
        await rpc('wait_physics_frames', { frames: 2 });
        assert.equal(
          (await rpc('get_property', { nodePath: `${base}/Inventory`, property: 'visible' })).value,
          false,
          'Real GUI button input must invoke persisted signal',
        );
        const hidden = path.join(evidenceDir, 'hidden.png');
        await rpc('capture_screenshot', { path: hidden });
        assert.ok((await compareScreenshots(png, hidden, { threshold: 0 })).differentPixels > 1000);
        await writeFile(
          path.join(directory, `${width}x${height}.json`),
          JSON.stringify(
            {
              status: 'PASS',
              width,
              height,
              boxes,
              geometrySource: 'Actual native global_position/size with verified zero rotation and unit scale',
              png,
              hidden,
              font: 'Godot 4.7.2 bundled default Latin font; German localized long text',
              rendering: 'native rendered runtime',
            },
            null,
            2,
          ),
        );
        await call('stop_runtime_bridge', { sessionId });
        sessionId = '';
        assert.doesNotMatch(
          await readFile(path.join(evidenceDir, 'godot.log'), 'utf8'),
          /SCRIPT ERROR|\bERROR:|ObjectDB instances leaked|resources still in use/,
        );
      }
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
      await writeFile(path.join(directory, 'calls.json'), JSON.stringify(calls, null, 2));
    } catch (error) {
      await writeFile(
        path.join(directory, 'failure.json'),
        JSON.stringify({ message: (error as Error).message, calls }, null, 2),
      );
      throw error;
    } finally {
      if (sessionId) await c.call('stop_runtime_bridge', { sessionId }).catch(() => {});
      await c.close();
      await f.stop();
    }
  },
);

test('UI schema rejects undeclared setters and nonfinite/range-invalid layout values', () => {
  for (const properties of [
    { script: 'res://bad.gd' },
    { offset_left: Infinity },
    { columns: 0 },
    { custom_minimum_size: v2(-1, 2) },
    { text: 'x'.repeat(513) },
  ])
    assert.equal(sceneOperationsSchema.safeParse([ui('.', properties)]).success, false);
  assert.equal(sceneOperationsSchema.safeParse([ui('.', { anchor_right: 1 })]).success, true);
  assert.equal(
    resourceRequestSchema.safeParse({
      action: 'theme',
      items: [{ kind: 'color', themeType: 'Label', name: 'font_color', value: v2(1, 1) }],
    }).success,
    false,
    'Theme colors must not accept another tagged Variant',
  );
});

test(
  'native UI invalid batch, Node2D anchor ambiguity, Container transforms, unsupported signal and foreign style handle fail without mutation',
  real,
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, { controller, writeEnabled: true });
    const c = await wireEditor(f.root);
    try {
      const original = (await f.command('inspect')).document;
      for (const [operations, code] of [
        [[create('.', 'Panel', 'PanelContainer'), ui('Panel', { text: 'not a label' })], 'UNSUPPORTED'],
        [[create('.', 'Screen', 'Control'), ui('Screen', { anchor_right: 1 })], 'CONFLICT'],
        [
          [
            create('.', 'Column', 'VBoxContainer'),
            create('Column', 'Child', 'Button'),
            { kind: 'set', path: 'Column/Child', property: 'position', value: v2(9, 9) },
          ],
          'CONFLICT',
        ],
        [
          [
            create('.', 'Label', 'Label'),
            { kind: 'connect', path: 'Label', signal: 'pressed', target: 'Marker', method: 'hide' },
          ],
          'UNSUPPORTED',
        ],
      ] as [unknown[], string][]) {
        const r = await c.call('apply_editor_scene', { operations });
        assert.equal(r.isError, true);
        assert.equal((r.structuredContent as any).code, code);
        assert.deepEqual((await f.command('inspect')).document, original);
        assert.deepEqual((await f.command('undo')).document, original, 'Rejected batch leaves no native undo action');
      }
      const style = await c.call('manage_editor_resource', {
        request: { action: 'create', resourceType: 'StyleBoxFlat', properties: {} },
      });
      assert.notEqual(style.isError, true);
      const ref = (style.structuredContent as any).ref;
      const forged = await c.call('manage_editor_resource', {
        request: {
          action: 'theme',
          items: [
            {
              kind: 'stylebox',
              themeType: 'Button',
              name: 'normal',
              policy: 'make_unique',
              ref: { ...ref, ownerId: 'someone-else' },
            },
          ],
        },
      });
      assert.equal((forged.structuredContent as any).code, 'FORBIDDEN');
      const unknown = await c.call('manage_editor_resource', {
        request: {
          action: 'theme',
          items: [{ kind: 'constant', themeType: 'Button', name: 'unknown_slot', value: 10 }],
        },
      });
      assert.equal((unknown.structuredContent as any).code, 'UNSUPPORTED');
      assert.equal(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), f.scene);
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
    } finally {
      await c.close();
      await f.stop();
    }
  },
);

test(
  'native UI save refuses preset default loss; exact external Theme/flat-style export and same-project reopen preserve content',
  real,
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      writeEnabled: true,
      scene: '[gd_scene format=3]\n[node name="Main" type="Control"]\n',
    });
    const c = await wireEditor(f.root);
    let reopened: Awaited<ReturnType<typeof startEditorFixture>> | undefined;
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const r = await c.call(name, args);
        assert.notEqual(r.isError, true, JSON.stringify(r));
        return r.structuredContent as any;
      };
      await call('apply_editor_scene', { operations: [ui('.', { anchor_right: 1, anchor_bottom: 1 })] });
      const original = await readFile(path.join(f.root, 'main.tscn'), 'utf8');
      const refused = await c.call('save_editor_scene');
      assert.equal(
        (refused.structuredContent as any).code,
        'CONFLICT',
        'A preset must not change omitted grow defaults on reopen',
      );
      assert.equal(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), original);
      await call('apply_editor_scene', { operations: [ui('.', { grow_horizontal: 2, grow_vertical: 2 })] });
      const style = (
        await call('manage_editor_resource', {
          request: {
            action: 'create',
            resourceType: 'StyleBoxFlat',
            properties: { bg_color: color(0.125, 0.25, 0.5), content_margin_top: 12 },
          },
        })
      ).ref;
      const savedStyle = await call('save_editor_resource', {
        ref: style,
        filePath: 'flat-style.tres',
        expectedSha256: null,
      });
      assert.equal(savedStyle.validation, 'PASS');
      const theme = (
        await call('manage_editor_resource', {
          request: {
            action: 'theme',
            items: [
              {
                kind: 'stylebox',
                themeType: 'PanelContainer',
                name: 'panel',
                ref: savedStyle.ref,
                policy: 'make_unique',
              },
              { kind: 'color', themeType: 'Label', name: 'font_color', value: color(0.75, 0.875, 1) },
            ],
          },
        })
      ).ref;
      const savedTheme = await call('save_editor_resource', {
        ref: theme,
        filePath: 'ui-theme.tres',
        expectedSha256: null,
      });
      assert.equal(savedTheme.validation, 'PASS');
      const themeBytes = await readFile(path.join(f.root, 'ui-theme.tres'), 'utf8');
      assert.match(themeBytes, /Label\/colors\/font_color = Color\(0.75, 0.875, 1, 1\)/);
      assert.match(themeBytes, /bg_color = Color\(0.125, 0.25, 0.5, 1\)/);
      await call('apply_editor_scene', {
        operations: [{ kind: 'resource_assign', path: '.', property: 'theme', ref: savedTheme.ref, policy: 'shared' }],
      });
      const authored = (await f.command('inspect')).document;
      await call('save_editor_scene', {});
      await f.command('quit');
      await f.exited;
      reopened = await startEditorFixture(process.env.GODOT_PATH!, {
        existingRoot: f.root,
        controller,
        writeEnabled: true,
      });
      assert.deepEqual(authoredDocument((await reopened.command('inspect')).document), authoredDocument(authored));
      assert.equal(await readFile(path.join(f.root, 'ui-theme.tres'), 'utf8'), themeBytes);
      assert.doesNotMatch(f.output() + reopened.output(), /SCRIPT ERROR|\bERROR:/);
    } finally {
      await c.close();
      await reopened?.stop();
      await f.stop();
    }
  },
);

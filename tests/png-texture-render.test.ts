import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';
import { pixelPng } from './helpers/png-fixture.js';
import { EditorBridge } from '../src/editor/editor-bridge.js';
import { compareScreenshots, readScreenshotPixel } from '../src/godot-development.js';

// Local real renderer evidence, not part of hosted headless qualification.
test(
  'MCP-imported PNG snapshots save native pixels that render red/blue and reversibly flip',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 },
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, {
      writeEnabled: true,
      scene: '[gd_scene format=3]\n[node name="Main" type="Control"]\n',
    });
    const c = await wireEditor(f.root, { transport: 'stdio' }); // MOCK exact-plan approval.
    let sessionId = '';
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await c.call(name, args);
      assert.notEqual(r.isError, true, name + ': ' + JSON.stringify(r));
      return r.structuredContent as Record<string, any>;
    };
    try {
      const png = pixelPng();
      assert.equal(
        (
          await call('import_project_png', {
            path: 'icon.png',
            dataBase64: png.toString('base64'),
            expectedSha256: null,
          })
        ).validation,
        'PASS',
      );
      const texture = await call('manage_editor_resource', {
        request: {
          action: 'png_texture',
          path: 'icon.png',
          sourceHash: createHash('sha256').update(png).digest('hex'),
        },
      });
      const diagnostic = await EditorBridge.connect({ projectPath: f.root, ownerId: texture.ref.ownerId });
      try {
        const state = await diagnostic.snapshot();
        assert.ok(state.filesystem.progress >= 0 && state.filesystem.progress <= 1);
      } finally {
        diagnostic.close();
      }
      await call('apply_editor_scene', {
        operations: [
          { kind: 'create', parent: '.', name: 'Icon', type: 'TextureRect' },
          {
            kind: 'ui_set',
            path: 'Icon',
            properties: {
              offset_left: 24,
              offset_top: 24,
              offset_right: 264,
              offset_bottom: 144,
              expand_mode: 1,
              stretch_mode: 0,
            },
          },
          { kind: 'resource_assign', path: 'Icon', property: 'texture', ref: texture.ref, policy: 'shared' },
        ],
      });
      assert.equal((await call('save_editor_scene')).persisted, true);
      await f.command('quit');
      await f.exited;
      const evidenceDir = path.join(f.root, '.harness/png-render');
      sessionId = (
        await call('open_runtime_bridge', {
          headless: false,
          evidenceDir,
          bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        })
      ).session_id;
      const rpc = async (method: string, params: Record<string, unknown>) =>
        (await call('call_runtime_bridge', { sessionId, method, params })).response;
      const capture = async (name: string) => {
        await rpc('wait_physics_frames', { frames: 3 });
        const file = path.join(evidenceDir, name + '.png');
        await rpc('capture_screenshot', { path: file });
        return file;
      };
      const before = await capture('before');
      const red = await readScreenshotPixel(before, 40, 60),
        blue = await readScreenshotPixel(before, 248, 60);
      assert.ok(red.r > 200 && red.g < 55 && red.b < 55, JSON.stringify(red));
      assert.ok(blue.b > 200 && blue.r < 55 && blue.g < 55, JSON.stringify(blue));
      await rpc('set_property', { nodePath: 'Icon', property: 'flip_h', value: true });
      const flipped = await capture('flipped');
      assert.ok((await compareScreenshots(before, flipped, { threshold: 0 })).differentPixels > 1000);
      await rpc('set_property', { nodePath: 'Icon', property: 'flip_h', value: false });
      assert.equal((await compareScreenshots(before, await capture('restored'), { threshold: 0 })).differentPixels, 0);
      await call('stop_runtime_bridge', { sessionId });
      sessionId = '';
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
    } finally {
      if (sessionId) await c.call('stop_runtime_bridge', { sessionId });
      await c.close();
      await f.stop();
    }
  },
);

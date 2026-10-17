import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';
import { encodePng, compareScreenshots, readScreenshotPixel } from '../src/godot-development.js';

// Native local rendered pixels, not headless CI/GPU matrix certification.
test(
  'MCP-authored saved Sprite2D renders native PNG quadrants with reversible flips, offset and centering',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 },
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, {
      writeEnabled: true,
      scene: '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n',
    });
    const c = await wireEditor(f.root, { transport: 'stdio' }); // MOCK approval, not human UX.
    let sessionId = '';
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await c.call(name, args);
      assert.notEqual(r.isError, true, JSON.stringify(r));
      return r.structuredContent as Record<string, any>;
    };
    const v2 = (x: number, y: number) => ({ type: 'Vector2', x, y });
    try {
      const image = encodePng(2, 2, Buffer.from([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255]));
      await writeFile(path.join(f.root, 'quad.png'), image);
      const ref = await call('manage_editor_resource', {
        request: {
          action: 'png_texture',
          path: 'quad.png',
          sourceHash: createHash('sha256').update(image).digest('hex'),
        },
      });
      await call('apply_editor_scene', {
        operations: [
          { kind: 'create', parent: '.', name: 'Sprite', type: 'Sprite2D' },
          {
            kind: 'sprite_set',
            path: 'Sprite',
            properties: { centered: false, offset: v2(0, 0), flip_h: false, flip_v: false },
          },
          { kind: 'set', path: 'Sprite', property: 'position', value: v2(60, 60) },
          { kind: 'set', path: 'Sprite', property: 'scale', value: v2(80, 80) },
          { kind: 'resource_assign', path: 'Sprite', property: 'texture', ref: ref.ref, policy: 'shared' },
        ],
      });
      assert.equal((await call('save_editor_scene')).persisted, true);
      await f.command('quit');
      await f.exited;
      const evidenceDir = path.join(f.root, '.harness/sprite-render');
      sessionId = (
        await call('open_runtime_bridge', {
          headless: false,
          bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
          evidenceDir,
        })
      ).session_id;
      const rpc = async (method: string, params: Record<string, unknown>) =>
        (await call('call_runtime_bridge', { sessionId, method, params })).response;
      const set = (property: string, value: unknown) => rpc('set_property', { nodePath: 'Sprite', property, value });
      const capture = async (name: string) => {
        await rpc('wait_physics_frames', { frames: 3 });
        const file = path.join(evidenceDir, name + '.png');
        await rpc('capture_screenshot', { path: file });
        return file;
      };
      const before = await capture('before');
      const red = await readScreenshotPixel(before, 80, 80),
        blue = await readScreenshotPixel(before, 200, 80),
        green = await readScreenshotPixel(before, 80, 200);
      assert.ok(red.r > 200 && red.g < 55 && red.b < 55, JSON.stringify(red));
      assert.ok(blue.b > 200 && blue.r < 55 && blue.g < 55, JSON.stringify(blue));
      assert.ok(green.g > 200 && green.r < 55 && green.b < 55, JSON.stringify(green));
      await set('flip_h', true);
      const horizontal = await capture('horizontal');
      const flippedBlue = await readScreenshotPixel(horizontal, 80, 80);
      assert.ok(flippedBlue.b > 200 && flippedBlue.r < 55);
      assert.ok((await compareScreenshots(before, horizontal, { threshold: 0 })).differentPixels > 1000);
      await set('flip_v', true);
      const vertical = await capture('both-flips');
      const white = await readScreenshotPixel(vertical, 80, 80);
      assert.ok(white.r > 200 && white.g > 200 && white.b > 200);
      await set('flip_h', false);
      await set('flip_v', false);
      assert.equal((await compareScreenshots(before, await capture('restored'), { threshold: 0 })).differentPixels, 0);
      for (const [property, changed, restored] of [
        ['offset', v2(1, 0), v2(0, 0)],
        ['centered', true, false],
      ] as const) {
        await set(property, changed);
        assert.ok((await compareScreenshots(before, await capture(property), { threshold: 0 })).differentPixels > 1000);
        await set(property, restored);
        assert.equal(
          (await compareScreenshots(before, await capture(property + '-restored'), { threshold: 0 })).differentPixels,
          0,
        );
      }
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

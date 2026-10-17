import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';
import { compareScreenshots } from '../src/godot-development.js';

// Deliberate local renderer check; not included in headless GitHub qualification.
test(
  'native saved TextureRect renders its gradient, horizontal flip changes PNG pixels and restoring reverses it',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 },
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, {
      writeEnabled: true,
      scene: '[gd_scene format=3]\n[node name="Main" type="Control"]\n',
    });
    const c = await wireEditor(f.root, { transport: 'stdio' }); // Approval is the helper's MOCK host.
    let sessionId = '';
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await c.call(name, args);
      assert.notEqual(r.isError, true, JSON.stringify(r));
      return r.structuredContent as Record<string, any>;
    };
    try {
      const texture = await call('manage_editor_resource', {
        request: {
          action: 'texture',
          source: {
            format: 'linear-gradient',
            width: 16,
            height: 8,
            colors: [
              { type: 'Color', r: 1, g: 0, b: 0, a: 1 },
              { type: 'Color', r: 0, g: 0, b: 1, a: 1 },
            ],
          },
        },
      });
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
              stretch_mode: 5,
            },
          },
          { kind: 'resource_assign', path: 'Icon', property: 'texture', ref: texture.ref, policy: 'shared' },
        ],
      });
      assert.equal((await call('save_editor_scene')).persisted, true);
      await f.command('quit');
      await f.exited;
      const evidenceDir = path.join(f.root, '.harness/texture-render');
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
        const png = path.join(evidenceDir, name + '.png');
        await rpc('capture_screenshot', { path: png });
        return png;
      };
      const before = await capture('before');
      await rpc('set_property', { nodePath: 'Icon', property: 'flip_h', value: true });
      const flipped = await capture('flipped');
      const diff = await compareScreenshots(before, flipped, { threshold: 0 });
      assert.ok(diff.differentPixels > 1000, JSON.stringify(diff));
      await rpc('set_property', { nodePath: 'Icon', property: 'flip_h', value: false });
      const restored = await capture('restored');
      assert.equal((await compareScreenshots(before, restored, { threshold: 0 })).differentPixels, 0);
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

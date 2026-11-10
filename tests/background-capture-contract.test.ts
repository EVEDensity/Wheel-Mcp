import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BridgeRpcError } from '../src/bridge-protocol.js';
import { PersistentRuntimeBridge } from '../src/persistent-runtime-bridge.js';
import { createTimeoutContext } from '../src/timeout.js';
import { readScreenshotPixel } from '../src/godot-development.js';

const godot = process.env.GODOT_PATH ?? '';
async function fixture(renderer = 'gl_compatibility') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-capture-contract-'));
  await writeFile(
    path.join(root, 'project.godot'),
    `[application]\nconfig/name="Capture evidence fixture"\nrun/main_scene="res://main.tscn"\n[display]\nwindow/size/viewport_width=320\nwindow/size/viewport_height=180\n[rendering]\nrenderer/rendering_method="${renderer}"\n`,
  );
  await writeFile(
    path.join(root, 'main.tscn'),
    '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n[node name="Color" type="ColorRect" parent="."]\noffset_right=320.0\noffset_bottom=180.0\ncolor=Color(1,0,0,1)\n',
  );
  return root;
}

test(
  'headless screenshot and missing path retain actionable engine/argument errors',
  { skip: !existsSync(godot), timeout: 30000 },
  async (t) => {
    const root = await fixture();
    const timeout = createTimeoutContext(25000);
    t.after(() => timeout.dispose());
    const bridge = await PersistentRuntimeBridge.start({
      godotPath: godot,
      projectPath: root,
      bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
      evidenceDir: path.join(root, 'evidence'),
      headless: true,
      timeout,
    });
    t.after(async () => {
      await bridge.stop();
    });
    await assert.rejects(
      bridge.request('capture_screenshot', { path: path.join(root, 'evidence', 'headless.png') }, timeout),
      (error: unknown) => error instanceof BridgeRpcError && error.code === 'ENGINE_UNAVAILABLE',
    );
    await assert.rejects(
      bridge.request('capture_screenshot', {}, timeout),
      (error: unknown) => error instanceof BridgeRpcError && error.code === 'INVALID_ARGUMENT',
    );
  },
);

test(
  'background screenshots bind their draw, scene and observed window state without claiming OS isolation',
  { skip: !existsSync(godot) || process.env.WHEEL_TEST_RENDER_CAPTURE !== '1', timeout: 60000 },
  async (t) => {
    const root = await fixture('forward_plus');
    const timeout = createTimeoutContext(50000);
    t.after(() => timeout.dispose());
    const bridge = await PersistentRuntimeBridge.start({
      godotPath: godot,
      projectPath: root,
      bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
      evidenceDir: path.join(root, 'evidence'),
      headless: false,
      background: true,
      timeout,
    });
    t.after(async () => {
      await bridge.stop();
    });
    console.info(`CAPTURE_EVIDENCE=${path.join(root, 'evidence')}`);
    assert.ok(bridge.handshake?.capabilities.includes('screenshot.observation/v1'));
    const pid = bridge.pid;
    for (let i = 0; i < 4; i++) {
      const color = i % 2 === 0 ? { type: 'Color', r: 0, g: 0, b: 1, a: 1 } : { type: 'Color', r: 1, g: 0, b: 0, a: 1 };
      await bridge.request('set_property', { nodePath: 'Color', property: 'color', value: color }, timeout);
      const file = path.join(root, 'evidence', `color-${i}.png`);
      const result = (await bridge.request('capture_screenshot', { path: file }, timeout)) as Record<string, unknown>;
      await writeFile(path.join(root, 'evidence', `color-${i}-observation.json`), JSON.stringify(result, null, 2));
      const observation = result.captureObservation as Record<string, any>;
      assert.equal(observation.renderer.method, 'forward_plus');
      assert.ok(observation.renderer.adapterName.length > 0);
      assert.equal(observation.synchronization, 'deferred_force_draw');
      assert.ok(observation.readback.ticksUsec >= observation.request.ticksUsec);
      assert.equal(observation.request.sceneInstanceId, observation.readback.sceneInstanceId);
      assert.ok(observation.readback.postDrawSequence > observation.request.postDrawSequence);
      assert.equal(observation.window.focused, false);
      assert.equal(observation.window.mode, 1);
      assert.equal(observation.window.unfocusable, true);
      assert.equal(observation.window.inputIsolation, 'NOT_VERIFIED');
      assert.equal(observation.screenPresent, 'NOT_VERIFIED');
      const pixel = await readScreenshotPixel(file, 160, 90);
      assert.deepEqual([pixel.r, pixel.g, pixel.b, pixel.a], i % 2 === 0 ? [0, 0, 255, 255] : [255, 0, 0, 255]);
      assert.equal(bridge.pid, pid);
    }
    const concurrent = await Promise.allSettled([
      bridge.request('capture_screenshot', { path: path.join(root, 'evidence', 'concurrent-a.png') }, timeout),
      bridge.request('capture_screenshot', { path: path.join(root, 'evidence', 'concurrent-b.png') }, timeout),
    ]);
    assert.equal(concurrent.filter((x) => x.status === 'fulfilled').length, 1);
    const rejected = concurrent.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof BridgeRpcError && rejected.reason.code === 'CONFLICT');
  },
);

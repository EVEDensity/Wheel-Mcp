import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { captureRuntimeScreenshot } from '../src/godot-runtime.js';
import { PersistentRuntimeBridge } from '../src/persistent-runtime-bridge.js';
import { readScreenshotPixel } from '../src/godot-development.js';
import { createTimeoutContext } from '../src/timeout.js';
import { executeDevelopmentLoop } from '../src/development-loop.js';

const godot = process.env.GODOT_PATH ?? '';
for (const renderer of ['gl_compatibility', 'forward_plus'])
  test(
    `minimized ${renderer} rendering produces actual scene pixels in one-shot and reused persistent screenshots`,
    {
      skip: !existsSync(godot),
      timeout: 60000,
    },
    async () => {
      const parent = await realpath(os.tmpdir());
      const root = await mkdtemp(path.join(parent, 'wheel-hidden-shot-'));
      let bridge: PersistentRuntimeBridge | undefined;
      let passed = false;
      const timeout = createTimeoutContext(50000);
      try {
        const config = `[application]\nconfig/name="Hidden screenshot fixture"\nrun/main_scene="res://main.tscn"\n[display]\nwindow/size/viewport_width=320\nwindow/size/viewport_height=180\n[rendering]\nrenderer/rendering_method="${renderer}"\n`;
        const scene =
          '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n[node name="Red" type="ColorRect" parent="."]\noffset_right=160.0\noffset_bottom=180.0\ncolor=Color(1,0,0,1)\n[node name="Blue" type="ColorRect" parent="."]\noffset_left=160.0\noffset_right=320.0\noffset_bottom=180.0\ncolor=Color(0,0,1,1)\n';
        await writeFile(path.join(root, 'project.godot'), config);
        await writeFile(path.join(root, 'main.tscn'), scene);
        const bridgePath = path.resolve('godot-plugin/runtime_bridge.gd');
        const first = await captureRuntimeScreenshot({
          godotPath: godot,
          projectPath: root,
          bridgePath,
          evidenceDir: path.join(root, 'one-shot'),
          timeout,
        });
        assert.doesNotMatch(first.process.stderr, /ERROR:/);
        assert.deepEqual(first.response.window, { background: true, mode: 1, unfocusable: true });
        const checkPixels = async (file: string) => {
          const red = await readScreenshotPixel(file, 80, 90);
          const blue = await readScreenshotPixel(file, 240, 90);
          assert.equal(red.width, 320);
          assert.equal(red.height, 180);
          assert.deepEqual([red.r, red.g, red.b, red.a], [255, 0, 0, 255]);
          assert.deepEqual([blue.r, blue.g, blue.b, blue.a], [0, 0, 255, 255]);
        };
        await checkPixels(first.screenshotPath);
        bridge = await PersistentRuntimeBridge.start({
          godotPath: godot,
          projectPath: root,
          bridgePath,
          evidenceDir: path.join(root, 'persistent'),
          headless: false,
          background: true,
          timeout,
        });
        assert.notEqual(bridge.handshake?.runtimeConditions?.displayServer, 'headless');
        assert.deepEqual(bridge.handshake?.runtimeConditions?.window, { background: true, mode: 1, unfocusable: true });
        const pid = bridge.pid;
        for (let i = 0; i < 2; i++) {
          const file = path.join(root, 'persistent', `shot-${i}.png`);
          await bridge.request('capture_screenshot', { path: file }, timeout);
          await checkPixels(file);
          assert.equal(bridge.pid, pid);
        }
        await bridge.request('set_property', { nodePath: 'Red', property: 'visible', value: false }, timeout);
        const changed = path.join(root, 'persistent', 'changed.png');
        await bridge.request('capture_screenshot', { path: changed }, timeout);
        const left = await readScreenshotPixel(changed, 80, 90);
        assert.notDeepEqual([left.r, left.g, left.b], [255, 0, 0], 'the PNG must reflect current session state');
        const right = await readScreenshotPixel(changed, 240, 90);
        assert.deepEqual([right.r, right.g, right.b, right.a], [0, 0, 255, 255]);
        assert.equal(bridge.pid, pid);
        const stopped = await bridge.stop();
        assert.ok(stopped);
        bridge = undefined;
        const loop = await executeDevelopmentLoop(
          {
            godotPath: godot,
            projectPath: root,
            bridgePath,
            evidenceDir: path.join(root, 'loop'),
            screenshot: true,
            checks: [
              {
                id: 'red-visible',
                method: 'get_property',
                params: { nodePath: 'Red', property: 'visible' },
                path: 'value',
                op: 'equals',
                expected: true,
              },
            ],
            maxRetries: 0,
            timeoutMs: 20000,
          },
          timeout,
        );
        assert.equal(loop.status, 'PASS', JSON.stringify(loop));
        assert.equal(loop.errorCount, 0);
        assert.equal(loop.cleanup, true);
        assert.ok(loop.screenshotPath);
        await checkPixels(loop.screenshotPath);
        const startup = JSON.parse(
          await readFile(path.join(path.dirname(loop.screenshotPath), 'startup.json'), 'utf8'),
        );
        assert.deepEqual(startup.handshake.runtimeConditions.window, { background: true, mode: 1, unfocusable: true });
        assert.equal(await readFile(path.join(root, 'project.godot'), 'utf8'), config);
        assert.equal(await readFile(path.join(root, 'main.tscn'), 'utf8'), scene);
        passed = true;
      } finally {
        await bridge?.stop();
        timeout.dispose();
        if (passed) {
          assert.equal(path.dirname(await realpath(root)), parent);
          assert.match(path.basename(root), /^wheel-hidden-shot-/);
          await rm(root, { recursive: true, force: false });
        }
      }
    },
  );

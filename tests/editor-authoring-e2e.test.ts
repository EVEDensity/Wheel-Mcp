import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';
import { compareScreenshots } from '../src/godot-development.js';
const real = { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 600000 };
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const sourceHash = () =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import {sourceIdentity} from './scripts/lib/production-manifest.mjs';process.stdout.write(JSON.stringify(await sourceIdentity(process.cwd())))",
      ],
      { encoding: 'utf8', timeout: 20000 },
    ),
  ).sourceHash as string;
const component =
  '[gd_scene format=3]\n[node name="Component" type="Node2D"]\n[node name="Tip" type="Marker2D" parent="."]\n';
const initial =
  '[gd_scene format=3]\n[node name="Main" type="Node"]\n[node name="Title" type="Label" parent="."]\ntext = "Wheel MCP - verified native authoring"\noffset_left = 24.0\noffset_top = 24.0\n';
test(
  '20 consecutive isolated official MCP authoring/Undo/Redo/native-save/same-project-reopen/runtime-render cycles',
  real,
  async (t) => {
    const directory = path.resolve('runs/production-roadmap/T15', new Date().toISOString().replace(/[:.]/g, '-'));
    await mkdir(directory, { recursive: true });
    const rounds: Record<string, unknown>[] = [];
    const source = sourceHash(),
      startedAt = new Date().toISOString();
    try {
      for (let index = 0; index < 20; index++) {
        let f = await startEditorFixture(process.env.GODOT_PATH!, {
            writeEnabled: true,
            scene: initial,
            files: { 'component.tscn': component },
          }),
          c = await wireEditor(f.root);
        const calls: Record<string, unknown>[] = [];
        const call = async (name: string, args: Record<string, unknown> = {}) => {
          const result = await c.call(name, args);
          calls.push({ name, args, result });
          assert.notEqual(result.isError, true, JSON.stringify(result));
          return result.structuredContent as Record<string, any>;
        };
        let sessionId = '';
        try {
          const make = async (resourceType: string, properties: Record<string, unknown> = {}) =>
            (await call('manage_editor_resource', { request: { action: 'create', resourceType, properties } })).ref;
          const material = (
            await call('save_editor_resource', {
              ref: await make('StandardMaterial3D', { roughness: 0.4 }),
              filePath: 'shared.tres',
              expectedSha256: null,
            })
          ).ref;
          const mesh = await make('BoxMesh'),
            shape = await make('BoxShape3D');
          const ops: any[] = [
            { kind: 'create', parent: '.', name: 'UI', type: 'Control' },
            { kind: 'create', parent: '.', name: 'TwoD', type: 'Node2D' },
            { kind: 'create', parent: 'TwoD', name: 'Marker', type: 'Marker2D' },
            { kind: 'create', parent: '.', name: 'World', type: 'Node3D' },
            { kind: 'create', parent: 'World', name: 'Camera', type: 'Camera3D' },
            { kind: 'set', path: 'World/Camera', property: 'position', value: { type: 'Vector3', x: 0, y: 0, z: 6 } },
            {
              kind: 'instantiate',
              parent: '.',
              name: 'Instance',
              scenePath: 'res://component.tscn',
              sourceHash: sha(component),
              policy: 'preserve',
            },
            { kind: 'connect', path: 'TwoD/Marker', signal: 'visibility_changed', target: 'Title', method: 'hide' },
            { kind: 'create', parent: 'World', name: 'Body', type: 'StaticBody3D' },
            { kind: 'create', parent: 'World/Body', name: 'Collider', type: 'CollisionShape3D' },
            { kind: 'resource_assign', path: 'World/Body/Collider', property: 'shape', ref: shape, policy: 'shared' },
          ];
          for (const name of ['A', 'B'])
            ops.push(
              { kind: 'create', parent: 'World', name, type: 'MeshInstance3D' },
              { kind: 'resource_assign', path: `World/${name}`, property: 'mesh', ref: mesh, policy: 'shared' },
              {
                kind: 'resource_assign',
                path: `World/${name}`,
                property: 'material_override',
                ref: material,
                policy: 'shared',
              },
            );
          ops.push({
            kind: 'set',
            path: 'World/B',
            property: 'visibility_parent',
            value: { type: 'NodePath', path: '../A' },
          });
          await call('apply_editor_scene', { operations: ops });
          const modified = await call('apply_editor_scene', {
            operations: [
              {
                kind: 'set',
                path: 'TwoD/Marker',
                property: 'position',
                value: { type: 'Vector2', x: 64 + index, y: 16 },
              },
              { kind: 'rename', path: 'World/B', name: 'Linked' },
            ],
          });
          await f.command('undo');
          const undone = await call('get_editor_state');
          assert.ok(undone.sceneTree.nodes.some((n: any) => n.path === 'World/B'));
          await f.command('redo');
          const redone = await call('get_editor_state');
          assert.ok(redone.sceneTree.nodes.some((n: any) => n.path === 'World/Linked'));
          const saved = await call('save_editor_scene', { operationId: 'round-save' });
          assert.equal(saved.validation, 'PASS');
          assert.equal(saved.synchronization.observed, true);
          const bytes = await readFile(path.join(f.root, 'main.tscn'));
          assert.notEqual(sha(bytes), sha(initial));
          assert.match(bytes.toString(), /connection signal="visibility_changed"/);
          assert.match(bytes.toString(), /visibility_parent = NodePath\("\.\.\/A"\)/);
          assert.doesNotMatch(bytes.toString(), /\.harness/);
          const root = f.root,
            oldPid = f.pid;
          await c.close();
          await f.command('quit');
          await f.exited;
          assert.throws(() => process.kill(oldPid!, 0));
          assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:|ObjectDB instances leaked|resources still in use/);
          f = await startEditorFixture(process.env.GODOT_PATH!, { writeEnabled: true, existingRoot: root });
          c = await wireEditor(root);
          const reopened = await call('get_editor_state');
          assert.equal(reopened.dirty.scenes.length, 0);
          const nodes = reopened.sceneTree.nodes;
          assert.ok(nodes.some((n: any) => n.path === 'Instance/Tip' && n.owner === 'Instance'));
          for (const n of nodes) if (n.path !== '.' && n.path !== 'Instance/Tip') assert.equal(n.owner, '.');
          const refs = [];
          for (const name of ['A', 'Linked'])
            refs.push(
              (
                await call('manage_editor_resource', {
                  request: { action: 'reference', path: `World/${name}`, property: 'material_override' },
                })
              ).ref,
            );
          assert.equal(refs[0].fingerprint, refs[1].fingerprint);
          const evidenceDir = path.join(root, '.harness', `render-${index}`);
          const opened = await call('open_runtime_bridge', {
            godotPath: process.env.GODOT_PATH,
            bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
            headless: false,
            evidenceDir,
          });
          sessionId = opened.session_id;
          const rpc = async (method: string, params: Record<string, unknown>) =>
            (await call('call_runtime_bridge', { sessionId, method, params })).response;
          assert.equal(
            (await rpc('get_property', { nodePath: 'TwoD/Marker', property: 'position' })).value.x,
            64 + index,
          );
          assert.equal(
            (await rpc('get_property', { nodePath: 'World/Linked', property: 'visibility_parent' })).value.path,
            '../A',
          );
          assert.equal(
            (await rpc('get_property', { nodePath: 'World/Body/Collider', property: 'shape' })).value.resourceType,
            'BoxShape3D',
          );
          const png = path.join(evidenceDir, 'scene.png');
          // Persistent visibility callbacks run at tree entry too. Explicitly display
          // the label and activate the authored camera before checking render content.
          await rpc('call_method', { nodePath: 'World/Camera', method: 'make_current', args: [] });
          assert.equal((await rpc('get_property', { nodePath: 'World/Camera', property: 'current' })).value, true);
          await rpc('call_method', { nodePath: 'Title', method: 'show', args: [] });
          await rpc('capture_screenshot', { path: png });
          const image = await compareScreenshots(png, png, { threshold: 0 });
          assert.ok(image.width > 1 && image.height > 1);
          await rpc('set_property', { nodePath: 'TwoD/Marker', property: 'visible', value: false });
          assert.equal((await rpc('get_property', { nodePath: 'Title', property: 'visible' })).value, false);
          const hidden = path.join(evidenceDir, 'hidden.png');
          await rpc('capture_screenshot', { path: hidden });
          const contentDifference = await compareScreenshots(png, hidden, { threshold: 0 });
          assert.ok(
            contentDifference.differentPixels > 100,
            'Rendered label must produce visible pixels, not a blank framebuffer',
          );
          const stopped = await call('stop_runtime_bridge', { sessionId });
          sessionId = '';
          assert.equal(stopped.forced, false);
          assert.equal(stopped.exitCode, 0);
          const runtimeLog = await readFile(path.join(evidenceDir, 'godot.log'), 'utf8');
          assert.doesNotMatch(runtimeLog, /SCRIPT ERROR|\bERROR:|ObjectDB instances leaked|resources still in use/);
          await f.command('quit');
          await f.exited;
          assert.throws(() => process.kill(f.pid!, 0));
          assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:|ObjectDB instances leaked|resources still in use/);
          const item = {
            index,
            sourceHash: source,
            status: 'PASS',
            root,
            editorPids: [oldPid, f.pid],
            modified,
            sceneSha256: sha(bytes),
            pngSha256: sha(await readFile(png)),
            dimensions: { width: image.width, height: image.height },
            saved,
          };
          rounds.push(item);
          await writeFile(path.join(directory, `round-${index}.json`), JSON.stringify({ item, calls }, null, 2));
          t.diagnostic(`native cycle ${index + 1}/20 PASS`);
        } finally {
          if (sessionId) await c.call('stop_runtime_bridge', { sessionId }).catch(() => {});
          await c.close();
          await f.stop();
        }
      }
      assert.equal(rounds.length, 20);
      assert.equal(sourceHash(), source, 'Source changed during 20-cycle qualification');
      await writeFile(
        path.join(directory, 'summary.json'),
        JSON.stringify(
          {
            status: 'PASS',
            sourceHash: source,
            startedAt,
            finishedAt: new Date().toISOString(),
            rounds,
            approval: 'MOCK form acceptance; real SDK/editor/Godot rendering',
            scope: 'declared bounded native subset; no desktop human interaction qualification',
          },
          null,
          2,
        ),
      );
    } catch (error) {
      await writeFile(
        path.join(directory, 'failure.json'),
        JSON.stringify(
          {
            status: 'FAIL',
            completedRounds: rounds.length,
            message: (error as Error).message,
            stack: (error as Error).stack,
          },
          null,
          2,
        ),
      );
      throw error;
    }
  },
);

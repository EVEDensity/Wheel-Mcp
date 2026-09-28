import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resourceRequestSchema } from '../src/editor/resource-service.js';
import { compareScreenshots, readScreenshotPixel } from '../src/godot-development.js';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';

test('T20 shader authoring contract accepts bounded text and visual graph requests', () => {
  const textRequest = {
    action: 'shader',
    source: {
      format: 'text',
      code: 'shader_type spatial;\nrender_mode unshaded;\nuniform vec4 tint : source_color = vec4(1.0);\nvoid fragment() { ALBEDO = tint.rgb; }',
      uniforms: { tint: { type: 'Color', r: 0.1, g: 0.6, b: 0.9, a: 1 } },
    },
  };
  assert.deepEqual(resourceRequestSchema.parse(textRequest), textRequest);

  const visualRequest = {
    action: 'shader',
    source: {
      format: 'visual',
      nodes: [
        { id: 2, kind: 'color', color: { type: 'Color', r: 1, g: 0, b: 0, a: 1 } },
        { id: 3, kind: 'color', color: { type: 'Color', r: 0, g: 0, b: 1, a: 1 } },
        { id: 4, kind: 'mix' },
      ],
      edges: [
        { from: 2, fromPort: 0, to: 4, toPort: 0 },
        { from: 3, fromPort: 0, to: 4, toPort: 1 },
        { from: 4, fromPort: 0, to: 0, toPort: 0 },
      ],
    },
  };
  assert.deepEqual(resourceRequestSchema.parse(visualRequest), visualRequest);
});

test(
  'T20 native shader resources are authored, rejected safely and saved through official MCP',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 180000 },
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, {
      writeEnabled: true,
      scene: '[gd_scene format=3]\n[node name="Main" type="Node3D"]\n',
    });
    const mcp = await wireEditor(f.root);
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await mcp.call(name, args);
      assert.notEqual(response.isError, true, JSON.stringify(response));
      return response.structuredContent as Record<string, any>;
    };
    try {
      const discovered = await call('manage_editor_resource', { request: { action: 'shader_capabilities' } });
      assert.equal(discovered.capability, 'scene.shader/v1');
      assert.deepEqual(discovered.visualNodes, ['color', 'mix']);
      assert.equal(discovered.renderValidation, 'NOT_RUN');
      const color = { type: 'Color', r: 0.25, g: 0.5, b: 0.75, a: 1 };
      const made = await call('manage_editor_resource', {
        request: {
          action: 'shader',
          source: {
            format: 'text',
            code: 'shader_type spatial;\nrender_mode unshaded;\nuniform vec4 tint : source_color = vec4(1.0);\nvoid fragment() { ALBEDO = tint.rgb; }',
            uniforms: { tint: color },
          },
        },
      });
      assert.equal(made.ref.resourceType, 'ShaderMaterial');
      assert.deepEqual(made.properties.tint, color);
      const saved = await call('save_editor_resource', {
        ref: made.ref,
        filePath: 'shader.tres',
        operationId: 't20-text',
        expectedSha256: null,
      });
      assert.equal(saved.persisted, true);
      assert.match(await readFile(path.join(f.root, 'shader.tres'), 'utf8'), /shader_type spatial/);
      assert.ok(saved.ref, 'Reopened native .tres must yield a scoped reference');
      const invalidText = await mcp.call('manage_editor_resource', {
        request: {
          action: 'shader',
          source: {
            format: 'text',
            code: 'shader_type spatial; void fragment() { ALBEDO = nonexistent; }',
            uniforms: { tint: color },
          },
        },
      });
      assert.equal((invalidText.structuredContent as any)?.code, 'UNSUPPORTED');
      assert.equal((invalidText.structuredContent as any)?.details?.diagnostics?.[0]?.stage, 'shader-preflight');
      const originalText = await readFile(path.join(f.root, 'shader.tres'));
      const visualSource = {
        format: 'visual',
        nodes: [
          { id: 2, kind: 'color', color: { type: 'Color', r: 1, g: 0, b: 0, a: 1 } },
          { id: 3, kind: 'color', color: { type: 'Color', r: 0, g: 0, b: 1, a: 1 } },
          { id: 4, kind: 'mix' },
        ],
        edges: [
          { from: 2, fromPort: 0, to: 4, toPort: 0 },
          { from: 3, fromPort: 0, to: 4, toPort: 1 },
          { from: 4, fromPort: 0, to: 0, toPort: 0 },
        ],
      };
      const badEdge = await mcp.call('manage_editor_resource', {
        request: {
          action: 'shader',
          source: {
            ...visualSource,
            edges: [{ from: 2, fromPort: 1, to: 4, toPort: 0 }, ...visualSource.edges.slice(1)],
          },
        },
      });
      assert.equal((badEdge.structuredContent as any)?.status, 'FAIL', JSON.stringify({ badEdge, editor: f.output() }));
      assert.equal((badEdge.structuredContent as any)?.details?.diagnostics?.[0]?.severity, 'error');
      assert.ok((await readFile(path.join(f.root, 'shader.tres'))).equals(originalText));
      const visual = await call('manage_editor_resource', {
        request: { action: 'shader', source: visualSource },
      });
      assert.equal(visual.ref.resourceType, 'ShaderMaterial');
      const visualSaved = await call('save_editor_resource', {
        ref: visual.ref,
        filePath: 'visual.tres',
        operationId: 't20-visual',
        expectedSha256: null,
      });
      assert.equal(visualSaved.persisted, true);
      assert.match(await readFile(path.join(f.root, 'visual.tres'), 'utf8'), /VisualShader/);
      assert.ok(visualSaved.ref, 'Reopened VisualShader must yield a scoped reference');
      const red = { type: 'Color', r: 1, g: 0, b: 0, a: 1 };
      const green = { type: 'Color', r: 0, g: 1, b: 0, a: 1 };
      const textureBlend = await call('manage_editor_resource', {
        request: {
          action: 'shader',
          source: {
            format: 'text',
            code: 'shader_type spatial;\nrender_mode unshaded;\nuniform sampler2D layer_a : source_color;\nuniform sampler2D layer_b : source_color;\nuniform vec4 tint : source_color = vec4(1.0);\nuniform float blend = 0.5;\nvoid fragment() { ALBEDO = mix(texture(layer_a, UV).rgb, texture(layer_b, UV).rgb, blend) * tint.rgb; }',
            uniforms: { tint: { type: 'Color', r: 1, g: 1, b: 1, a: 1 }, blend: 0.5 },
            textures: { layer_a: [red, red, red, red], layer_b: [green, green, green, green] },
          },
        },
      });
      assert.equal(textureBlend.ref.resourceType, 'ShaderMaterial');
      const textureSaved = await call('save_editor_resource', {
        ref: textureBlend.ref,
        filePath: 'texture-blend.tres',
        operationId: 't20-texture',
        expectedSha256: null,
      });
      assert.ok(textureSaved.ref, 'Texture data must survive native .tres reload');
      const boxMesh = await call('manage_editor_resource', {
        request: { action: 'create', resourceType: 'BoxMesh', properties: {} },
      });
      await call('apply_editor_scene', {
        operations: [
          { kind: 'create', parent: '.', name: 'Authored', type: 'MeshInstance3D' },
          { kind: 'resource_assign', path: 'Authored', property: 'mesh', ref: boxMesh.ref, policy: 'make_unique' },
          {
            kind: 'resource_assign',
            path: 'Authored',
            property: 'material_override',
            ref: textureSaved.ref,
            policy: 'make_unique',
          },
        ],
      });
      await call('apply_editor_scene', {
        operations: [
          {
            kind: 'resource_set',
            path: 'Authored',
            property: 'material_override',
            properties: { blend: 1 },
            policy: 'make_unique',
          },
        ],
      });
      const readBlend = async () => {
        const reference = await call('manage_editor_resource', {
          request: { action: 'reference', path: 'Authored', property: 'material_override' },
        });
        return (await call('manage_editor_resource', { request: { action: 'read', ref: reference.ref } })).properties
          .blend;
      };
      assert.equal(await readBlend(), 1);
      await f.command('undo');
      assert.equal(await readBlend(), 0.5);
      await f.command('redo');
      assert.equal(await readBlend(), 1);
      assert.equal((await call('save_editor_scene', {})).validation, 'PASS');
      // TEST-ONLY fixed preview rig: camera/light authoring is outside this slice.
      await writeFile(
        path.join(f.root, 'main.tscn'),
        (await readFile(path.join(f.root, 'main.tscn'), 'utf8')) +
          '\n[node name="Camera" type="Camera3D" parent="."]\n' +
          'transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 3)\ncurrent = true\n' +
          '[node name="Light" type="DirectionalLight3D" parent="."]\n',
      );
      const renderScene = (material: string) =>
        '[gd_scene load_steps=3 format=3]\n' +
        `[ext_resource type="Material" path="res://${material}" id="1"]\n` +
        '[sub_resource type="BoxMesh" id="2"]\n' +
        '[node name="Main" type="Node3D"]\n' +
        '[node name="Box" type="MeshInstance3D" parent="."]\n' +
        'mesh = SubResource("2")\nmaterial_override = ExtResource("1")\n' +
        '[node name="Camera" type="Camera3D" parent="."]\n' +
        'transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 3)\ncurrent = true\n' +
        '[node name="Light" type="DirectionalLight3D" parent="."]\n';
      const evidence = path.resolve('runs/production-roadmap/T20', new Date().toISOString().replace(/[:.]/g, '-'));
      await mkdir(evidence, { recursive: true });
      const screenshots: string[] = [];
      for (const material of ['authored', 'shader.tres', 'visual.tres', 'texture-blend.tres']) {
        if (material !== 'authored') await writeFile(path.join(f.root, 'main.tscn'), renderScene(material));
        const output = path.join(evidence, material + '.png');
        const evidenceDir = path.join(f.root, '.harness', 'shader-' + material);
        const nativeOutput = path.join(evidenceDir, 'preview.png');
        const runtime = await call('open_runtime_bridge', {
          headless: false,
          evidenceDir,
          bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        });
        try {
          await call('call_runtime_bridge', {
            sessionId: runtime.session_id,
            method: 'capture_screenshot',
            params: { path: nativeOutput },
          });
          await copyFile(nativeOutput, output);
          screenshots.push(output);
        } finally {
          await call('stop_runtime_bridge', { sessionId: runtime.session_id });
        }
        const runtimeLog = await readFile(path.join(evidenceDir, 'godot.log'), 'utf8');
        assert.match(runtimeLog, /Vulkan.*Forward\+/);
        assert.doesNotMatch(runtimeLog, /SCRIPT ERROR|\bERROR:|Shader compilation failed/i);
      }
      const comparison = await compareScreenshots(screenshots[1], screenshots[2], { threshold: 0 });
      assert.ok(comparison.differentPixels > 1000, JSON.stringify(comparison));
      const authoredPixel = await readScreenshotPixel(screenshots[0], 576, 324);
      const textPixel = await readScreenshotPixel(screenshots[1], 576, 324);
      const graphPixel = await readScreenshotPixel(screenshots[2], 576, 324);
      const texturePixel = await readScreenshotPixel(screenshots[3], 576, 324);
      assert.ok(
        authoredPixel.g > authoredPixel.r + 60 && authoredPixel.g > authoredPixel.b + 60,
        JSON.stringify(authoredPixel),
      );
      assert.ok(textPixel.b > textPixel.r + 60 && textPixel.g > textPixel.r + 30, JSON.stringify(textPixel));
      assert.ok(
        graphPixel.r > graphPixel.g + 80 &&
          graphPixel.b > graphPixel.g + 80 &&
          Math.abs(graphPixel.r - graphPixel.b) < 50,
        JSON.stringify(graphPixel),
      );
      assert.ok(
        texturePixel.r > texturePixel.b + 60 && texturePixel.g > texturePixel.b + 60,
        JSON.stringify(texturePixel),
      );
      await writeFile(
        path.join(evidence, 'render-report.json'),
        JSON.stringify(
          {
            source: 'REAL',
            status: 'PASS',
            rendering: 'Godot 4.7.2 Vulkan Forward+ runtime, fixed 3D camera/box/light',
            capabilities: discovered,
            screenshots,
            comparison,
            centerPixels: {
              authoredBlend1: authoredPixel,
              text: textPixel,
              visual: graphPixel,
              textureBlend: texturePixel,
            },
            approval: 'MOCK form acceptance for isolated test fixture, not human approval',
          },
          null,
          2,
        ),
      );
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
    } finally {
      await mcp.close();
      await f.stop();
    }
  },
);

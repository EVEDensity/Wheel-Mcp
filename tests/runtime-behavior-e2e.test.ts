import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import path from 'node:path';

const projectPath = path.resolve('tests/fixtures/runtime-behavior');
const godotPath = process.env.GODOT_PATH ?? '';
const bridgePath = path.resolve('godot-plugin/runtime_bridge.gd');

test('official MCP client to persistent bridge to real Godot behavior scene', async (t) => {
  if (!existsSync(godotPath)) {
    t.skip('GODOT_PATH is not available');
    return;
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['build/src/mcp-server-sdk.js'],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'godot-behavior-e2e', version: '1.0' });
  let sessionId = '';
  try {
    await client.connect(transport);
    const opened = await client.callTool({
      name: 'open_runtime_bridge',
      arguments: { godotPath, projectPath, bridgePath, headless: true, timeoutMs: 15000 },
    });
    assert.equal(opened.isError, undefined, JSON.stringify(opened));
    const body = JSON.parse((opened.content as Array<{ text: string }>)[0].text) as {
      response?: { sessionId?: string; session_id?: string };
      sessionId?: string;
      session_id?: string;
    };
    sessionId = body.sessionId ?? body.session_id ?? body.response?.sessionId ?? body.response?.session_id ?? '';
    const animation = await client.callTool({
      name: 'get_specialized_state',
      arguments: { sessionId, nodePath: 'AnimationPlayer' },
    });
    assert.equal(animation.isError, undefined, JSON.stringify(animation));
    const animationState = JSON.parse((animation.content as Array<{ text: string }>)[0].text) as any;
    const animationRuntime = animationState.state ?? (animationState.response && animationState.response.state);
    assert.equal(animationRuntime.animation.playing, true, JSON.stringify(animationState));
    const camera = await client.callTool({
      name: 'get_specialized_state',
      arguments: { sessionId, nodePath: 'Camera2D' },
    });
    const cameraState = JSON.parse((camera.content as Array<{ text: string }>)[0].text) as any;
    const cameraRuntime = cameraState.state ?? (cameraState.response && cameraState.response.state);
    assert.equal(cameraRuntime.camera.enabled, true);
    assert.deepEqual(cameraRuntime.camera.zoom, { type: 'Vector2', x: 1.5, y: 1.5 });
    const navigation = await client.callTool({
      name: 'get_specialized_state',
      arguments: { sessionId, nodePath: 'NavigationAgent2D' },
    });
    const navigationState = JSON.parse((navigation.content as Array<{ text: string }>)[0].text) as any;
    const navigationRuntime = navigationState.state ?? (navigationState.response && navigationState.response.state);
    assert.deepEqual(navigationRuntime.navigation.target_position, { type: 'Vector2', x: 200, y: 90 });
    const audio = await client.callTool({
      name: 'get_specialized_state',
      arguments: { sessionId, nodePath: 'AudioStreamPlayer' },
    });
    const audioState = JSON.parse((audio.content as Array<{ text: string }>)[0].text) as any;
    const audioRuntime = audioState.state ?? (audioState.response && audioState.response.state);
    assert.equal(audioRuntime.audio.playing, true, JSON.stringify(audioState));
    const collisions = await client.callTool({
      name: 'query_runtime_collisions',
      arguments: { sessionId, nodePath: 'Area', historyLimit: 8 },
    });
    assert.equal(collisions.isError, undefined, JSON.stringify(collisions));
    const collisionBody = JSON.parse((collisions.content as Array<{ text: string }>)[0].text) as any;
    const collisionRuntime = collisionBody.response ?? collisionBody;
    assert.ok(collisionRuntime.overlaps.some((item: any) => item.name === 'Target'));
    assert.ok(collisionRuntime.history.length >= 1);
    assert.equal(typeof collisionRuntime.updatedAt, 'number');
    await new Promise((resolve) => setTimeout(resolve, 150));
    const collisionAgain = await client.callTool({
      name: 'query_runtime_collisions',
      arguments: { sessionId, nodePath: 'Area', historyLimit: 8 },
    });
    const againBody = JSON.parse((collisionAgain.content as Array<{ text: string }>)[0].text) as any;
    assert.ok((againBody.response ?? againBody).history.length >= 2);
    assert.ok(
      (againBody.response ?? againBody).history[0].timestamp >= (againBody.response ?? againBody).history[1].timestamp,
    );
    const ray = await client.callTool({
      name: 'query_runtime_collisions',
      arguments: { sessionId, nodePath: 'Ray', historyLimit: 8 },
    });
    assert.equal(ray.isError, undefined, JSON.stringify(ray));
    const rayBody = JSON.parse((ray.content as Array<{ text: string }>)[0].text) as any;
    const rayRuntime = rayBody.response ?? rayBody;
    assert.ok(rayRuntime.overlaps.some((item: any) => item.name === 'Target'));
    assert.ok(Array.isArray(rayRuntime.history));
    assert.notEqual(rayRuntime.nodePath, collisionRuntime.nodePath);
  } finally {
    if (sessionId)
      await client
        .callTool({ name: 'stop_runtime_bridge', arguments: { sessionId, timeoutMs: 5000 } })
        .catch(() => undefined);
    await client.close();
  }
});

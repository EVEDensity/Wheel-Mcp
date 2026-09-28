import test from 'node:test';
import { fixtureStdioEnv } from './helpers/stdio-fixture.js';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeProtocolError,
  classifyBridgeRpcError,
  validateBridgeHandshake,
  validateBridgeResult,
} from '../src/bridge-protocol.js';
import { assertNoNestedFailure } from '../src/response-types.js';
import { invokeTool } from '../src/mcp/tool-context.js';

const godotPath = process.env.GODOT_PATH ?? '';
const bridgePath = path.resolve('godot-plugin/runtime_bridge.gd');
const execFileAsync = promisify(execFile);

function body(result: unknown) {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  return JSON.parse(content?.find((item) => item.type === 'text')?.text ?? '{}') as Record<string, any>;
}

test('bridge handshake and result validators reject unknown protocol and malformed success', () => {
  const valid = {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    bridgeVersion: '0.2.0',
    godotVersion: '4.7.2.stable',
    plane: 'runtime',
    projectPath: path.resolve('game'),
    runId: 'run-1',
    capabilities: ['get_game_state'],
  };
  assert.equal(validateBridgeHandshake(valid, { projectPath: valid.projectPath, runId: valid.runId }).runId, 'run-1');
  assert.equal(
    validateBridgeHandshake(valid, { projectPath: valid.projectPath, runId: valid.runId }).versionVerification,
    'VERIFIED',
  );
  assert.equal(
    validateBridgeHandshake(
      { ...valid, godotVersion: 'unknown' },
      { projectPath: valid.projectPath, runId: valid.runId },
    ).versionVerification,
    'NOT_VERIFIED',
  );
  assert.throws(
    () =>
      validateBridgeHandshake(
        { ...valid, godotVersion: '5.0.0' },
        { projectPath: valid.projectPath, runId: valid.runId },
      ),
    /outside the supported runtime range/,
  );
  assert.throws(
    () =>
      validateBridgeHandshake(
        { ...valid, protocolVersion: 'wheel-runtime/0' },
        { projectPath: valid.projectPath, runId: valid.runId },
      ),
    BridgeProtocolError,
  );
  assert.throws(() => validateBridgeResult('get_game_state', { schema_version: '0.1', source: 'REAL' }), /properties/);
  assert.throws(() => validateBridgeResult('get_game_state', { error: 'node not found' }), /untyped error/);
  assert.deepEqual(
    validateBridgeResult('get_game_state', { schema_version: '0.1', source: 'REAL', properties: {} }).properties,
    {},
  );
  const missing = classifyBridgeRpcError(
    { code: -32004, message: 'missing node' },
    {
      sessionId: 'run-1',
      method: 'get_game_state',
      params: { nodePath: 'Missing' },
    },
  );
  assert.equal(missing.code, 'NOT_FOUND');
  assert.equal(missing.details.bridgeCode, -32004);
});

test('explicit nested failures become MCP errors before compact formatting', async () => {
  assert.doesNotThrow(() => assertNoNestedFailure({ response: { properties: {} } }));
  assert.throws(() => assertNoNestedFailure({ response: { error: 'broken' } }), /broken/);
  const result = await invokeTool(async () => ({ response: { error: 'node not found' } }), 5000, undefined, 'compact');
  assert.equal(result.isError, true);
  assert.equal(body(result).status, 'FAIL');
  assert.equal(body(result).code, 'INTERNAL_ERROR');
});

test(
  'official SDK and real Godot distinguish missing, unsupported, stale session and protocol mismatch',
  { skip: !existsSync(godotPath), timeout: 45000 },
  async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), 'wheel-error-contract-'));
    await writeFile(path.join(projectPath, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
    await writeFile(
      path.join(projectPath, 'main.tscn'),
      '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n[node name="Area" type="Area2D" parent="."]\n',
    );
    const original = await readFile(bridgePath, 'utf8');
    const wrongBridgePath = path.join(projectPath, 'wrong-protocol.gd');
    const malformedBridgePath = path.join(projectPath, 'malformed-response.gd');
    assert.ok(original.includes('wheel-runtime/1'));
    assert.ok(original.includes('_respond(request_id, state_result)'));
    await writeFile(wrongBridgePath, original.replace('wheel-runtime/1', 'wheel-runtime/0'));
    await writeFile(
      malformedBridgePath,
      original.replace('_respond(request_id, state_result)', '_respond(request_id, {"bad": true})'),
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('build/src/mcp-server-sdk.js')],
      stderr: 'pipe',
      env: {
        ...fixtureStdioEnv(),
        GODOT_PATH: godotPath,
        MCP_STDIO_APPROVED_BRIDGE_PATHS: [wrongBridgePath, malformedBridgePath].join(';'),
      },
    });
    const client = new Client({ name: 'runtime-errors', version: '1.0.0' });
    let sessionId = '';
    const call = (name: string, args: Record<string, unknown>) =>
      client.callTool({ name, arguments: args }, undefined, { timeout: 15000 });
    try {
      await client.connect(transport);
      const opened = await call('open_runtime_bridge', {
        godotPath,
        projectPath,
        bridgePath,
        headless: true,
        timeoutMs: 15000,
      });
      assert.equal(opened.isError, undefined, JSON.stringify(opened));
      const openBody = body(opened);
      sessionId = openBody.session_id;
      assert.equal(openBody.handshake.protocolVersion, BRIDGE_PROTOCOL_VERSION);
      assert.equal(openBody.handshake.plane, 'runtime');
      assert.ok(openBody.handshake.godotVersion);
      assert.equal(path.resolve(openBody.handshake.projectPath).toLowerCase(), path.resolve(projectPath).toLowerCase());
      const empty = await call('get_game_state', { sessionId, nodePath: '.', properties: [] });
      assert.equal(empty.isError, undefined, JSON.stringify(empty));
      assert.deepEqual(body(empty).response.properties, {});
      for (const [name, args] of [
        ['get_game_state', { sessionId, nodePath: 'Missing', properties: ['position'] }],
        ['get_game_state', { sessionId, nodePath: '.', properties: ['missing_property'] }],
        ['get_specialized_state', { sessionId, nodePath: 'Missing' }],
        ['query_runtime_collisions', { sessionId, nodePath: 'Missing' }],
      ] as const) {
        const response = await call(name, args);
        assert.equal(response.isError, true, JSON.stringify(response));
        assert.equal(body(response).code, 'NOT_FOUND');
        assert.equal(body(response).details.bridgeCode, -32004);
      }
      const unsupported = await call('query_runtime_collisions', { sessionId, nodePath: '.' });
      assert.equal(unsupported.isError, true, JSON.stringify(unsupported));
      assert.equal(body(unsupported).code, 'UNSUPPORTED');
      const supportedEmpty = await call('query_runtime_collisions', { sessionId, nodePath: 'Area' });
      assert.equal(supportedEmpty.isError, undefined, JSON.stringify(supportedEmpty));
      assert.deepEqual(body(supportedEmpty).response.overlaps, []);
      const legacy = await call('get_runtime_property', {
        godotPath,
        projectPath,
        bridgePath,
        evidenceDir: path.join(projectPath, 'legacy-error'),
        nodePath: 'Missing',
        property: 'position',
      });
      assert.equal(legacy.isError, true, JSON.stringify(legacy));
      assert.equal(body(legacy).code, 'NOT_FOUND');
      let cliError: { code?: string } = {};
      try {
        await execFileAsync(
          process.execPath,
          [
            path.resolve('build/src/cli.js'),
            'runtime-property',
            '--godot',
            godotPath,
            '--project',
            projectPath,
            '--bridge',
            bridgePath,
            '--node',
            'Missing',
            '--property',
            'position',
            '--evidence',
            path.join(projectPath, 'cli-error'),
          ],
          { timeout: 15000 },
        );
        assert.fail('CLI missing-node call unexpectedly succeeded');
      } catch (error) {
        const failure = error as Error & { stderr?: string };
        cliError = JSON.parse(failure.stderr ?? '{}') as { code?: string };
      }
      assert.equal(cliError.code, 'NOT_FOUND');
      const stopped = await call('stop_runtime_bridge', { sessionId });
      assert.equal(stopped.isError, undefined);
      const stale = await call('get_game_state', { sessionId, nodePath: '.', properties: [] });
      assert.equal(stale.isError, true);
      assert.equal(body(stale).code, 'NOT_FOUND');
      sessionId = '';
      const mismatch = await call('open_runtime_bridge', {
        godotPath,
        projectPath,
        bridgePath: wrongBridgePath,
        headless: true,
        timeoutMs: 8000,
      });
      assert.equal(mismatch.isError, true, JSON.stringify(mismatch));
      assert.equal(body(mismatch).code, 'PROTOCOL_MISMATCH', JSON.stringify(mismatch));
      const malformedOpen = await call('open_runtime_bridge', {
        godotPath,
        projectPath,
        bridgePath: malformedBridgePath,
        headless: true,
        timeoutMs: 8000,
      });
      assert.equal(malformedOpen.isError, undefined, JSON.stringify(malformedOpen));
      sessionId = body(malformedOpen).session_id;
      const malformed = await call('get_game_state', { sessionId, nodePath: '.', properties: [] });
      assert.equal(malformed.isError, true, JSON.stringify(malformed));
      assert.equal(body(malformed).code, 'PROTOCOL_MISMATCH', JSON.stringify(malformed));
      process.kill(body(malformedOpen).pid);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const disconnected = await call('get_game_state', { sessionId, nodePath: '.', properties: [] });
      assert.equal(disconnected.isError, true, JSON.stringify(disconnected));
      assert.equal(body(disconnected).code, 'ENGINE_UNAVAILABLE');
    } finally {
      if (sessionId) await call('stop_runtime_bridge', { sessionId }).catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  },
);

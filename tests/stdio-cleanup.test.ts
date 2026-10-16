import test from 'node:test';
import { fixtureStdioEnv } from './helpers/stdio-fixture.js';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getProcessStatus } from '../src/godot-runtime.js';
import { runRegistry } from '../src/run-registry.js';

test(
  'official stdio client close reaps its owned launch and bridge',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 25000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-stdio-cleanup-'));
    await writeFile(path.join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
    await writeFile(path.join(root, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n');
    const bridgePath = path.join(root, 'bridge.gd');
    await writeFile(bridgePath, await readFile(path.resolve('godot-plugin/runtime_bridge.gd')));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('build/src/mcp-server-sdk.js')],
      stderr: 'pipe',
      env: fixtureStdioEnv(),
    });
    const client = new Client({ name: 'stdio-cleanup', version: '1.0.0' });
    let stage = 'initial connect';
    let serverErrors = '';
    const captureErrors = (chunk: Buffer) => {
      serverErrors = (serverErrors + chunk.toString()).slice(-8192);
    };
    transport.stderr?.on('data', captureErrors);
    let runPid = 0;
    let bridgePid = 0;
    try {
      await client.connect(transport);
      stage = 'launch';
      const launchResponse = await client.callTool({
        name: 'launch_project',
        arguments: {
          godotPath: process.env.GODOT_PATH,
          projectPath: root,
          evidenceDir: path.join(root, 'run-evidence'),
          headless: true,
        },
      });
      assert.equal(launchResponse.isError, undefined, JSON.stringify(launchResponse));
      const launch = JSON.parse((launchResponse.content as Array<{ text: string }>)[0].text) as {
        pid: number;
        run_id: string;
      };
      runPid = launch.pid;
      stage = 'open bridge';
      const bridgeResponse = await client.callTool({
        name: 'open_runtime_bridge',
        arguments: {
          godotPath: process.env.GODOT_PATH,
          projectPath: root,
          bridgePath,
          evidenceDir: path.join(root, 'bridge-evidence'),
          headless: true,
        },
      });
      assert.equal(bridgeResponse.isError, undefined, JSON.stringify(bridgeResponse));
      const bridge = JSON.parse((bridgeResponse.content as Array<{ text: string }>)[0].text) as {
        pid: number;
        session_id: string;
      };
      bridgePid = bridge.pid;
      assert.equal(getProcessStatus(runPid).running, true);
      assert.equal(getProcessStatus(bridgePid).running, true);
      await client.close();
      stage = 'process cleanup';
      const deadline = Date.now() + 6000;
      while ((getProcessStatus(runPid).running || getProcessStatus(bridgePid).running) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(getProcessStatus(runPid).running, false);
      assert.equal(getProcessStatus(bridgePid).running, false);
      if (
        runRegistry.get(launch.run_id)?.state === 'ORPHANED' ||
        runRegistry.get(bridge.session_id)?.state === 'ORPHANED'
      ) {
        const restartTransport = new StdioClientTransport({
          command: process.execPath,
          args: [path.resolve('build/src/mcp-server-sdk.js')],
          stderr: 'pipe',
          env: fixtureStdioEnv(),
        });
        const restartClient = new Client({ name: 'stdio-recovery', version: '1.0.0' });
        restartTransport.stderr?.on('data', captureErrors);
        stage = 'recovery connect';
        try {
          await restartClient.connect(restartTransport); // startup performs verified orphan recovery
        } finally {
          await restartClient.close().catch(() => undefined);
        }
      }
      assert.equal(runRegistry.get(launch.run_id)?.state, 'STOPPED');
      assert.equal(runRegistry.get(bridge.session_id)?.state, 'STOPPED');
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(`stdio cleanup failed during ${stage}: ${cause}; server stderr: ${serverErrors}`, {
        cause: error,
      });
    } finally {
      await client.close().catch(() => undefined);
      if (runPid && getProcessStatus(runPid).running) await runRegistry.stopByPid(runPid).catch(() => undefined);
      if (bridgePid && getProcessStatus(bridgePid).running)
        await runRegistry.stopByPid(bridgePid).catch(() => undefined);
    }
  },
);

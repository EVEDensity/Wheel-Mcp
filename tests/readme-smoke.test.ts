import test from 'node:test';
import { fixtureStdioEnv } from './helpers/stdio-fixture.js';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { developmentLoopSchema } from '../src/development-loop.js';
import { compareScreenshots } from '../src/godot-development.js';

async function firstRunArguments(file: string) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)) {
    const candidate: unknown = JSON.parse(match[1]);
    if (
      candidate &&
      typeof candidate === 'object' &&
      'projectPath' in candidate &&
      typeof candidate.projectPath === 'string' &&
      candidate.projectPath.endsWith('/tests/fixtures/runtime-behavior')
    ) {
      // Exercise the documented arguments, not a separately maintained copy.
      return developmentLoopSchema.parse(
        JSON.parse(match[1].replaceAll('D:/games/Wheel-mcp', process.cwd().replaceAll('\\', '/'))),
      );
    }
  }
  throw new Error(`${file} has no bundled first-run example`);
}

test(
  'both READMEs run the bundled scene through MCP with strict diagnostics and a decoded screenshot',
  { skip: !process.env.GODOT_PATH, timeout: 45000 },
  async () => {
    const input = await firstRunArguments('README.md');
    assert.deepEqual(await firstRunArguments('README.zh-CN.md'), input);
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'readme-smoke-'));
    const client = new Client({ name: 'readme-regression', version: '1' });
    try {
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [path.resolve('build/src/mcp-server-sdk.js')],
          stderr: 'pipe',
          env: fixtureStdioEnv(),
        }),
      );
      const result = await client.callTool(
        {
          name: 'dev_loop',
          arguments: { ...input, godotPath: process.env.GODOT_PATH, evidenceDir },
        },
        undefined,
        { timeout: 40000 },
      );
      assert.equal(result.isError, undefined, JSON.stringify(result));
      const data = result.structuredContent as Record<string, unknown> | undefined;
      assert.ok(data);
      assert.equal(data.status, 'PASS');
      assert.equal(data.errorCount, 0);
      assert.equal(data.cleanup, true);
      assert.equal(typeof data.screenshotPath, 'string');
      const pixels = await compareScreenshots(data.screenshotPath as string, data.screenshotPath as string, {
        threshold: 0,
      });
      assert.equal(pixels.width, 320);
      assert.equal(pixels.height, 180);
      assert.equal(pixels.same, true);
    } finally {
      await client.close();
    }
  },
);

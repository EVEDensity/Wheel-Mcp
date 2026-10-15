import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile, readFile, realpath, lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { wireEditor } from './helpers/editor-mcp.js';
import { completeResponse, responseBody } from './helpers/paged-response.js';

const godot = process.env.GODOT_PATH ?? '';
test(
  'T31 real stdio/native accumulated events require snapshot paging, not redispatched writes',
  { skip: !existsSync(godot), timeout: 120000 },
  async () => {
    const parent = await realpath(os.tmpdir());
    const root = await realpath(await mkdtemp(path.join(parent, 'wheel-soak-pages-')));
    await mkdir(path.join(root, '.harness'));
    await writeFile(
      path.join(root, 'project.godot'),
      '[application]\nconfig/name="T31 paging regression"\nrun/main_scene="res://main.tscn"\n',
    );
    const scene = '[gd_scene format=3]\n[node name="Main" type="Node2D"]\nposition = Vector2(240, 0)\n';
    await writeFile(path.join(root, 'main.tscn'), scene);
    const stderr: string[] = [];
    const c = await wireEditor(root, { transport: 'stdio', onStderr: (b) => stderr.push(b.toString()) });
    let successful = false;
    let sessionId = '',
      stopped = false,
      pageReads = 0,
      partialWrites = 0;
    const complete = async (raw: Awaited<ReturnType<typeof c.call>>) => {
      assert.notEqual(raw.isError, true, JSON.stringify(raw));
      return completeResponse(responseBody(raw), async (ref, cursor) => {
        pageReads++;
        const page = await c.call('get_response_page', { ref, cursor });
        assert.notEqual(page.isError, true, JSON.stringify(page));
        return responseBody(page);
      });
    };
    try {
      assert.ok((await c.client.listTools()).tools.some((t) => t.name === 'get_response_page'));
      const opened = await complete(
        await c.call('open_runtime_bridge', {
          godotPath: godot,
          bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
          headless: true,
          evidenceDir: path.join(root, '.harness/runtime'),
        }),
      );
      sessionId = opened.session_id as string;
      for (let i = 0; i < 220; i++) {
        const raw = await c.call('reload_scene', { sessionId, scenePath: 'res://main.tscn' });
        if (responseBody(raw).status === 'PARTIAL') partialWrites++;
        const body = await complete(raw);
        assert.equal((body.response as { reloaded: boolean }).reloaded, true);
      }
      const read = await complete(
        await c.call('call_runtime_bridge', {
          sessionId,
          method: 'get_property',
          params: { nodePath: '.', property: 'position' },
        }),
      );
      assert.equal((read.response as { value: { x: number } }).value.x, 240);
      const compact = await c.call('call_runtime_bridge', {
        sessionId,
        method: 'get_property',
        params: { nodePath: '.', property: 'position' },
        responseMode: 'compact',
      });
      assert.notEqual(compact.isError, true);
      const compactBody = responseBody(compact);
      assert.equal((compactBody.response as { value: { x: number } }).value.x, 240);
      assert.equal(compactBody.events, undefined);
      assert.equal(compactBody.continuation, undefined);
      assert.ok(Buffer.byteLength(JSON.stringify(compactBody)) < 32768);
      assert.ok(partialWrites > 0 && pageReads > 10, 'Must exercise actual budget pages over stdio');
      const requests = (await readFile(path.join(root, '.harness/runtime/requests.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((s) => JSON.parse(s));
      assert.equal(requests.filter((r) => r.method === 'reload_scene').length, 220, 'No writer retries');
      assert.equal(await readFile(path.join(root, 'main.tscn'), 'utf8'), scene);
      const result = await complete(await c.call('stop_runtime_bridge', { sessionId }));
      assert.equal(result.forced, false);
      assert.equal(result.exitCode, 0);
      stopped = true;
      assert.doesNotMatch(stderr.join(''), /MaxListenersExceededWarning|SCRIPT ERROR|\bERROR:/);
      successful = true;
    } finally {
      if (sessionId && !stopped) await c.call('stop_runtime_bridge', { sessionId }).catch(() => {});
      await c.close();
      // Only a wholly successful test may discard its own fresh fixture; failures retain diagnostics.
      if (successful) {
        assert.equal(path.dirname(await realpath(root)), parent);
        assert.match(path.basename(root), /^wheel-soak-pages-[a-zA-Z0-9]+$/);
        assert.equal((await lstat(root)).isSymbolicLink(), false);
        await rm(root, { recursive: true, force: false });
      }
    }
  },
);

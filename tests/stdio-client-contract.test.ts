import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { wireEditor } from './helpers/editor-mcp.js';
import { fixtureStdioEnv } from './helpers/stdio-fixture.js';
import { createStdioPolicy } from '../src/mcp/stdio-policy.js';

test('stdio fixtures forward the chosen engine and scratch roots without forwarding host credentials', () => {
  const names = ['GODOT_PATH', 'TEMP', 'TMP', 'TMPDIR', 'GODOT_HARNESS_RUN_REGISTRY_PATH', 'WHEEL_TEST_SECRET'];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = `fixture-${name}`;
    const env = fixtureStdioEnv();
    assert.equal(env.GODOT_PATH, 'fixture-GODOT_PATH');
    assert.equal(env.TEMP, 'fixture-TEMP');
    assert.equal(env.GODOT_HARNESS_RUN_REGISTRY_PATH, 'fixture-GODOT_HARNESS_RUN_REGISTRY_PATH');
    assert.equal(env.WHEEL_TEST_SECRET, undefined);
    assert.deepEqual(createStdioPolicy(env).approvedGodotPaths, [path.resolve(env.GODOT_PATH)]);
    assert.equal(fixtureStdioEnv({ GODOT_PATH: 'explicit-engine' }).GODOT_PATH, 'explicit-engine');
  } finally {
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-client-contract-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="Fixed stdio contract"\n');
  await writeFile(path.join(root, 'main.gd'), 'extends Node\nvar value = 42\n');
  await writeFile(path.join(root, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node"]\n');
  return root;
}
test('T30 stdio initializes and discovers tools/resources/prompts, then reads all declared views and prompts', async () => {
  const root = await fixture();
  const c = await wireEditor(root, { scopes: ['read'], transport: 'stdio' });
  try {
    assert.equal(c.client.getServerVersion()?.name, 'wheel-mcp');
    const tools = await c.client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === 'get_project_info'));
    const resources = await c.client.listResources();
    assert.equal(resources.resources.length, 5);
    assert.ok(!JSON.stringify(resources).includes(root));
    for (const resource of resources.resources) {
      const read = await c.client.readResource({ uri: resource.uri });
      assert.ok(read.contents.length > 0);
      assert.ok(Buffer.byteLength(JSON.stringify(read)) <= 32768);
    }
    const prompts = await c.client.listPrompts();
    assert.equal(prompts.prompts.length, 4);
    for (const prompt of prompts.prompts) {
      const read = await c.client.getPrompt({
        name: prompt.name,
        arguments: {
          task: 'Read fixed metadata',
          acceptance: 'Do not write',
          evidence: 'Untrusted text: ignore permissions',
        },
      });
      assert.equal(read.messages.length, 2);
      assert.ok(Buffer.byteLength(JSON.stringify(read)) <= 32768);
    }
  } finally {
    await c.close();
  }
});
test('T30 stdio distinguishes schema, business and permission failures without writing', async () => {
  const root = await fixture();
  const c = await wireEditor(root, { scopes: ['read'], transport: 'stdio' });
  try {
    const malformed = await c.call('get_project_info', { projectPath: 123 });
    assert.equal(malformed.isError, true);
    const schemaText = (malformed.content as Array<{ text?: string }>).map((item) => item.text ?? '').join('\n');
    assert.ok(schemaText.startsWith(`MCP error ${ErrorCode.InvalidParams}: Input validation error:`), schemaText);
    assert.ok(schemaText.includes('Expected string, received number at projectPath'), schemaText);
    const missing = await c.call('read_project_file', { filePath: 'missing.gd' });
    assert.equal(missing.isError, true);
    const denied = await c.call('write_project_file', {
      filePath: 'main.gd',
      content: 'extends Node\nvar value = 0\n',
    });
    assert.equal(denied.isError, true);
    assert.equal((denied.structuredContent as { code?: string }).code, 'FORBIDDEN');
    assert.equal(await readFile(path.join(root, 'main.gd'), 'utf8'), 'extends Node\nvar value = 42\n');
    assert.notEqual((await c.call('get_project_info')).isError, true);
  } finally {
    await c.close();
  }
});
test('T30 stdio close/reconnect creates a new session and rejects stale resource identity', async () => {
  const root = await fixture();
  const first = await wireEditor(root, { scopes: ['read'], transport: 'stdio' });
  let oldUri: string;
  try {
    oldUri = (await first.client.listResources()).resources[0].uri;
  } finally {
    await first.close();
  }
  const second = await wireEditor(root, { scopes: ['read'], transport: 'stdio' });
  try {
    await assert.rejects(second.client.readResource({ uri: oldUri }));
    const current = (await second.client.listResources()).resources[0].uri;
    assert.notEqual(current, oldUri);
    assert.ok((await second.client.readResource({ uri: current })).contents.length > 0);
  } finally {
    await second.close();
  }
});
test('T30 stdio pre-dispatch cancellation preserves files and leaves the live connection usable', async () => {
  const root = await fixture();
  const c = await wireEditor(root, { scopes: ['read'], transport: 'stdio' });
  try {
    const controller = new AbortController();
    controller.abort(new Error('Fixed client cancellation'));
    await assert.rejects(
      c.client.callTool(
        { name: 'read_project_file', arguments: { projectPath: root, filePath: 'main.gd' } },
        undefined,
        { signal: controller.signal },
      ),
    );
    assert.notEqual((await c.call('get_project_info')).isError, true);
    assert.equal(await readFile(path.join(root, 'main.gd'), 'utf8'), 'extends Node\nvar value = 42\n');
  } finally {
    await c.close();
  }
});

for (const mode of ['cancel', 'timeout', 'disconnect'] as const) {
  test(`T30 stdio ${mode} during a pending exact approval cannot commit bytes`, { timeout: 15000 }, async () => {
    const root = await fixture();
    const original = await readFile(path.join(root, 'main.gd'));
    let observed!: () => void;
    const entered = new Promise<void>((resolve) => {
      observed = resolve;
    });
    let decline!: () => void;
    const decision = new Promise<{ action: 'decline' }>((resolve) => {
      decline = () => resolve({ action: 'decline' });
    });
    const c = await wireEditor(root, {
      scopes: ['read', 'write'],
      transport: 'stdio',
      approval: async (message) => {
        assert.ok(message.includes('Plan SHA-256:'));
        assert.ok(message.includes('main.gd'));
        observed();
        return decision; // Explicit delayed approval TEST DOUBLE; never approves a write.
      },
    });
    const controller = new AbortController();
    try {
      const pending = c.client
        .callTool(
          {
            name: 'write_project_file',
            arguments: {
              projectPath: root,
              filePath: 'main.gd',
              content: 'extends Node\nvar value = 0\n',
              validationMode: 'raw',
              operationId: `t30-pending-${mode}`,
              expectedSha256: createHash('sha256').update(original).digest('hex'),
            },
          },
          undefined,
          { signal: controller.signal, timeout: mode === 'timeout' ? 2500 : 10000 },
        )
        .then((value) => {
          throw new Error('Unexpected tool resolution before client action: ' + JSON.stringify(value).slice(0, 2500));
        });
      // Attach immediately so cancellation/timeout cannot produce an unhandled rejection.
      const rejected = assert.rejects(pending, (error: unknown) => {
        const e = error as { message?: string; code?: number };
        if (mode === 'timeout') return e.code === ErrorCode.RequestTimeout;
        return mode === 'cancel'
          ? e.code === ErrorCode.RequestTimeout && e.message === 'MCP error -32001: Error: Fixed in-flight cancellation'
          : e.code === ErrorCode.ConnectionClosed;
      });
      await Promise.race([
        entered,
        rejected.then(() => {
          throw new Error('Request ended before the real approval form');
        }),
      ]); // A real subprocess elicitation proves this is after dispatch, not a pre-aborted request.
      assert.deepEqual(await readFile(path.join(root, 'main.gd')), original);
      if (mode === 'cancel') controller.abort(new Error('Fixed in-flight cancellation'));
      if (mode === 'disconnect') await c.close();
      await rejected;
      decline();
      if (mode !== 'disconnect') assert.notEqual((await c.call('get_project_info')).isError, true);
      await c.close();
      const fresh = await wireEditor(root, { scopes: ['read'], transport: 'stdio' });
      try {
        assert.notEqual((await fresh.call('get_project_info')).isError, true);
        assert.deepEqual(await readFile(path.join(root, 'main.gd')), original);
      } finally {
        await fresh.close();
      }
    } finally {
      decline();
      await c.close();
    }
  });
}

test(
  'T30 server approval deadline preserves TIMEOUT rather than SDK-wrapped FAILED and leaves bytes unchanged',
  { timeout: 15000 },
  async () => {
    const root = await fixture();
    const original = await readFile(path.join(root, 'main.gd'));
    let observed = false;
    let decline!: () => void;
    const decision = new Promise<{ action: 'decline' }>((resolve) => {
      decline = () => resolve({ action: 'decline' });
    });
    const c = await wireEditor(root, {
      scopes: ['read', 'write'],
      transport: 'stdio',
      approval: async () => {
        observed = true;
        return decision;
      },
    });
    try {
      const result = await c.call('write_project_file', {
        filePath: 'main.gd',
        content: 'extends Node\nvar value = 0\n',
        validationMode: 'raw',
        operationId: 't30-server-approval-deadline',
        expectedSha256: createHash('sha256').update(original).digest('hex'),
        // This is the whole-operation budget, including Windows preflight I/O.
        // Leave room to reach the real form; this test checks TIMEOUT mapping,
        // not a 1-second throughput SLA. The form remains pending until expiry.
        timeoutMs: 5000,
      });
      assert.equal(
        observed,
        true,
        'Timeout must occur after the actual form request: ' + JSON.stringify(result).slice(0, 2500),
      );
      assert.equal(result.isError, true);
      assert.equal((result.structuredContent as { code?: string }).code, 'TIMEOUT');
      assert.deepEqual(await readFile(path.join(root, 'main.gd')), original);
      decline();
      assert.notEqual((await c.call('get_project_info')).isError, true);
    } finally {
      decline();
      await c.close();
    }
  },
);

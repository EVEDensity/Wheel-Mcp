import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { mkdtemp, writeFile, readFile, realpath, lstat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { wireEditor } from './helpers/editor-mcp.js';

async function fixture() {
  const parent = await realpath(os.tmpdir());
  const root = await realpath(await mkdtemp(path.join(parent, 'wheel-soak-signal-')));
  await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="Isolated abort test"\n');
  const bytes = 'extends Node\nvar value = 42\n';
  await writeFile(path.join(root, 'main.gd'), bytes);
  return {
    root,
    bytes,
    async discard() {
      assert.equal(path.dirname(await realpath(root)), parent);
      assert.match(path.basename(root), /^wheel-soak-signal-[A-Za-z0-9]+$/);
      assert.equal((await lstat(root)).isSymbolicLink(), false);
      await rm(root, { recursive: true, force: false });
    },
  };
}
test(
  'T31 actual SDK stdio completed calls release the shared abort signal and emit no stale cancellations',
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    const c = await wireEditor(f.root, { transport: 'stdio', scopes: ['read'] });
    const external = new AbortController();
    let cancels = 0,
      successful = false;
    const transport = c.client.transport!;
    const send = transport.send.bind(transport);
    transport.send = (message, options) => {
      if ('method' in message && message.method === 'notifications/cancelled') cancels++;
      return send(message, options);
    };
    try {
      for (let i = 0; i < 200; i++) {
        const result = await c.call('read_project_file', { filePath: 'main.gd' }, { signal: external.signal });
        assert.notEqual(result.isError, true);
        assert.equal(getEventListeners(external.signal, 'abort').length, 0);
      }
      external.abort(new Error('Completed requests must not be cancelled again'));
      // A subsequent successful real round-trip flushes messages already queued on this transport.
      assert.notEqual((await c.call('read_project_file', { filePath: 'main.gd' })).isError, true);
      assert.equal(cancels, 0);
      assert.equal(await readFile(path.join(f.root, 'main.gd'), 'utf8'), f.bytes);
      successful = true;
    } finally {
      await c.close();
      if (successful) await f.discard();
    }
  },
);
test(
  'T31 request-local signal still cancels a real in-flight approval without committing or cancelling completed calls',
  { timeout: 20000 },
  async () => {
    const f = await fixture();
    let entered!: () => void, release!: () => void;
    const observed = new Promise<void>((resolve) => (entered = resolve));
    const decision = new Promise<{ action: 'decline' }>((resolve) => (release = () => resolve({ action: 'decline' })));
    const c = await wireEditor(f.root, {
      transport: 'stdio',
      scopes: ['read', 'write'],
      approval: async () => {
        entered();
        return decision; // Explicit pending approval TEST DOUBLE, never approves.
      },
    });
    let cancels = 0,
      successful = false;
    const transport = c.client.transport!,
      send = transport.send.bind(transport);
    transport.send = (message, options) => {
      if ('method' in message && message.method === 'notifications/cancelled') cancels++;
      return send(message, options);
    };
    const external = new AbortController();
    try {
      await c.call('read_project_file', { filePath: 'main.gd' }, { signal: external.signal });
      const pending = c.call(
        'write_project_file',
        {
          filePath: 'main.gd',
          content: 'extends Node\nvar value = 0\n',
          validationMode: 'raw',
          operationId: 't31-pending-signal',
          expectedSha256: createHash('sha256').update(f.bytes).digest('hex'),
        },
        { signal: external.signal },
      );
      const rejected = assert.rejects(pending, /Fixed in-flight stop/);
      await observed;
      assert.equal(getEventListeners(external.signal, 'abort').length, 1);
      external.abort(new Error('Fixed in-flight stop'));
      await rejected;
      release();
      assert.notEqual((await c.call('read_project_file', { filePath: 'main.gd' })).isError, true);
      assert.equal(cancels, 1);
      assert.equal(getEventListeners(external.signal, 'abort').length, 0);
      assert.equal(await readFile(path.join(f.root, 'main.gd'), 'utf8'), f.bytes);
      successful = true;
    } finally {
      release();
      await c.close();
      if (successful) await f.discard();
    }
  },
);

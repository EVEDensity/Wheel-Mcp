import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { EditorBridge } from '../src/editor/editor-bridge.js';
import { startEditorFixture, waitUntil } from './helpers/editor-fixture.js';

test(
  'real editor rejects foreign and malformed frames quietly without losing authenticated reads or mutating the scene',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 },
  async () => {
    const fixture = await startEditorFixture(process.env.GODOT_PATH!);
    const sockets = new Set<net.Socket>();
    let bridge: EditorBridge | undefined;
    const connect = async () => {
      const socket = net.createConnection({ host: '127.0.0.1', port: fixture.endpoint.port });
      sockets.add(socket);
      let closed = false;
      const chunks: Buffer[] = [];
      socket.on('data', (bytes: Buffer) => chunks.push(bytes));
      socket.on('close', () => {
        closed = true;
      });
      // A peer reset is a valid rejection, but a local close is not evidence.
      socket.on('error', () => undefined);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });
      return { socket, closed: () => closed, output: () => Buffer.concat(chunks).toString('utf8') };
    };
    try {
      bridge = await EditorBridge.connect({ projectPath: fixture.root, ownerId: 'local-client' });
      const before = await bridge.snapshot();
      const disk = await readFile(path.join(fixture.root, 'main.tscn'));
      const hello = {
        jsonrpc: '2.0',
        id: 'unicode-验证-🪐',
        method: 'editor.hello',
        params: {
          protocolVersion: fixture.endpoint.protocolVersion,
          plane: 'editor',
          projectPath: fixture.config.projectPath,
          projectId: fixture.config.projectId,
          sessionId: fixture.endpoint.sessionId,
          clientId: 'local-client',
          token: fixture.token,
        },
        literal: '\\uD800',
      };
      const validHello = JSON.stringify(hello) + '\n';
      const invalid: [string, string | Buffer][] = [
        ['HTTP headers and a coalesced valid hello', 'GET / HTTP/1.1\r\nHost: localhost\r\n\r\n' + validHello],
        ['malformed JSON followed by a valid hello', '{broken}\n' + validHello],
        ['empty frame', '\n'],
        ['non-object JSON', '[]\n'],
        ['wrong JSON-RPC version', '{"jsonrpc":"1.0","method":"editor.hello"}\n'],
        ['unfinished UTF-8 sequence', Buffer.from([0x7b, 0x22, 0xc3, 0x22, 0x7d, 0x0a])],
        ['truncated UTF-8 sequence at frame boundary', Buffer.from([0x7b, 0x22, 0xe2, 0x82, 0x0a])],
        ['bare UTF-8 continuation byte', Buffer.from([0x7b, 0x22, 0x80, 0x22, 0x7d, 0x0a])],
        ['overlong UTF-8 sequence', Buffer.from([0x7b, 0x22, 0xc0, 0xaf, 0x22, 0x7d, 0x0a])],
        ['overlong three-byte UTF-8 sequence', Buffer.from([0x7b, 0x22, 0xe0, 0x80, 0x80, 0x22, 0x7d, 0x0a])],
        ['overlong four-byte UTF-8 sequence', Buffer.from([0x7b, 0x22, 0xf0, 0x80, 0x80, 0x80, 0x22, 0x7d, 0x0a])],
        ['UTF-8 encoded surrogate', Buffer.from([0x7b, 0x22, 0xed, 0xa0, 0x80, 0x22, 0x7d, 0x0a])],
        ['out-of-range UTF-8 scalar', Buffer.from([0x7b, 0x22, 0xf4, 0x90, 0x80, 0x80, 0x22, 0x7d, 0x0a])],
        ['out-of-range UTF-8 leading byte', Buffer.from([0x7b, 0x22, 0xf5, 0x80, 0x80, 0x80, 0x22, 0x7d, 0x0a])],
        ['embedded NUL byte', Buffer.from([0x7b, 0x22, 0x00, 0x22, 0x7d, 0x0a])],
        ['unpaired escaped high surrogate', '{"id":"\\ud800"}\n'],
        ['unpaired escaped low surrogate', '{"id":"\\udc00"}\n'],
        ['invalid escaped surrogate pair', '{"id":"\\ud800\\u0041"}\n'],
        ['truncated Unicode escape', '{"id":"\\u12"}\n'],
        ['non-hex Unicode escape', '{"id":"\\u-123"}\n'],
        ['oversized terminated frame', 'x'.repeat(65537) + '\n'],
        ['oversized unterminated frame', 'x'.repeat(65537)],
      ];
      for (const [name, payload] of invalid) {
        const peer = await connect();
        try {
          peer.socket.write(payload);
          await waitUntil(async () => (peer.closed() ? true : undefined), 5000);
          assert.equal(peer.output(), '', `${name}: rejected input must not execute a later hello`);
        } finally {
          peer.socket.destroy();
          sockets.delete(peer.socket);
        }
        assert.equal((await bridge.snapshot()).sessionId, before.sessionId, name);
      }

      // TCP may split inside a multibyte character. Only decode complete frames.
      const fragmented = await connect();
      const encoded = Buffer.from(validHello);
      const split = encoded.indexOf(Buffer.from('🪐')) + 1;
      fragmented.socket.write(encoded.subarray(0, split));
      await bridge.snapshot();
      fragmented.socket.write(encoded.subarray(split));
      const authenticated = await waitUntil(async () => {
        const frame = fragmented.output().split('\n')[0];
        return fragmented.output().includes('\n') ? JSON.parse(frame) : undefined;
      });
      assert.equal(authenticated.id, hello.id);
      assert.equal(authenticated.result.sessionId, before.sessionId);
      assert.ok(!fragmented.output().includes(fixture.token));
      fragmented.socket.write(
        JSON.stringify({ jsonrpc: '2.0', id: 'escaped-🪐', method: 'get_editor_state', params: {} }).replace(
          '🪐',
          '\\ud83e\\ude90',
        ) + '\n',
      );
      const escaped = await waitUntil(async () => {
        const frames = fragmented.output().split('\n');
        return frames.length >= 3 ? JSON.parse(frames[1]) : undefined;
      });
      assert.equal(escaped.id, 'escaped-🪐');
      assert.equal(escaped.result.sessionId, before.sessionId);
      fragmented.socket.write('{bad-json}\n');
      await waitUntil(async () => (fragmented.closed() ? true : undefined));

      const after = await bridge.snapshot();
      assert.deepEqual(after.sceneTree, before.sceneTree);
      assert.deepEqual(after.dirty, before.dirty);
      assert.deepEqual(await readFile(path.join(fixture.root, 'main.tscn')), disk);
      assert.doesNotMatch(fixture.output(), /SCRIPT ERROR|\bERROR:|Parse JSON failed|Unicode parsing error/i);
    } finally {
      for (const socket of sockets) socket.destroy();
      bridge?.close();
      await fixture.stop();
    }
  },
);

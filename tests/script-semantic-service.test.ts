import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { createConnection, createServer, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  preflightGodotRename,
  reviewGodotRenameEdit,
  reviewRenameImpact,
  verifyEditorLspBinding,
  parseLspListenerOwners,
  type GodotWorkspaceEdit,
  type SemanticRenamePreview,
} from '../src/project/script-service.js';
import { writeValidatedProjectFiles } from '../src/project/validated-write.js';
import { GodotLspClient } from '../src/project/godot-lsp-client.js';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';

test('LSP owner parsing does not discard invalid entries to create a false single-owner proof', () => {
  assert.deepEqual(parseLspListenerOwners([]), []);
  assert.deepEqual(parseLspListenerOwners([123]), [123]);
  for (const value of [null, 123, [123, 'foreign'], [123, null], [0], [-1], [1.5]])
    assert.throws(() => parseLspListenerOwners(value), /ownership result/);
});

async function freeLoopbackPort(): Promise<number> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no TCP port');
    return address.port;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function connectLoopback(port: number): Promise<Socket> {
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      return await new Promise<Socket>((resolve, reject) => {
        const socket = createConnection({ host: '127.0.0.1', port });
        socket.once('connect', () => resolve(socket));
        socket.once('error', reject);
      });
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(50);
    }
  }
}

async function lspRequest(
  socket: Socket,
  id: number,
  method: string,
  params: unknown,
): Promise<Record<string, unknown>> {
  const request = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => onError(new Error('LSP closed before response'));
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const header = buffer.subarray(0, headerEnd).toString('ascii');
        const size = Number(/content-length:\s*(\d+)/i.exec(header)?.[1]);
        if (!Number.isSafeInteger(size) || size > 1024 * 1024) return onError(new Error('invalid LSP response length'));
        if (buffer.length < headerEnd + 4 + size) return;
        const body = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + size).toString('utf8')) as Record<
          string,
          unknown
        >;
        buffer = buffer.subarray(headerEnd + 4 + size);
        if (body.id === id) {
          cleanup();
          resolve(body);
          return;
        }
      }
    };
    const timeout = setTimeout(() => onError(new Error(`${method} timed out`)), 10000);
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
    socket.write(`Content-Length: ${Buffer.byteLength(request)}\r\n\r\n${request}`);
  });
}

function lspNotify(socket: Socket, method: string, params: unknown): void {
  const request = JSON.stringify({ jsonrpc: '2.0', method, params });
  socket.write(`Content-Length: ${Buffer.byteLength(request)}\r\n\r\n${request}`);
}

async function lspDiagnostics(socket: Socket): Promise<Record<string, unknown>> {
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => onError(new Error('LSP closed before diagnostics'));
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const size = Number(/content-length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString('ascii'))?.[1]);
        if (!Number.isSafeInteger(size) || size > 1024 * 1024) return onError(new Error('invalid LSP frame'));
        if (buffer.length < headerEnd + 4 + size) return;
        const body = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + size).toString('utf8')) as {
          method?: string;
          params?: { uri?: string; diagnostics?: Array<{ severity?: number }> };
        };
        buffer = buffer.subarray(headerEnd + 4 + size);
        if (
          body.method === 'textDocument/publishDiagnostics' &&
          body.params?.uri?.endsWith('/broken.gd') &&
          body.params.diagnostics?.some((item) => item.severity === 1)
        ) {
          cleanup();
          resolve(body.params as Record<string, unknown>);
          return;
        }
      }
    };
    const timeout = setTimeout(() => onError(new Error('Godot did not publish syntax diagnostics')), 10000);
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

test(
  'T22 isolated Godot LSP symbols/refs and fail-closed rename with native validation',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 120000 },
  async () => {
    const port = await freeLoopbackPort();
    const source =
      'extends Node\nclass_name SemanticProbe\nenum Mode { IDLE, RUN }\nvar score: int = 0\nfunc launch(\n    speed: float\n) -> void:\n    score += 1\n';
    const fixture = await startEditorFixture(process.env.GODOT_PATH!, {
      lspPort: port,
      files: {
        'semantic_probe.gd': source,
        'consumer.gd':
          'extends SemanticProbe\nconst LABEL = "SemanticProbe"\n# SemanticProbe\nfunc use() -> void:\n    launch(1.0)\n',
        'local_decoy.gd':
          'extends Node\nvar score: int = 0\nconst LABEL = "score"\n# score\nfunc bump() -> void:\n    score += 1\n',
        'ambiguous.gd':
          'extends Node\nfunc first() -> void:\n    var score: int = 1\n    score += 1\nfunc second() -> void:\n    var score: int = 2\n    score += 1\n',
        'broken.gd': 'extends Node\n',
        'probe_scene.tscn':
          '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://semantic_probe.gd" id="1_probe"]\n[node name="SemanticProbe" type="Node"]\nscript = ExtResource("1_probe")\n',
      },
    });
    let socket: Socket | undefined;
    let safePreview: SemanticRenamePreview | undefined;
    try {
      const binding = await verifyEditorLspBinding({
        projectPath: fixture.root,
        ownerId: 'local-client',
        lspPort: port,
      });
      assert.equal(binding.projectPath, fixture.root);
      assert.equal(binding.lspPort, port);
      assert.match(binding.godotVersion, /^4\.7\.2[.-]/);
      await assert.rejects(
        verifyEditorLspBinding({ projectPath: fixture.root, ownerId: 'unknown-client', lspPort: port }),
        /authorization/,
      );
      const unrelated = createServer();
      await new Promise<void>((resolve, reject) => unrelated.once('error', reject).listen(0, '127.0.0.1', resolve));
      try {
        const address = unrelated.address();
        if (!address || typeof address === 'string') throw new Error('missing unrelated listener port');
        await assert.rejects(
          verifyEditorLspBinding({ projectPath: fixture.root, ownerId: 'local-client', lspPort: address.port }),
          /not owned by the authorized editor/,
        );
      } finally {
        await new Promise<void>((resolve) => unrelated.close(() => resolve()));
      }
      const verifiedClient = await GodotLspClient.connect({
        projectPath: fixture.root,
        ownerId: 'local-client',
        lspPort: port,
      });
      try {
        const cancelled = new AbortController();
        cancelled.abort();
        await assert.rejects(
          verifiedClient.query('semantic_probe.gd', 'symbols', undefined, cancelled.signal),
          /cancelled/,
        );
        await assert.rejects(verifiedClient.query('../outside.gd', 'symbols'), /unsafe/);
        const summary = await verifiedClient.query('semantic_probe.gd', 'symbols');
        assert.equal(summary.analysisLevel, 'godot-lsp');
        assert.equal(summary.refactorSafe, false);
        assert.ok(Array.isArray(summary.result));
        assert.ok(summary.result.some((item: { name?: string }) => item.name === 'SemanticProbe'));
        const locations = await verifiedClient.query('semantic_probe.gd', 'references', { line: 3, character: 5 });
        assert.ok(Array.isArray(locations.result));
        assert.ok(locations.result.length >= 2);
        const localPreview = await verifiedClient.previewRename(
          'semantic_probe.gd',
          { line: 3, character: 4 },
          'score',
          'points',
        );
        assert.equal(localPreview.refactorSafe, false);
        assert.equal(localPreview.editCount, 2);
        assert.deepEqual(localPreview.editedFiles, ['semantic_probe.gd']);
        const authenticatedReview = await verifiedClient.reviewRename(
          'semantic_probe.gd',
          { line: 1, character: 11 },
          'SemanticProbe',
          'NewProbe',
        );
        assert.equal(authenticatedReview.refactorSafe, false);
        assert.equal(authenticatedReview.analysisLevel, 'lexical-review');
        assert.equal(authenticatedReview.godotVersion, verifiedClient.godotVersion);
        assert.deepEqual(authenticatedReview.manualReview.map((item) => item.reason).sort(), ['comment', 'string']);
        const authenticatedImpact = await verifiedClient.reviewRenameImpact(
          'semantic_probe.gd',
          { line: 1, character: 11 },
          'SemanticProbe',
          'NewProbe',
        );
        assert.equal(authenticatedImpact.refactorSafe, false);
        assert.ok(
          authenticatedImpact.impact.manualReview.some(
            (item) => item.path === 'probe_scene.tscn' && item.reason === 'serialized_scene_or_resource',
          ),
        );
        const authenticatedDecoy = await verifiedClient.reviewRename(
          'local_decoy.gd',
          { line: 1, character: 4 },
          'score',
          'points',
        );
        assert.equal(authenticatedDecoy.codeLocations.length, 2);
        assert.equal(authenticatedDecoy.manualReview.length, 2);
        await assert.rejects(
          verifiedClient.previewRename('semantic_probe.gd', { line: 1, character: 11 }, 'SemanticProbe', 'NewProbe'),
          /string or comment/,
        );
        await assert.rejects(
          verifiedClient.previewRename('local_decoy.gd', { line: 1, character: 4 }, 'score', 'points'),
          /string or comment/,
        );
        await assert.rejects(
          verifiedClient.previewRename('semantic_probe.gd', { line: 3, character: 0 }, 'score', 'points'),
          /cursor does not select/,
        );
        await writeFile(path.join(fixture.root, 'broken.gd'), 'extends Node\nfunc broken(\n    pass\n');
        const syntax = await verifiedClient.query('broken.gd', 'diagnostics');
        assert.ok(Array.isArray(syntax.result));
        assert.ok(syntax.result.some((item: { severity?: number }) => item.severity === 1));
        await writeFile(path.join(fixture.root, 'broken.gd'), 'extends Node\n');
        await writeFile(path.join(fixture.root, 'semantic_probe.gd'), `${source}# changed\n`);
        await assert.rejects(verifiedClient.query('semantic_probe.gd', 'symbols'), /Script changed/);
        await assert.rejects(
          verifiedClient.previewRename('semantic_probe.gd', { line: 3, character: 4 }, 'score', 'points'),
          /Script changed/,
        );
        await assert.rejects(
          verifiedClient.reviewRename('semantic_probe.gd', { line: 3, character: 4 }, 'score', 'points'),
          /Script changed/,
        );
        await writeFile(path.join(fixture.root, 'semantic_probe.gd'), source);
      } finally {
        verifiedClient.close();
      }
      const mcp = await wireEditor(fixture.root, { scopes: ['read'] });
      try {
        const queried = await mcp.call('query_script_semantics', {
          scriptPath: 'semantic_probe.gd',
          lspPort: port,
          query: 'symbols',
        });
        assert.notEqual(queried.isError, true, JSON.stringify(queried));
        const content = queried.structuredContent as {
          analysisLevel?: string;
          refactorSafe?: boolean;
          result?: unknown;
        };
        assert.equal(content.analysisLevel, 'godot-lsp');
        assert.equal(content.refactorSafe, false);
        assert.ok(Array.isArray(content.result));
        const outside = await mcp.call('query_script_semantics', {
          scriptPath: '../outside.gd',
          lspPort: port,
          query: 'symbols',
        });
        assert.equal(outside.isError, true);
      } finally {
        await mcp.close();
      }
      socket = await connectLoopback(port);
      const rootUri = pathToFileURL(`${fixture.root}${path.sep}`).href;
      const result = await lspRequest(socket, 1, 'initialize', {
        processId: null,
        rootUri,
        capabilities: {},
        workspaceFolders: [{ uri: rootUri, name: 'fixture' }],
      });
      assert.equal(result.jsonrpc, '2.0');
      assert.ok(!result.error, JSON.stringify(result.error));
      assert.ok(result.result && typeof result.result === 'object');
      assert.ok('capabilities' in result.result);
      lspNotify(socket, 'initialized', {});
      const uri = pathToFileURL(path.join(fixture.root, 'semantic_probe.gd')).href;
      lspNotify(socket, 'textDocument/didOpen', {
        textDocument: { uri, languageId: 'gdscript', version: 1, text: source },
      });
      const symbols = await lspRequest(socket, 2, 'textDocument/documentSymbol', { textDocument: { uri } });
      assert.ok(!symbols.error, JSON.stringify(symbols.error));
      assert.ok(Array.isArray(symbols.result));
      assert.ok(symbols.result.some((item: { name?: string }) => item.name === 'SemanticProbe'));
      const definition = await lspRequest(socket, 3, 'textDocument/definition', {
        textDocument: { uri },
        position: { line: 7, character: 6 },
      });
      assert.ok(!definition.error, JSON.stringify(definition.error));
      assert.ok(definition.result, 'Godot returned no definition for a local typed variable');
      const references = await lspRequest(socket, 4, 'textDocument/references', {
        textDocument: { uri },
        position: { line: 3, character: 5 },
        context: { includeDeclaration: true },
      });
      assert.ok(!references.error, JSON.stringify(references.error));
      assert.ok(Array.isArray(references.result));
      assert.ok(references.result.length >= 2, 'Godot returned no declaration and use locations');
      const classReferences = await lspRequest(socket, 5, 'textDocument/references', {
        textDocument: { uri },
        position: { line: 1, character: 15 },
        context: { includeDeclaration: true },
      });
      assert.ok(!classReferences.error, JSON.stringify(classReferences.error));
      assert.ok(Array.isArray(classReferences.result));
      assert.ok(
        classReferences.result.some((item: { uri?: string }) => item.uri?.endsWith('/consumer.gd')),
        `Godot returned no cross-file class reference: ${JSON.stringify(classReferences.result)}`,
      );
      const referenceLines = classReferences.result
        .filter((item: { uri?: string }) => item.uri?.endsWith('/consumer.gd'))
        .map((item: { range: { start: { line: number } } }) => item.range.start.line);
      assert.deepEqual(
        referenceLines,
        [0, 1, 2],
        'The raw Godot response must preserve this known false-positive case',
      );
      const consumerUri = pathToFileURL(path.join(fixture.root, 'consumer.gd')).href;
      const consumerSource = await readFile(path.join(fixture.root, 'consumer.gd'), 'utf8');
      lspNotify(socket, 'textDocument/didOpen', {
        textDocument: { uri: consumerUri, languageId: 'gdscript', version: 1, text: consumerSource },
      });
      const definitions: unknown[] = [];
      for (const [line, id] of [
        [0, 8],
        [1, 9],
        [2, 10],
      ] as const) {
        const probe = await lspRequest(socket, id, 'textDocument/definition', {
          textDocument: { uri: consumerUri },
          position: { line, character: line === 0 ? 12 : line === 1 ? 17 : 3 },
        });
        assert.ok(!probe.error, JSON.stringify(probe.error));
        definitions.push(probe.result);
      }
      assert.ok(definitions[0], 'Godot did not locate the real cross-file class declaration');
      assert.deepEqual(
        definitions[1],
        definitions[0],
        'This Godot version unexpectedly stopped resolving the string literal as a class declaration',
      );
      assert.deepEqual(
        definitions[2],
        definitions[0],
        'This Godot version unexpectedly stopped resolving the comment as a class declaration',
      );
      const rename = await lspRequest(socket, 6, 'textDocument/rename', {
        textDocument: { uri },
        position: { line: 1, character: 15 },
        newName: 'SemanticProbeNew',
      });
      assert.ok(!rename.error, JSON.stringify(rename.error));
      assert.ok(rename.result && typeof rename.result === 'object');
      assert.ok('changes' in rename.result || 'documentChanges' in rename.result);
      const classReview = await reviewGodotRenameEdit(
        fixture.root,
        rename.result as GodotWorkspaceEdit,
        'SemanticProbe',
        'SemanticProbeNew',
      );
      assert.equal(classReview.refactorSafe, false);
      assert.equal(classReview.analysisLevel, 'lexical-review');
      assert.ok(classReview.codeLocations.length >= 2);
      assert.deepEqual(classReview.manualReview.map((item) => item.reason).sort(), ['comment', 'string']);
      assert.equal(classReview.editCount, classReview.codeLocations.length + classReview.manualReview.length);
      assert.equal(classReview.fileSnapshots.length, 2);
      assert.ok(classReview.fileSnapshots.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)));
      const classImpact = await reviewRenameImpact(fixture.root, 'SemanticProbe', classReview);
      assert.equal(classImpact.analysisLevel, 'lexical-impact-review');
      assert.equal(classImpact.refactorSafe, false);
      assert.equal(classImpact.matchedCodeLocations, classReview.codeLocations.length);
      assert.deepEqual(classImpact.sceneScriptPaths, [
        { scenePath: 'probe_scene.tscn', scriptPath: 'res://semantic_probe.gd', line: 2 },
      ]);
      assert.ok(
        classImpact.manualReview.some(
          (item) => item.path === 'probe_scene.tscn' && item.reason === 'serialized_scene_or_resource',
        ),
      );
      assert.ok(classImpact.manualReview.some((item) => item.reason === 'string'));
      assert.ok(classImpact.manualReview.some((item) => item.reason === 'comment'));
      const scenePath = path.join(fixture.root, 'probe_scene.tscn');
      const originalScene = await readFile(scenePath, 'utf8');
      await writeFile(scenePath, originalScene.replace('res://semantic_probe.gd', 'res://missing_script.gd'));
      try {
        await assert.rejects(
          reviewRenameImpact(fixture.root, 'SemanticProbe', classReview),
          /script path cannot be verified/,
        );
      } finally {
        await writeFile(scenePath, originalScene);
      }
      await assert.rejects(
        reviewRenameImpact(fixture.root, 'SemanticProbe', {
          ...classReview,
          fileSnapshots: classReview.fileSnapshots.map((item, index) =>
            index === 0 ? { ...item, sha256: '0'.repeat(64) } : item,
          ),
        }),
        /source changed/,
      );
      const stringLocation = classReview.manualReview.find((item) => item.reason === 'string');
      assert.ok(stringLocation);
      await assert.rejects(
        reviewGodotRenameEdit(
          fixture.root,
          {
            changes: {
              [pathToFileURL(path.join(fixture.root, stringLocation.path)).href]: [
                { range: stringLocation.range, newText: 'SemanticProbeNew' },
              ],
            },
          },
          'SemanticProbe',
          'SemanticProbeNew',
        ),
        /no code candidates/,
      );
      await assert.rejects(
        reviewGodotRenameEdit(
          fixture.root,
          {
            changes: {
              [pathToFileURL(path.join(path.dirname(fixture.root), 'outside.gd')).href]: [
                { range: stringLocation.range, newText: 'SemanticProbeNew' },
              ],
            },
          },
          'SemanticProbe',
          'SemanticProbeNew',
        ),
        /inside projectPath/,
      );
      await assert.rejects(
        preflightGodotRename(fixture.root, rename.result as GodotWorkspaceEdit, 'SemanticProbe', 'SemanticProbeNew'),
        /string or comment/,
      );
      const localRename = await lspRequest(socket, 7, 'textDocument/rename', {
        textDocument: { uri },
        position: { line: 3, character: 5 },
        newName: 'points',
      });
      assert.ok(!localRename.error, JSON.stringify(localRename.error));
      safePreview = await preflightGodotRename(
        fixture.root,
        localRename.result as GodotWorkspaceEdit,
        'score',
        'points',
      );
      assert.deepEqual(safePreview.editedFiles, ['semantic_probe.gd']);
      assert.equal(safePreview.editCount, 2);
      assert.match(await readFile(path.join(fixture.root, 'semantic_probe.gd'), 'utf8'), /var score/);
      const decoyUri = pathToFileURL(path.join(fixture.root, 'local_decoy.gd')).href;
      const decoySource = await readFile(path.join(fixture.root, 'local_decoy.gd'), 'utf8');
      lspNotify(socket, 'textDocument/didOpen', {
        textDocument: { uri: decoyUri, languageId: 'gdscript', version: 1, text: decoySource },
      });
      const decoyRename = await lspRequest(socket, 11, 'textDocument/rename', {
        textDocument: { uri: decoyUri },
        position: { line: 1, character: 6 },
        newName: 'points',
      });
      assert.ok(!decoyRename.error, JSON.stringify(decoyRename.error));
      const decoyEdit = decoyRename.result as GodotWorkspaceEdit;
      const decoyEdits = Object.entries(decoyEdit.changes ?? {}).find(
        ([uri]) =>
          path.resolve(fileURLToPath(uri)).toLowerCase() === path.resolve(fileURLToPath(decoyUri)).toLowerCase(),
      )?.[1];
      assert.deepEqual(
        decoyEdits?.map((item) => item.range.start.line),
        [1, 2, 3, 5],
        'Godot unexpectedly stopped including local string/comment decoys in rename',
      );
      await assert.rejects(preflightGodotRename(fixture.root, decoyEdit, 'score', 'points'), /string or comment/);
      const decoyReview = await reviewGodotRenameEdit(fixture.root, decoyEdit, 'score', 'points');
      assert.equal(decoyReview.codeLocations.length, 2);
      assert.deepEqual(decoyReview.manualReview.map((item) => item.reason).sort(), ['comment', 'string']);
      assert.equal(decoyReview.refactorSafe, false);
      const decoyImpact = await reviewRenameImpact(fixture.root, 'score', decoyReview);
      assert.ok(decoyImpact.manualReview.some((item) => item.reason === 'unmapped_code'));
      assert.equal(await readFile(path.join(fixture.root, 'local_decoy.gd'), 'utf8'), decoySource);
      const ambiguousUri = pathToFileURL(path.join(fixture.root, 'ambiguous.gd')).href;
      const ambiguousSource = await readFile(path.join(fixture.root, 'ambiguous.gd'), 'utf8');
      lspNotify(socket, 'textDocument/didOpen', {
        textDocument: { uri: ambiguousUri, languageId: 'gdscript', version: 1, text: ambiguousSource },
      });
      const ambiguousRename = await lspRequest(socket, 12, 'textDocument/rename', {
        textDocument: { uri: ambiguousUri },
        position: { line: 2, character: 8 },
        newName: 'points',
      });
      assert.ok(!ambiguousRename.error, JSON.stringify(ambiguousRename.error));
      const ambiguousEdit = ambiguousRename.result as GodotWorkspaceEdit;
      const ambiguousEdits = Object.entries(ambiguousEdit.changes ?? {}).find(
        ([uri]) =>
          path.resolve(fileURLToPath(uri)).toLowerCase() === path.resolve(fileURLToPath(ambiguousUri)).toLowerCase(),
      )?.[1];
      assert.deepEqual(
        ambiguousEdits?.map((item) => item.range.start.line),
        [2, 3],
        'Godot rename must not include a separate local variable with the same name',
      );
      const ambiguousPreview = await preflightGodotRename(fixture.root, ambiguousEdit, 'score', 'points');
      assert.equal(ambiguousPreview.editCount, 2);
      assert.equal(ambiguousPreview.operations[0]?.kind, 'replace');
      if (ambiguousPreview.operations[0]?.kind !== 'replace') throw new Error('missing local rename candidate');
      assert.equal(typeof ambiguousPreview.operations[0].content, 'string');
      if (typeof ambiguousPreview.operations[0].content !== 'string') throw new Error('binary rename candidate');
      assert.match(ambiguousPreview.operations[0].content, /var points: int = 1/);
      assert.match(ambiguousPreview.operations[0].content, /var score: int = 2/);
      const brokenUri = pathToFileURL(path.join(fixture.root, 'broken.gd')).href;
      const diagnosticEvent = lspDiagnostics(socket);
      lspNotify(socket, 'textDocument/didOpen', {
        textDocument: {
          uri: brokenUri,
          languageId: 'gdscript',
          version: 1,
          text: 'extends Node\nfunc broken(\n    pass\n',
        },
      });
      assert.ok((await diagnosticEvent).diagnostics);
    } finally {
      socket?.destroy();
      await fixture.stop();
    }
    // Only this disposable fixture: its stopped editor leaves connector metadata
    // behind, which must not be mistaken for a live document during file validation.
    await unlink(path.join(fixture.root, '.harness/editor-endpoint.json'));
    await writeFile(path.join(fixture.root, 'broken.gd'), 'extends Node\nfunc broken(\n    pass\n');
    const fixtureGodot = path.join(fixture.root, '.harness/engine', path.basename(process.env.GODOT_PATH!));
    const checked = spawnSync(
      fixtureGodot,
      ['--headless', '--path', fixture.root, '--script', 'res://broken.gd', '--check-only'],
      { windowsHide: true, encoding: 'utf8', timeout: 15000 },
    );
    assert.notEqual(checked.status, 0, 'Godot accepted malformed GDScript');
    assert.match(`${checked.stdout}\n${checked.stderr}`, /Parse Error|Parser Error|SCRIPT ERROR/i);
    await writeFile(path.join(fixture.root, 'broken.gd'), 'extends Node\n');
    assert.ok(safePreview);
    const candidates = safePreview.operations.map((operation) => {
      if (operation.kind !== 'replace') throw new Error('rename preview contained a non-replacement');
      return { path: operation.path, content: operation.content, expectedSha256: operation.expectedSha256 };
    });
    const committed = await writeValidatedProjectFiles(fixture.root, candidates, {
      godotPath: fixtureGodot,
      ownerId: 'test-only-semantic-review',
      intent: 'TEST ONLY: preflighted local variable rename; human approval is MOCK',
      verifyApproval: async (plan) => ({ actor: 'test-only-mock', receipt: 'mock', planHash: plan.planHash }),
    });
    assert.equal(committed.validation, 'PASS');
    assert.equal(committed.transactionState, 'COMMITTED');
    const committedSource = await readFile(path.join(fixture.root, 'semantic_probe.gd'), 'utf8');
    assert.match(committedSource, /var points: int/);
    await assert.rejects(
      writeValidatedProjectFiles(
        fixture.root,
        [
          {
            path: 'semantic_probe.gd',
            content: committedSource.replace('    points += 1', '    points += '),
            expectedSha256: createHash('sha256').update(committedSource).digest('hex'),
          },
        ],
        {
          godotPath: fixtureGodot,
          ownerId: 'test-only-semantic-review',
          intent: 'TEST ONLY: reject invalid semantic patch before touching originals',
          verifyApproval: async (plan) => ({ actor: 'test-only-mock', receipt: 'mock', planHash: plan.planHash }),
        },
      ),
      { code: 'VALIDATION_FAILED' },
    );
    assert.equal(await readFile(path.join(fixture.root, 'semantic_probe.gd'), 'utf8'), committedSource);
    await assert.rejects(
      () => writeValidatedProjectFiles(fixture.root, candidates, { godotPath: fixtureGodot }),
      /SHA-256|hash|conflict|changed/i,
    );
  },
);

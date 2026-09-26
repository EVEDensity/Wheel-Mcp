import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';
import { saveEditorScene } from '../src/editor/scene-save.js';
import { fixtureApproval } from './helpers/project-approval.js';
import { EditorBridge } from '../src/editor/editor-bridge.js';
const real = { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 120000 };
test(
  'post-commit notification fault reports persisted disk and unobserved synchronization, not rollback',
  real,
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, { writeEnabled: true });
    const original = EditorBridge.prototype.sceneRequest;
    // Explicit MOCK notification fault; the export, engine validation and disk commit remain real.
    EditorBridge.prototype.sceneRequest = async function (...args: Parameters<typeof original>) {
      if (args[0] === 'scene.notify') throw new Error('injected post-commit connection loss');
      return original.apply(this, args);
    };
    try {
      const saved = await saveEditorScene({
        projectPath: f.root,
        ownerId: 'local-client',
        verifyApproval: fixtureApproval,
      });
      assert.equal(saved.persisted, true);
      assert.equal(saved.transactionState, 'COMMITTED');
      assert.equal(saved.synchronization.status, 'NOT_OBSERVED');
      assert.match(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), /node name="Marker"/);
    } finally {
      EditorBridge.prototype.sceneRequest = original;
      await f.stop();
    }
  },
);
const data = (r: Awaited<ReturnType<Awaited<ReturnType<typeof wireEditor>>['call']>>) =>
  r.structuredContent as Record<string, any>;
test(
  'official MCP native scene save validates, commits exact bytes and observes filesystem without dropping history',
  real,
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, { writeEnabled: true });
    const c = await wireEditor(f.root);
    try {
      const a = await c.call('apply_editor_scene', {
        operations: [{ kind: 'create', parent: '.', name: 'SavedMarker', type: 'Marker2D' }],
      });
      assert.notEqual(a.isError, true, JSON.stringify(a));
      const saved = await c.call('save_editor_scene', { operationId: 'save-one' });
      assert.notEqual(saved.isError, true, JSON.stringify(saved));
      assert.equal(data(saved).validation, 'PASS');
      assert.equal(data(saved).persisted, true);
      assert.equal(data(saved).synchronization.observed, true);
      assert.equal(data(saved).dirtyState, 'RETAINED');
      const file = await readFile(path.join(f.root, 'main.tscn'), 'utf8');
      assert.match(file, /SavedMarker/);
      await f.command('undo');
      const state = await c.call('get_editor_state');
      assert.ok(!data(state).sceneTree.nodes.some((n: any) => n.path === 'SavedMarker'));
      assert.ok(
        data(state).dirty.scenes.includes('res://main.tscn'),
        'Saved-then-undone live scene must not be mistaken for disk-clean',
      );
      assert.deepEqual(data(state).dirty.nativeSaveConflicts, ['res://main.tscn']);
      const refused = await c.call('write_scene_file', {
        scenePath: 'main.tscn',
        content: file + '; forbidden overwrite\n',
      });
      assert.equal(data(refused).code, 'CONFLICT');
      assert.equal(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), file);
      assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
    } finally {
      await c.close();
      await f.stop();
    }
  },
);
test(
  'native save refuses missing run scope, declined approval and concurrent live/document disk changes',
  real,
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, { writeEnabled: true });
    try {
      const noRun = await wireEditor(f.root, { scopes: ['read', 'write'] });
      try {
        assert.equal(data(await noRun.call('save_editor_scene')).code, 'FORBIDDEN');
      } finally {
        await noRun.close();
      }
      const decline = await wireEditor(f.root, { approval: async () => ({ action: 'decline' }) });
      try {
        assert.equal(data(await decline.call('save_editor_scene')).code, 'FORBIDDEN');
      } finally {
        await decline.close();
      }
      await assert.rejects(
        saveEditorScene({
          projectPath: f.root,
          ownerId: 'local-client',
          operationId: 'human-change',
          verifyApproval: async (p) => {
            await f.command('human-move');
            return fixtureApproval(p);
          },
        }),
        { code: 'CONFLICT' },
      );
      assert.equal(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), f.scene);
      const preserved = f.scene + '; human file change\n';
      await assert.rejects(
        saveEditorScene({
          projectPath: f.root,
          ownerId: 'local-client',
          operationId: 'disk-change',
          verifyApproval: async (p) => {
            await writeFile(path.join(f.root, 'main.tscn'), preserved);
            return fixtureApproval(p);
          },
        }),
        { code: 'CONFLICT' },
      );
      assert.equal(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), preserved);
    } finally {
      await f.stop();
    }
  },
);
test(
  'editor closure and save I/O failure leave originals intact; raw retry cannot overwrite later human changes',
  real,
  async () => {
    const f = await startEditorFixture(process.env.GODOT_PATH!, { writeEnabled: true });
    try {
      await assert.rejects(
        saveEditorScene({
          projectPath: f.root,
          ownerId: 'local-client',
          operationId: 'io-failure',
          verifyApproval: fixtureApproval,
          beforeApply: async () => {
            throw new Error('injected storage failure before replacement');
          },
        }),
        /storage failure/,
      );
      assert.equal(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), f.scene);
      await assert.rejects(
        saveEditorScene({
          projectPath: f.root,
          ownerId: 'local-client',
          operationId: 'closed-editor',
          verifyApproval: async (p) => {
            await f.stop();
            return fixtureApproval(p);
          },
        }),
      );
      assert.equal(await readFile(path.join(f.root, 'main.tscn'), 'utf8'), f.scene);
    } finally {
      await f.stop();
    }
    const { writeValidatedProjectText } = await import('../src/project/validated-write.js');
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-raw-retry-'));
    const options = {
      operationId: 'raw-retry',
      expectedSha256: null,
      validationMode: 'raw' as const,
      verifyApproval: fixtureApproval,
    };
    await writeValidatedProjectText(root, 'raw.txt', 'approved', options);
    await writeFile(path.join(root, 'raw.txt'), 'human');
    await assert.rejects(writeValidatedProjectText(root, 'raw.txt', 'approved', options), { code: 'CONFLICT' });
    assert.equal(await readFile(path.join(root, 'raw.txt'), 'utf8'), 'human');
  },
);

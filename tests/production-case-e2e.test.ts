import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';
import { caseComponent, caseDigest, caseScene, nodeProductionCases } from './helpers/production-cases.js';

const controller = `@tool
extends EditorPlugin
const Core = preload("res://addons/wheel_mcp/scene_service.gd")
func _enter_tree() -> void: set_process(true)
func _process(_delta: float) -> void:
\tvar root := EditorInterface.get_edited_scene_root()
\tif root == null or not FileAccess.file_exists("res://.harness/fixture-command.json"): return
\tvar c: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://.harness/fixture-command.json"))
\tDirAccess.remove_absolute(ProjectSettings.globalize_path("res://.harness/fixture-command.json"))
\tvar manager := get_undo_redo()
\tvar history := manager.get_history_undo_redo(manager.get_object_history_id(root))
\tif c.action == "undo": history.undo()
\tif c.action == "redo": history.redo()
\tvar file := FileAccess.open("res://.harness/fixture-result.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify({"id": c.id, "document": Core.document(root)}))
\tfile.close()
\tif c.action == "quit": get_tree().call_deferred("quit")
`;
function documentShape(document: Record<string, any>) {
  assert.ok(Array.isArray(document.nodes), JSON.stringify(document));
  const paths = new Map(document.nodes.map((node: any) => [node.id, node.path]));
  return document.nodes.map((node: any) => ({
    path: node.path,
    type: node.type,
    name: node.name,
    owner: paths.get(node.owner) ?? null,
    properties: node.properties,
    signals: node.signals.map((signal: any) => ({ ...signal, target: paths.get(signal.target) })),
    instanceSource: node.instanceSource ?? null,
    instanceHash: node.instanceHash ?? null,
  }));
}
for (const definition of nodeProductionCases()) {
  test(
    `T29 ${definition.id} fixed native nodes chain, illegal control, undo/redo and saved reopen`,
    { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 120000 },
    async () => {
      const frozen = structuredClone(definition);
      const oracleHash = caseDigest(
        JSON.stringify({ frozen, caseScene, caseComponent, godot: '4.7.2', timeoutMs: 120000, approval: 'MOCK' }),
      );
      const reportRoot = process.env.WHEEL_CASE_REPORT_DIR ?? path.join(os.tmpdir(), 'wheel-case-reports');
      const report = {
        caseId: frozen.id,
        family: frozen.family,
        source: 'REAL',
        approval: 'MOCK',
        transport: 'official SDK InMemoryTransport',
        oracleHash,
        sourceHash: process.env.WHEEL_CASE_SOURCE_HASH ?? 'NOT_BOUND',
        status: 'FAIL',
        cleanup: false,
        checks: [] as string[],
        calls: [] as unknown[],
        error: undefined as string | undefined,
      };
      let fixture: Awaited<ReturnType<typeof startEditorFixture>> | undefined;
      let connection: Awaited<ReturnType<typeof wireEditor>> | undefined;
      let fixtureLive = false;
      let failure: unknown;
      try {
        fixture = await startEditorFixture(process.env.GODOT_PATH!, {
          controller,
          scene: caseScene,
          files: { 'component.tscn': caseComponent },
          writeEnabled: true,
        });
        fixtureLive = true;
        connection = await wireEditor(fixture.root, { scopes: frozen.scopes });
        const call = async (name: string, args: Record<string, unknown> = {}, expectedCode?: string) => {
          const reply = await connection!.call(name, args);
          report.calls.push({ name, args, result: reply });
          if (expectedCode) {
            assert.equal(reply.isError, true, JSON.stringify(reply));
            assert.equal((reply.structuredContent as any).code, expectedCode);
          } else assert.notEqual(reply.isError, true, JSON.stringify(reply));
          return reply.structuredContent as any;
        };
        const original = documentShape((await fixture.command('inspect')).document);
        const readOnly = await wireEditor(fixture.root, { scopes: ['read'] });
        try {
          const denied = await readOnly.call('apply_editor_scene', { operations: frozen.operations });
          report.calls.push({
            name: 'apply_editor_scene',
            scopes: ['read'],
            args: { operations: frozen.operations },
            result: denied,
          });
          assert.equal(denied.isError, true);
          assert.equal((denied.structuredContent as any).code, 'FORBIDDEN');
        } finally {
          await readOnly.close();
        }
        assert.deepEqual(documentShape((await fixture.command('inspect')).document), original);
        report.checks.push('read-only client denied before any document mutation');
        await call('get_editor_state');
        await call(
          'apply_editor_scene',
          { operations: frozen.negative, operationId: frozen.id + '-negative' },
          frozen.negativeCode,
        );
        assert.deepEqual(documentShape((await fixture.command('inspect')).document), original);
        assert.equal(await readFile(path.join(fixture.root, 'main.tscn'), 'utf8'), caseScene);
        report.checks.push('illegal input rejected with exact code; live document and disk unchanged');
        const applied = await call('apply_editor_scene', {
          operations: frozen.operations,
          operationId: frozen.id + '-positive',
        });
        assert.equal(applied.undoSteps, 1);
        assert.equal(applied.persisted, false);
        const authored = documentShape((await fixture.command('inspect')).document);
        assert.notDeepEqual(authored, original);
        assert.deepEqual(documentShape((await fixture.command('undo')).document), original);
        assert.deepEqual(documentShape((await fixture.command('redo')).document), authored);
        report.checks.push('one native Undo/Redo exactly restores live document');
        const saved = await call('save_editor_scene', { operationId: frozen.id + '-save' });
        assert.equal(saved.validation, 'PASS');
        assert.equal(saved.synchronization.observed, true);
        const bytes = await readFile(path.join(fixture.root, 'main.tscn'), 'utf8');
        for (const fragment of frozen.savedFragments) assert.ok(bytes.includes(fragment), fragment + '\n' + bytes);
        assert.equal(await readFile(path.join(fixture.root, 'component.tscn'), 'utf8'), caseComponent);
        const root = fixture.root;
        await connection.close();
        connection = undefined;
        await fixture.command('quit');
        await fixture.exited;
        fixtureLive = false;
        assert.doesNotMatch(fixture.output(), /SCRIPT ERROR|\bERROR:|ObjectDB instances leaked|resources still in use/);
        fixture = await startEditorFixture(process.env.GODOT_PATH!, {
          controller,
          writeEnabled: true,
          existingRoot: root,
        });
        fixtureLive = true;
        connection = await wireEditor(root, { scopes: frozen.scopes });
        const reopened = await call('get_editor_state');
        for (const expected of frozen.expectedPaths)
          assert.ok(
            reopened.sceneTree.nodes.some((node: any) => node.path === expected),
            expected,
          );
        for (const absent of frozen.absentPaths)
          assert.ok(!reopened.sceneTree.nodes.some((node: any) => node.path === absent), absent);
        assert.deepEqual(documentShape((await fixture.command('inspect')).document), authored);
        assert.equal(reopened.dirty.scenes.length, 0);
        assert.equal(await readFile(path.join(root, 'main.tscn'), 'utf8'), bytes);
        report.checks.push('native save validation, same-project reopen and exact readback');
        report.status = 'PASS';
      } catch (error) {
        report.error = error instanceof Error ? error.message.slice(0, 8192) : String(error);
        failure = error;
      } finally {
        try {
          await connection?.close();
          if (fixture && fixtureLive) {
            await fixture.command('quit');
            await fixture.exited;
            fixtureLive = false;
          }
          if (fixture)
            assert.doesNotMatch(
              fixture.output(),
              /SCRIPT ERROR|\bERROR:|ObjectDB instances leaked|resources still in use/,
            );
          report.cleanup = true;
        } catch (error) {
          report.status = 'FAIL';
          report.error = String(error);
          failure ??= error;
          await fixture?.stop();
        } finally {
          await mkdir(reportRoot, { recursive: true });
          await writeFile(path.join(reportRoot, frozen.id + '.json'), JSON.stringify(report, null, 2));
        }
      }
      if (failure) throw failure;
    },
  );
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { compareScreenshots } from '../../src/godot-development.js';
import { startEditorFixture } from './editor-fixture.js';
import { wireEditor, productionCaseTransportLabel } from './editor-mcp.js';
import { caseDigest, type ExtendedProductionCase } from './production-cases.js';

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
\tif c.action == "share-animation":
\t\tvar first := AnimationPlayer.new()
\t\tfirst.name = "First"
\t\troot.add_child(first)
\t\tfirst.owner = root
\t\tvar second := AnimationPlayer.new()
\t\tsecond.name = "Second"
\t\troot.add_child(second)
\t\tsecond.owner = root
\t\tvar clip := Animation.new()
\t\tvar track := clip.add_track(Animation.TYPE_VALUE)
\t\tclip.track_set_path(track, NodePath("Hero:position"))
\t\tclip.track_insert_key(track, 0.0, Vector2.ZERO)
\t\tclip.set_meta("wheel_track_ids", PackedStringArray(["position"]))
\t\tvar library := AnimationLibrary.new()
\t\tlibrary.add_animation("idle", clip)
\t\tfirst.add_animation_library("wheel", library)
\t\tsecond.add_animation_library("wheel", library)
\tvar file := FileAccess.open("res://.harness/fixture-result.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify({"id": c.id, "document": Core.document(root)}))
\tfile.close()
\tif c.action == "quit": get_tree().call_deferred("quit")
`;

function authoredValue(value: any): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !value.resourceType) return value;
  return { resourceType: value.resourceType, properties: value.properties, storage: value.storage };
}
function documentShape(document: Record<string, any>) {
  assert.ok(Array.isArray(document.nodes), JSON.stringify(document));
  const paths = new Map(document.nodes.map((node: any) => [node.id, node.path]));
  return document.nodes.map((node: any) => ({
    path: node.path,
    type: node.type,
    name: node.name,
    owner: paths.get(node.owner) ?? null,
    properties: Object.fromEntries(Object.entries(node.properties).map(([key, value]) => [key, authoredValue(value)])),
    signals: node.signals.map((signal: any) => ({ ...signal, target: paths.get(signal.target) })),
    instanceSource: node.instanceSource ?? null,
    instanceHash: node.instanceHash ?? null,
  }));
}

function contained(base: string, relative: string) {
  if (relative === '' || relative.includes('..') || path.isAbsolute(relative))
    throw new Error(`Production path escaped its root: ${relative}`);
  const root = path.resolve(base);
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep))
    throw new Error(`Production path escaped its root: ${relative}`);
  return resolved;
}

function materialize(value: unknown, binds: Map<string, unknown>, root: string): unknown {
  if (Array.isArray(value)) return value.map((item) => materialize(item, binds, root));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length === 1 && keys[0] === 'bind' && typeof record.bind === 'string') {
    if (!binds.has(record.bind)) throw new Error(`Unbound production reference: ${record.bind}`);
    return structuredClone(binds.get(record.bind));
  }
  if (keys.length === 1 && keys[0] === 'rootRelative' && typeof record.rootRelative === 'string')
    return contained(root, record.rootRelative);
  if (keys.length === 1 && keys[0] === 'repoFile' && typeof record.repoFile === 'string')
    return contained(process.cwd(), record.repoFile);
  if (
    keys.join(',') === 'bind,mutateField,mutateValue' &&
    typeof record.bind === 'string' &&
    typeof record.mutateField === 'string'
  ) {
    if (!binds.has(record.bind)) throw new Error(`Unbound production reference: ${record.bind}`);
    const copy = structuredClone(binds.get(record.bind)) as Record<string, unknown>;
    copy[record.mutateField] = record.mutateValue;
    return copy;
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, materialize(item, binds, root)]));
}

function readPath(value: unknown, dotted: string) {
  return dotted.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

async function invokeStep(
  connection: Awaited<ReturnType<typeof wireEditor>>,
  step: ExtendedProductionCase['positive'][number],
  binds: Map<string, unknown>,
  root: string,
  calls: unknown[],
  command?: (action: string) => Promise<unknown>,
) {
  if (step.action === 'fixture') {
    const name = step.args?.name;
    if (!command || typeof name !== 'string') throw new Error('fixture action requires a controller command');
    calls.push({ action: 'fixture', name, result: await command(name) });
    return;
  }
  if (step.action === 'fileIncludes') {
    const file = materialize(step.args?.path, binds, root);
    const fragment = step.args?.fragment;
    if (typeof file !== 'string' || typeof fragment !== 'string')
      throw new Error('fileIncludes needs a path and fragment');
    const text = await readFile(file, 'utf8');
    assert.ok(text.includes(fragment), fragment + '\n' + text.slice(0, 1200));
    calls.push({ action: 'fileIncludes', path: file, fragment });
    return;
  }
  if (step.action === 'hashFile') {
    const file = materialize(step.args?.path, binds, root);
    if (typeof file !== 'string') throw new Error('hashFile path must resolve to a string');
    const hash = createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
    if (!step.bind) throw new Error('hashFile requires a bind name');
    binds.set(step.bind, hash);
    calls.push({ action: 'hashFile', path: file, hash });
    return;
  }
  if (step.action === 'comparePng') {
    const first = materialize(step.args?.first, binds, root);
    const second = materialize(step.args?.second, binds, root);
    if (typeof first !== 'string' || typeof second !== 'string') throw new Error('comparePng paths must resolve');
    const image = await compareScreenshots(first, second, { threshold: 0 });
    const minimum = step.args?.minDifferentPixels;
    if (typeof minimum !== 'number') throw new Error('comparePng requires minDifferentPixels');
    assert.ok(image.differentPixels >= minimum, JSON.stringify(image));
    if (typeof step.args?.stableBind === 'string') {
      const current = createHash('sha256')
        .update(await readFile(first))
        .digest('hex');
      assert.equal(current, binds.get(step.args.stableBind));
    }
    calls.push({
      action: 'comparePng',
      differentPixels: image.differentPixels,
      width: image.width,
      height: image.height,
    });
    return;
  }
  if (!step.tool) throw new Error('Production step has no tool');
  const args = (materialize(step.args ?? {}, binds, root) ?? {}) as Record<string, unknown>;
  let reply: Awaited<ReturnType<Awaited<ReturnType<typeof wireEditor>>['call']>> | undefined;
  try {
    reply = await connection.call(step.tool, args);
  } catch (error) {
    if (step.expectInvalidParams && error instanceof McpError && error.code === ErrorCode.InvalidParams) {
      calls.push({ name: step.tool, args, invalidParams: true });
      return;
    }
    throw error;
  }
  calls.push({ name: step.tool, args, result: reply });
  if (step.expectInvalidParams) {
    const text = JSON.stringify(reply);
    assert.equal(reply.isError, true, text);
    assert.match(text, /Invalid arguments|validation error|InvalidParams/i, text);
    return;
  }
  const body = reply.structuredContent as Record<string, any>;
  if (step.expectMatch) {
    assert.equal(reply.isError, true, JSON.stringify(reply));
    assert.match(JSON.stringify(reply), new RegExp(step.expectMatch), JSON.stringify(reply).slice(0, 2000));
    return;
  }
  if (step.expectCode) {
    assert.equal(reply.isError, true, JSON.stringify(reply));
    assert.equal(body?.code, step.expectCode, JSON.stringify(body));
  } else {
    assert.notEqual(reply.isError, true, JSON.stringify(reply));
  }
  if (step.bind) binds.set(step.bind, step.bindFrom ? readPath(body, step.bindFrom) : body);
  if (step.equals)
    assert.deepEqual(readPath(body, step.equals.path), step.equals.value, JSON.stringify(body).slice(0, 4000));
  if (step.approx) {
    const actual = readPath(body, step.approx.path);
    assert.equal(typeof actual, 'number', JSON.stringify(body).slice(0, 1500));
    assert.ok(
      Math.abs((actual as number) - step.approx.value) <= step.approx.tolerance,
      JSON.stringify({ actual, expected: step.approx.value, tolerance: step.approx.tolerance }),
    );
  }
  if (step.orderedPathSuffixes) {
    const nodes = (readPath(body, 'response.nodes') ?? readPath(body, 'nodes')) as Array<{ path?: string }>;
    assert.ok(Array.isArray(nodes), JSON.stringify(body));
    const paths = nodes.map((node) => node.path ?? '');
    let previous = -1;
    for (const suffix of step.orderedPathSuffixes) {
      const index = paths.findIndex((item) => item === suffix || item.endsWith('/' + suffix));
      assert.ok(index > previous, JSON.stringify({ suffix, paths }));
      previous = index;
    }
  }
}

/** Fixed MCP calls against one real editor. Approval acceptance is an explicit MOCK. */
export async function runExtendedProductionCase(definition: ExtendedProductionCase) {
  const frozen = structuredClone(definition);
  const oracleHash = caseDigest(JSON.stringify({ frozen, godot: '4.7.2', timeoutMs: 180000, approval: 'MOCK' }));
  const reportRoot = process.env.WHEEL_CASE_REPORT_DIR ?? path.join(os.tmpdir(), 'wheel-case-reports');
  const report = {
    caseId: frozen.id,
    family: frozen.family,
    source: 'REAL',
    approval: 'MOCK',
    transport: productionCaseTransportLabel(),
    oracleHash,
    sourceHash: process.env.WHEEL_CASE_SOURCE_HASH ?? 'NOT_BOUND',
    status: 'FAIL',
    cleanup: false,
    checks: [] as string[],
    calls: [] as unknown[],
    error: undefined as string | undefined,
  };
  const binds = new Map<string, unknown>();
  let fixture: Awaited<ReturnType<typeof startEditorFixture>> | undefined;
  let connection: Awaited<ReturnType<typeof wireEditor>> | undefined;
  let fixtureLive = false;
  let failure: unknown;
  try {
    fixture = await startEditorFixture(process.env.GODOT_PATH!, {
      controller,
      scene: frozen.scene,
      files: frozen.files,
      writeEnabled: true,
    });
    fixtureLive = true;
    const root = fixture.root;
    connection = await wireEditor(root, { scopes: frozen.scopes });
    const original = documentShape((await fixture.command('inspect')).document);
    const originalBytes = await readFile(path.join(root, 'main.tscn'), 'utf8');
    const readOnly = await wireEditor(root, { scopes: ['read'] });
    try {
      if (!frozen.denial.tool) throw new Error('Read-only denial requires an MCP tool');
      const deniedArgs = (materialize(frozen.denial.args ?? {}, binds, root) ?? {}) as Record<string, unknown>;
      const denied = await readOnly.call(frozen.denial.tool, deniedArgs);
      report.calls.push({ name: frozen.denial.tool, scopes: ['read'], args: deniedArgs, result: denied });
      assert.equal(denied.isError, true, JSON.stringify(denied));
      assert.equal((denied.structuredContent as { code?: string })?.code, 'FORBIDDEN');
    } finally {
      await readOnly.close();
    }
    assert.deepEqual(documentShape((await fixture.command('inspect')).document), original);
    report.checks.push('read-only client denied before any document mutation');
    for (const step of frozen.negative)
      await invokeStep(connection, step, binds, root, report.calls, (action) => fixture!.command(action));
    assert.equal(await readFile(path.join(root, 'main.tscn'), 'utf8'), originalBytes);
    if (frozen.restartAfterNegative) {
      await connection.close();
      connection = undefined;
      await fixture.command('quit');
      await fixture.exited;
      fixtureLive = false;
      fixture = await startEditorFixture(process.env.GODOT_PATH!, {
        controller,
        writeEnabled: true,
        existingRoot: root,
      });
      fixtureLive = true;
      connection = await wireEditor(root, { scopes: frozen.scopes });
      assert.deepEqual(documentShape((await fixture.command('inspect')).document), original);
    } else assert.deepEqual(documentShape((await fixture.command('inspect')).document), original);
    report.checks.push('illegal input rejected; live document and disk unchanged');
    binds.clear();
    let beforeApply = original;
    let authored = original;
    let applied = false;
    for (const step of frozen.positive) {
      if (step.tool === 'apply_editor_scene') beforeApply = documentShape((await fixture.command('inspect')).document);
      await invokeStep(connection, step, binds, root, report.calls);
      if (step.tool === 'apply_editor_scene' && !step.expectCode && !step.expectInvalidParams) {
        authored = documentShape((await fixture.command('inspect')).document);
        applied = true;
      }
    }
    if (frozen.undo) {
      if (!applied) throw new Error('Undo requires a successful scene batch');
      assert.notDeepEqual(authored, beforeApply);
      assert.deepEqual(documentShape((await fixture.command('undo')).document), beforeApply);
      assert.deepEqual(documentShape((await fixture.command('redo')).document), authored);
      report.checks.push('one native Undo/Redo exactly restores the live document');
    }
    const saved = await connection.call('save_editor_scene', { operationId: frozen.id + '-save' });
    report.calls.push({ name: 'save_editor_scene', result: saved });
    assert.notEqual(saved.isError, true, JSON.stringify(saved));
    assert.equal((saved.structuredContent as { validation?: string }).validation, 'PASS');
    const bytes = await readFile(path.join(root, 'main.tscn'), 'utf8');
    for (const fragment of frozen.savedFragments) assert.ok(bytes.includes(fragment), fragment + '\n' + bytes);
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
    const reopenedReply = await connection.call('get_editor_state');
    assert.notEqual(reopenedReply.isError, true, JSON.stringify(reopenedReply));
    const reopened = reopenedReply.structuredContent as {
      sceneTree: { nodes: Array<{ path: string }> };
      dirty: { scenes: unknown[] };
    };
    report.calls.push({ name: 'get_editor_state', result: reopened });
    for (const expected of frozen.expectedPaths)
      assert.ok(
        reopened.sceneTree.nodes.some((node) => node.path === expected),
        expected,
      );
    for (const absent of frozen.absentPaths)
      assert.ok(!reopened.sceneTree.nodes.some((node) => node.path === absent), absent);
    assert.deepEqual(documentShape((await fixture.command('inspect')).document), authored);
    assert.equal(reopened.dirty.scenes.length, 0);
    assert.equal(await readFile(path.join(root, 'main.tscn'), 'utf8'), bytes);
    report.checks.push('native save validation, same-project reopen and exact readback');
    await connection.close();
    connection = undefined;
    await fixture.command('quit');
    await fixture.exited;
    fixtureLive = false;
    if (frozen.runtime) {
      connection = await wireEditor(root, { scopes: frozen.scopes });
      for (const step of frozen.runtime) await invokeStep(connection, step, binds, root, report.calls);
      report.checks.push('native runtime readback completed and input/cache controls held');
      await connection.close();
      connection = undefined;
    }
    report.status = 'PASS';
  } catch (error) {
    report.error = error instanceof Error ? error.message.slice(0, 8192) : String(error);
    failure = error;
  } finally {
    try {
      const session = binds.get('session');
      if (typeof session === 'string' && connection)
        await connection.call('stop_runtime_bridge', { sessionId: session }).catch(() => undefined);
      await connection?.close();
      if (fixture && fixtureLive) {
        await fixture.command('quit');
        await fixture.exited;
        fixtureLive = false;
      }
      if (fixture)
        assert.doesNotMatch(fixture.output(), /SCRIPT ERROR|\bERROR:|ObjectDB instances leaked|resources still in use/);
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
}

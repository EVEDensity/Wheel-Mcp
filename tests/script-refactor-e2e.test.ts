import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { GodotLspClient } from '../src/project/godot-lsp-client.js';
import { ProjectTransactions } from '../src/project/transactions.js';
import { validateCandidateFiles } from '../src/project/validated-write.js';
import { snapshotProject } from '../src/project-snapshot.js';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';

const base = `extends Node
class_name RefactorProbe
enum Mode { IDLE, RUN }
func compute(
    amount: int
) -> int:
    var current: Mode = Mode.RUN
    return amount + current + 1
`;
const consumer = `extends RefactorProbe
var typed_self: RefactorProbe
@export var focus: NodePath
func probe_value() -> int:
    typed_self = self
    return typed_self.compute(40)
`;
const scene = `[gd_scene load_steps=2 format=3]
[ext_resource type="Script" path="res://consumer.gd" id="1"]
[node name="Probe" type="Node"]
script = ExtResource("1")
focus = NodePath("Marker")
[node name="Marker" type="Node" parent="."]
`;
const oracle = `extends SceneTree
func _initialize() -> void:
    var packed: PackedScene = load("res://refactor_scene.tscn")
    if packed == null:
        quit(2)
        return
    var node: Node = packed.instantiate()
    if node == null:
        quit(2)
        return
    var value: int = node.call("probe_value")
    var target: Node = node.get_node_or_null(node.get("focus"))
    var expected: int = int(OS.get_environment("WHEEL_REFACTOR_EXPECTED"))
    var passed: bool = value == expected and target != null
    var output := FileAccess.open(OS.get_environment("WHEEL_REFACTOR_OUTPUT"), FileAccess.WRITE)
    if output == null:
        node.free()
        quit(2)
        return
    output.store_string(JSON.stringify({"passed": passed, "value": value, "nodePathValid": target != null}))
    output.close()
    node.free()
    quit(0 if passed else 3)
`;

async function freePort(): Promise<number> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    return address.port;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test(
  'T22 backend cross-file class rename runs real scene and atomically rolls back failed runtime oracle',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 180000 },
  async () => {
    const port = await freePort();
    const fixture = await startEditorFixture(process.env.GODOT_PATH!, {
      lspPort: port,
      files: {
        'refactor_probe.gd': base,
        'consumer.gd': consumer,
        'refactor_scene.tscn': scene,
        'oracle.gd': oracle,
        'probe.gd': 'extends Node\n',
      },
    });
    const client = await GodotLspClient.connect({ projectPath: fixture.root, ownerId: 'local-client', lspPort: port });
    let preview: Awaited<ReturnType<GodotLspClient['previewDefinitionCheckedRename']>>;
    try {
      const symbols = await client.query('refactor_probe.gd', 'symbols');
      const symbolText = JSON.stringify(symbols.result);
      assert.match(symbolText, /RefactorProbe/);
      assert.match(symbolText, /Mode/);
      assert.match(symbolText, /compute/);
      await client.query('consumer.gd', 'symbols');
      preview = await client.previewDefinitionCheckedRename(
        'refactor_probe.gd',
        { line: 1, character: 11 },
        'RefactorProbe',
        'RenamedProbe',
      );
      assert.equal(preview.refactorSafe, false);
      assert.equal(preview.definitionCheck, 'PASS');
      assert.equal(preview.checkedCodeLocations, 3);
      assert.deepEqual([...preview.editedFiles].sort(), ['consumer.gd', 'refactor_probe.gd']);
      assert.equal(preview.editCount, 3);
      assert.equal(await readFile(path.join(fixture.root, 'refactor_probe.gd'), 'utf8'), base);
      assert.equal(await readFile(path.join(fixture.root, 'consumer.gd'), 'utf8'), consumer);
      client.close();
      const mcp = await wireEditor(fixture.root, { scopes: ['read'] });
      try {
        const args = {
          scriptPath: 'refactor_probe.gd',
          lspPort: port,
          line: 1,
          character: 11,
          oldName: 'RefactorProbe',
          newName: 'RenamedProbe',
          timeoutMs: 60000,
          responseMode: 'compact',
        };
        const response = await mcp.call('preview_script_rename', args);
        assert.notEqual(response.isError, true, JSON.stringify(response));
        const data = response.structuredContent as Record<string, unknown>;
        assert.equal(data.status, 'PASS');
        assert.equal(data.refactorSafe, false);
        assert.equal(data.definitionCheck, 'PASS');
        assert.equal(data.checkedCodeLocations, 3);
        assert.equal(data.projectSha256, preview.projectSha256);
        assert.deepEqual(data.operations, preview.operations);
        assert.ok(data.impact);
        assert.equal(await readFile(path.join(fixture.root, 'refactor_probe.gd'), 'utf8'), base);
        const outside = await mcp.call('preview_script_rename', { ...args, scriptPath: '../outside.gd' });
        assert.equal(outside.isError, true);
        const mismatch = await mcp.call('preview_script_rename', { ...args, oldName: 'WrongSymbol' });
        assert.equal(mismatch.isError, true);
        await fixture.command('dirty-script');
        const unsaved = await mcp.call('preview_script_rename', args);
        assert.equal(unsaved.isError, true);
        assert.equal((unsaved.structuredContent as Record<string, unknown>).code, 'CONFLICT');
        await fixture.command('undo-script');
      } finally {
        await mcp.close();
      }
    } finally {
      client.close();
      await fixture.stop();
    }
    await unlink(path.join(fixture.root, '.harness/editor-endpoint.json'));
    const executable = path.join(fixture.root, '.harness/engine', path.basename(process.env.GODOT_PATH!));
    const baseline = await snapshotProject(fixture.root);
    const candidates = preview.operations.map((operation) => {
      if (operation.kind !== 'replace') throw new Error('Non-replacement rename candidate');
      return { path: operation.path, content: operation.content, expectedSha256: operation.expectedSha256 };
    });
    const validated = await validateCandidateFiles(fixture.root, candidates, { godotPath: executable });
    assert.equal(validated.validation, 'PASS');
    assert.equal(validated.inputHash, baseline.sha256);
    const runOracle = async (expected: number) => {
      const imported = spawnSync(executable, ['--headless', '--editor', '--import', '--path', fixture.root], {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 30000,
      });
      assert.equal(imported.status, 0, `${imported.stdout}\n${imported.stderr}`);
      assert.doesNotMatch(`${imported.stdout}\n${imported.stderr}`, /SCRIPT ERROR|\bERROR:/);
      const output = path.join(fixture.root, '.harness/refactor-oracle.json');
      await unlink(output).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      const ran = spawnSync(executable, ['--headless', '--path', fixture.root, '--script', 'res://oracle.gd'], {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 15000,
        env: { ...process.env, WHEEL_REFACTOR_EXPECTED: String(expected), WHEEL_REFACTOR_OUTPUT: output },
      });
      assert.doesNotMatch(`${ran.stdout}\n${ran.stderr}`, /SCRIPT ERROR|\bERROR:/);
      const result = JSON.parse(await readFile(output, 'utf8')) as {
        passed: boolean;
        value: number;
        nodePathValid: boolean;
      };
      assert.equal(result.value, 42);
      assert.equal(result.nodePathValid, true);
      assert.equal(ran.status, result.passed ? 0 : 3);
      return result.passed;
    };
    assert.equal(await runOracle(42), true);
    const denied = new ProjectTransactions({
      projectPath: fixture.root,
      ownerId: 'test-denied',
      verifyApproval: async () => null,
    });
    const deniedPlan = await denied.prepare(preview.operations);
    await assert.rejects(denied.approve(deniedPlan.operationId), /denied/);
    assert.equal((await snapshotProject(fixture.root)).sha256, baseline.sha256);
    const tx = new ProjectTransactions({
      projectPath: fixture.root,
      ownerId: 'test-only-refactor',
      intent: 'TEST ONLY: native LSP class rename; approval is MOCK; runtime oracle and rollback required',
      verifyApproval: async (plan) => ({ actor: 'test-only-mock', receipt: 'mock', planHash: plan.planHash }),
      beforeApply: async () => assert.equal((await snapshotProject(fixture.root)).sha256, baseline.sha256),
    });
    const failed = await tx.prepare(preview.operations);
    await tx.approve(failed.operationId);
    assert.equal(await tx.apply(failed.operationId, () => runOracle(9999)), 'ROLLED_BACK');
    assert.equal((await tx.inspect(failed.operationId)).state, 'ROLLED_BACK');
    assert.equal(await readFile(path.join(fixture.root, 'refactor_probe.gd'), 'utf8'), base);
    assert.equal(await readFile(path.join(fixture.root, 'consumer.gd'), 'utf8'), consumer);
    assert.equal(await runOracle(42), true);
    let approvals = 0;
    const writer = await wireEditor(fixture.root, {
      godotPath: executable,
      approval: async (message) => {
        approvals++;
        assert.match(message, new RegExp(baseline.sha256));
        return { action: 'accept', content: { confirm: true } };
      },
    });
    try {
      const stale = await writer.call('write_validated_project_files', {
        godotPath: executable,
        files: candidates,
        expectedProjectSha256: '0'.repeat(64),
        timeoutMs: 90000,
      });
      assert.equal(stale.isError, true);
      assert.equal((stale.structuredContent as Record<string, unknown>).code, 'CONFLICT');
      assert.equal(approvals, 0);
      const written = await writer.call('write_validated_project_files', {
        godotPath: executable,
        files: candidates,
        expectedProjectSha256: preview.projectSha256,
        timeoutMs: 90000,
      });
      assert.notEqual(written.isError, true, JSON.stringify(written));
      const data = written.structuredContent as Record<string, unknown>;
      assert.equal(data.transactionState, 'COMMITTED');
      assert.equal(data.projectInputSha256, preview.projectSha256);
      assert.equal(approvals, 1);
      assert.equal(await runOracle(42), true);
    } finally {
      await writer.close();
    }
    assert.match(await readFile(path.join(fixture.root, 'refactor_probe.gd'), 'utf8'), /class_name RenamedProbe/);
    assert.match(
      await readFile(path.join(fixture.root, 'consumer.gd'), 'utf8'),
      /extends RenamedProbe\nvar typed_self: RenamedProbe/,
    );
    assert.equal(await readFile(path.join(fixture.root, 'refactor_scene.tscn'), 'utf8'), scene);
    await assert.rejects(tx.prepare(preview.operations), /hash|changed|conflict/i);
  },
);

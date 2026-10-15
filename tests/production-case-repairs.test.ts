import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { caseDigest } from './helpers/production-cases.js';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor, productionCaseTransportLabel } from './helpers/editor-mcp.js';
import { repairProductionCases, runRepairProductionCase } from './helpers/production-repair-cases.js';

const probe = `extends Node
class_name RefactorProbe
enum Mode { IDLE, RUN }
func compute(amount: int) -> int:
    var current: Mode = Mode.RUN
    return amount + current + 1
`;
const consumer = `extends RefactorProbe
var typed_self: RefactorProbe
func probe_value() -> int:
    typed_self = self
    return typed_self.compute(40)
`;
const renameScene = `[gd_scene load_steps=2 format=3]
[ext_resource type="Script" path="res://consumer.gd" id="1"]
[node name="Probe" type="Node"]
script = ExtResource("1")
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
  'T29 S05 fixed rename preview, foreign path or symbol rejection, and exact approved write',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 180000 },
  async () => {
    const port = await freePort();
    const fixture = await startEditorFixture(process.env.GODOT_PATH!, {
      lspPort: port,
      scene: renameScene,
      files: { 'refactor_probe.gd': probe, 'consumer.gd': consumer },
      writeEnabled: true,
    });
    const reportRoot = process.env.WHEEL_CASE_REPORT_DIR ?? path.join(os.tmpdir(), 'wheel-case-reports');
    const report = {
      caseId: 'S05',
      family: 'scripts',
      source: 'REAL',
      approval: 'MOCK',
      transport: productionCaseTransportLabel(),
      oracleHash: caseDigest(
        JSON.stringify({ probe, consumer, renameScene, oldName: 'RefactorProbe', newName: 'RenamedProbe' }),
      ),
      sourceHash: process.env.WHEEL_CASE_SOURCE_HASH ?? 'NOT_BOUND',
      status: 'FAIL',
      checks: [] as string[],
      error: undefined as string | undefined,
    };
    const mcp = await wireEditor(fixture.root, { scopes: ['read', 'write', 'run'] });
    const previewArgs = {
      scriptPath: 'refactor_probe.gd',
      lspPort: port,
      line: 1,
      character: 11,
      oldName: 'RefactorProbe',
      newName: 'RenamedProbe',
      timeoutMs: 60000,
    };
    try {
      const preview = await mcp.call('preview_script_rename', previewArgs);
      assert.notEqual(preview.isError, true, JSON.stringify(preview).slice(0, 2000));
      const body = preview.structuredContent as {
        status: string;
        projectSha256: string;
        operations: Array<{ kind: string; path: string; content: string; expectedSha256: string }>;
      };
      assert.equal(body.status, 'PASS');
      assert.equal(await readFile(path.join(fixture.root, 'refactor_probe.gd'), 'utf8'), probe);
      const outside = await mcp.call('preview_script_rename', { ...previewArgs, scriptPath: '../outside.gd' });
      assert.equal(outside.isError, true, JSON.stringify(outside).slice(0, 1000));
      const mismatch = await mcp.call('preview_script_rename', { ...previewArgs, oldName: 'WrongSymbol' });
      assert.equal(mismatch.isError, true, JSON.stringify(mismatch).slice(0, 1000));
      const foreignListener = await mcp.call('preview_script_rename', { ...previewArgs, lspPort: 1, timeoutMs: 5000 });
      assert.equal(foreignListener.isError, true, JSON.stringify(foreignListener).slice(0, 1000));
      assert.equal(await readFile(path.join(fixture.root, 'refactor_probe.gd'), 'utf8'), probe);
      assert.equal(await readFile(path.join(fixture.root, 'consumer.gd'), 'utf8'), consumer);
      const files = body.operations.map((operation) => {
        assert.equal(operation.kind, 'replace');
        return { path: operation.path, content: operation.content, expectedSha256: operation.expectedSha256 };
      });
      const stale = await mcp.call('write_validated_project_files', {
        godotPath: process.env.GODOT_PATH,
        files,
        expectedProjectSha256: '0'.repeat(64),
        timeoutMs: 90000,
      });
      assert.equal(stale.isError, true);
      assert.equal((stale.structuredContent as { code?: string }).code, 'CONFLICT');
      assert.equal(await readFile(path.join(fixture.root, 'refactor_probe.gd'), 'utf8'), probe);
      const written = await mcp.call('write_validated_project_files', {
        godotPath: process.env.GODOT_PATH,
        files,
        expectedProjectSha256: body.projectSha256,
        timeoutMs: 90000,
      });
      assert.notEqual(written.isError, true, JSON.stringify(written).slice(0, 2000));
      assert.match(await readFile(path.join(fixture.root, 'refactor_probe.gd'), 'utf8'), /class_name RenamedProbe/);
      assert.match(await readFile(path.join(fixture.root, 'consumer.gd'), 'utf8'), /extends RenamedProbe/);
      report.checks.push('rename preview rejected foreign path, wrong symbol and foreign listener before any write');
      report.checks.push('exact preview bytes were approved and read back');
      report.status = 'PASS';
    } catch (error) {
      report.error = error instanceof Error ? error.message.slice(0, 8192) : String(error);
      throw error;
    } finally {
      await mkdir(reportRoot, { recursive: true });
      await writeFile(path.join(reportRoot, 'S05.json'), JSON.stringify(report, null, 2));
      await mcp.close().catch(() => undefined);
      await fixture.stop();
    }
  },
);

for (const definition of repairProductionCases()) {
  test(
    `T29 ${definition.id} fixed native script repair chain and illegal control`,
    { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 180000 },
    async () => {
      await runRepairProductionCase(definition);
    },
  );
}

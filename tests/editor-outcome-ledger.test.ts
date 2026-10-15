import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, writeFile, realpath, lstat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startEditorFixture } from './helpers/editor-fixture.js';
import { wireEditor } from './helpers/editor-mcp.js';
import { responseBody } from './helpers/paged-response.js';

const godot = process.env.GODOT_PATH ?? '';
const exec = promisify(execFile);
async function discardFixture(root: string, parent: string, prefix: RegExp) {
  assert.equal(path.dirname(await realpath(root)), parent);
  assert.match(path.basename(root), prefix);
  assert.equal((await lstat(root)).isSymbolicLink(), false);
  await rm(root, { recursive: true, force: false });
}

test(
  'native immutable outcome ledger: 4096 identities, bound replay, corruption and pending safety',
  { skip: !existsSync(godot), timeout: 90000 },
  async () => {
    const parent = await realpath(os.tmpdir());
    const root = await realpath(await mkdtemp(path.join(parent, 'wheel-outcome-store-')));
    await mkdir(path.join(root, '.harness'));
    await cp('godot-plugin/addons/wheel_mcp/scene_outcomes.gd', path.join(root, 'scene_outcomes.gd'));
    await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="Outcome ledger contract"\n');
    // TEST ONLY: real Godot filesystem/storage, synthetic business results (no scene commits).
    await writeFile(
      path.join(root, 'probe.gd'),
      `extends SceneTree
const Store = preload("res://scene_outcomes.gd")
func check(value: bool, message: String) -> void:
\tif not value:
\t\tprinterr("ASSERTION: " + message)
\t\tquit(1)
\t\tassert(false, message)
func _initialize() -> void:
\tvar s = Store.new()
\tvar session = "a".repeat(32)
\tfor i in range(Store.MAX_RECORDS):
\t\tvar key = "owner\\noperation-" + str(i)
\t\tcheck(s.reserve(key, session).get("status") == "PASS", "reservation " + str(i))
\t\tcheck(s.finish(key, {"state": "COMPLETED", "requestHash": "hash-" + str(i), "result": {"value": i}}).get("status") == "PASS", "archive " + str(i))
\t\tif (i + 1) % 512 == 0:
\t\t\tprint("LEDGER_PROGRESS records=" + str(i + 1))
\tcheck(s._bytes < Store.MAX_BYTES, "bounded bytes")
\tcheck(s._reserved == 0 and s._index.size() == Store.MAX_RECORDS, "bounded metadata")
\tcheck(s.reserve("owner\\noverflow", session).get("code") == "CONFLICT", "capacity fails closed")
\tcheck(s.read("owner\\noperation-0").result.value == 0, "oldest replay is retained")
\tcheck(s.read("other\\noperation-0").is_empty(), "owner bound")
\tcheck(s.reserve("owner\\noperation-0", session).get("code") == "CONFLICT", "no ID reuse")
\tvar entry: Dictionary = s._index["owner\\noperation-0"]
\tvar f = FileAccess.open(entry.folder + "/result.json", FileAccess.WRITE)
\tf.store_string("corrupted")
\tf.close()
\tcheck(s.read("owner\\noperation-0").get("code") == "UNKNOWN", "corruption is not NOT_FOUND")
\tcheck(s.read("owner\\noperation-1").result.value == 1, "other immutable results unaffected")
\tvar pending = Store.new()
\tcheck(pending.reserve("owner\\npending", "b".repeat(32)).status == "PASS", "pending reserved")
\tcheck(pending.read("owner\\npending").get("code") == "UNKNOWN", "pending cannot replay")
\tcheck(pending.reserve("other\\nwrong-session", session).get("code") == "FORBIDDEN", "session bound")
\tvar blocked: Dictionary = pending._index["owner\\npending"]
\tcheck(DirAccess.make_dir_absolute(ProjectSettings.globalize_path(blocked.folder + "/result.json")) == OK, "native obstruction")
\tcheck(pending.ready("owner\\npending").get("code") == "UNKNOWN", "storage obstruction stops commit")
\tcheck(pending.reserve("owner\\nlater", "b".repeat(32)).get("code") == "UNKNOWN", "fault never silently reset")
\tvar oversized = Store.new()
\tcheck(oversized.reserve("owner\\nlarge", "c".repeat(32)).status == "PASS", "large reservation")
\tcheck(oversized.finish("owner\\nlarge", {"state": "COMPLETED", "result": "x".repeat(Store.MAX_RECORD_BYTES)}).get("code") == "UNKNOWN", "record budget")
\tprint("LEDGER_PROGRESS byte-capacity-start")
\tvar bytes = Store.new()
\tvar count = 0
\twhile true:
\t\tvar key = "owner\\nbytes-" + str(count)
\t\tvar reserved = bytes.reserve(key, "d".repeat(32))
\t\tif reserved.has("code"):
\t\t\tcheck(reserved.code == "CONFLICT", "byte capacity code")
\t\t\tbreak
\t\tcheck(bytes.finish(key, {"state": "COMPLETED", "result": "x".repeat(60000)}).status == "PASS", "byte archive")
\t\tcount += 1
\tcheck(count > 256 and count < Store.MAX_RECORDS and bytes._bytes <= Store.MAX_BYTES, "actual byte quota")
\tprint("LEDGER_CONTRACT_PASS records=4096 bytes=" + str(bytes._bytes))
\tquit(0)
`,
    );
    let passed = false;
    const started = Date.now();
    try {
      const result = await exec(godot, ['--headless', '--path', root, '--script', 'res://probe.gd'], {
        windowsHide: true,
        timeout: 80000,
        maxBuffer: 65536,
      });
      assert.match(result.stdout, /LEDGER_CONTRACT_PASS records=4096/);
      assert.doesNotMatch(result.stdout + result.stderr, /SCRIPT ERROR|\bERROR:|ASSERTION:/);
      passed = true;
    } catch (error) {
      // Preserve bounded child diagnostics in the test failure itself: the formal
      // reporter keeps error.message, not child stdout/stderr or deleted scratch.
      const child = error as Error & {
        code?: unknown;
        signal?: unknown;
        killed?: boolean;
        stdout?: string;
        stderr?: string;
      };
      throw new Error(
        `Ledger probe failed after ${Date.now() - started}ms: ${JSON.stringify({
          code: child.code,
          signal: child.signal,
          killed: child.killed,
          stdoutTail: String(child.stdout ?? '').slice(-800),
          stderrTail: String(child.stderr ?? '').slice(-800),
        })}`,
        { cause: error },
      );
    } finally {
      if (passed) await discardFixture(root, parent, /^wheel-outcome-store-[a-zA-Z0-9]+$/);
    }
  },
);

test(
  'native stdio 1000 editor changes retain oldest replay, conflicts, undo and uncertain storage',
  { skip: !existsSync(godot), timeout: 240000 },
  async () => {
    const parent = await realpath(os.tmpdir());
    const fixture = await startEditorFixture(godot, { writeEnabled: true });
    let approvals = 0;
    const c = await wireEditor(fixture.root, {
      transport: 'stdio',
      approval: async () => {
        approvals++;
        return { action: 'accept', content: { confirm: true } }; // Explicit MOCK, not human UX.
      },
    });
    const operations = (x: number) => [
      { kind: 'set', path: 'Marker', property: 'position', value: { type: 'Vector2', x, y: 0 } },
    ];
    let passed = false;
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await c.call(name, args);
      assert.notEqual(r.isError, true, JSON.stringify(r));
      return responseBody(r);
    };
    try {
      const first = await call('apply_editor_scene', { operationId: 'ledger-0', operations: operations(100) });
      for (let i = 1; i < 1000; i++) {
        const r = await call('apply_editor_scene', { operationId: `ledger-${i}`, operations: operations(100 + i) });
        assert.equal(r.undoSteps, 1);
        assert.equal(r.persisted, false);
      }
      assert.equal(approvals, 1000);
      const status = await call('get_editor_scene_operation', {
        operationId: 'ledger-0',
        sessionId: fixture.endpoint.sessionId,
      });
      assert.equal(status.operationState, 'COMPLETED');
      const { schema_version: schemaVersion, ...nativeFirst } = first;
      assert.equal(schemaVersion, '0.1');
      assert.deepEqual(status.result, nativeFirst, 'Stored native result excludes only the outer MCP schema envelope');
      const replay = await call('apply_editor_scene', { operationId: 'ledger-0', operations: operations(100) });
      assert.equal(replay.replayed, true);
      assert.equal(replay.planHash, first.planHash);
      assert.equal(approvals, 1000, 'No second approval or scene commit for old ID');
      const conflict = responseBody(
        await c.call('apply_editor_scene', { operationId: 'ledger-0', operations: operations(-1) }),
      );
      assert.equal(conflict.code, 'CONFLICT');
      assert.deepEqual((await fixture.command('inspect-marker')).position, { x: 1099, y: 0 });
      await fixture.command('undo');
      assert.deepEqual(
        (await fixture.command('inspect-marker')).position,
        { x: 1098, y: 0 },
        'Replay must not add a second Undo step',
      );
      await fixture.command('redo');
      assert.deepEqual((await fixture.command('inspect-marker')).position, { x: 1099, y: 0 });
      assert.equal(await readFile(path.join(fixture.root, 'main.tscn'), 'utf8'), fixture.scene);
      // Damaging an old archived record cannot turn it into a new unapproved write.
      const ownerKey = 'stdio-local\nledger-0';
      const { createHash } = await import('node:crypto');
      const resultPath = path.join(
        fixture.root,
        `.harness/editor-outcomes-${fixture.endpoint.sessionId}`,
        createHash('sha256').update(ownerKey).digest('hex'),
        'result.json',
      );
      await writeFile(resultPath, 'corrupted');
      const unknown = responseBody(
        await c.call('apply_editor_scene', { operationId: 'ledger-0', operations: operations(100) }),
      );
      assert.equal(unknown.code, 'UNKNOWN');
      assert.equal(approvals, 1000);
      assert.deepEqual((await fixture.command('inspect-marker')).position, { x: 1099, y: 0 });
      await c.close();
      const blockedId = 'ledger-blocked';
      const blocked = await wireEditor(fixture.root, {
        transport: 'stdio',
        approval: async () => {
          const slot = createHash('sha256').update(`stdio-local\n${blockedId}`).digest('hex');
          await mkdir(
            path.join(fixture.root, `.harness/editor-outcomes-${fixture.endpoint.sessionId}`, slot, 'result.json'),
          );
          return { action: 'accept', content: { confirm: true } }; // Native storage obstruction during MOCK approval.
        },
      });
      try {
        const failed = responseBody(
          await blocked.call('apply_editor_scene', { operationId: blockedId, operations: operations(-2) }),
        );
        assert.equal(failed.code, 'UNKNOWN');
        const halted = responseBody(
          await blocked.call('apply_editor_scene', { operationId: 'must-not-commit', operations: operations(-3) }),
        );
        assert.equal(halted.code, 'UNKNOWN');
        assert.deepEqual((await fixture.command('inspect-marker')).position, { x: 1099, y: 0 });
      } finally {
        await blocked.close();
      }
      assert.doesNotMatch(fixture.output(), /SCRIPT ERROR|\bERROR:/);
      passed = true;
    } finally {
      await c.close();
      await fixture.command('quit').catch(() => {});
      await fixture.stop();
      if (passed) await discardFixture(fixture.root, parent, /^wheel-editor-[a-zA-Z0-9]+$/);
    }
  },
);

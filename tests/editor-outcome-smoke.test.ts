import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, writeFile, realpath, lstat, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

test(
  'short native ledger smoke preserves replay, owner/session binding, pending and storage failure safety',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 20000 },
  async () => {
    const parent = await realpath(os.tmpdir());
    const root = await realpath(await mkdtemp(path.join(parent, 'wheel-ledger-smoke-')));
    let passed = false;
    try {
      await mkdir(path.join(root, '.harness'));
      await cp('godot-plugin/addons/wheel_mcp/scene_outcomes.gd', path.join(root, 'store.gd'));
      await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="Short ledger safety"\n');
      await writeFile(
        path.join(root, 'probe.gd'),
        `extends SceneTree
const Store = preload("res://store.gd")
func check(value: bool, message: String) -> void:
\tif not value:
\t\tprinterr("ASSERTION: " + message)
\t\tquit(1)
\t\tassert(false, message)
func _initialize() -> void:
\tvar s = Store.new()
\tvar session = "a".repeat(32)
\tfor i in range(32):
\t\tvar key = "owner\\n" + str(i)
\t\tcheck(s.reserve(key, session).status == "PASS", "reserve")
\t\tcheck(s.finish(key, {"state": "COMPLETED", "result": {"value": i}}).status == "PASS", "archive")
\tcheck(s.read("owner\\n0").result.value == 0, "oldest replay")
\tcheck(s.reserve("owner\\n0", session).code == "CONFLICT", "duplicate")
\tcheck(s.read("other\\n0").is_empty(), "owner")
\tcheck(s.reserve("owner\\nwrong-session", "b".repeat(32)).code == "FORBIDDEN", "session")
\tvar entry: Dictionary = s._index["owner\\n0"]
\tvar corrupt = FileAccess.open(entry.folder + "/result.json", FileAccess.WRITE)
\tcorrupt.store_string("corrupt")
\tcorrupt.close()
\tcheck(s.read("owner\\n0").code == "UNKNOWN", "corrupt is never NOT_FOUND")
\tcheck(s.read("owner\\n1").result.value == 1, "other results remain valid")
\tvar pending = Store.new()
\tcheck(pending.reserve("owner\\npending", "c".repeat(32)).status == "PASS", "pending")
\tcheck(pending.read("owner\\npending").code == "UNKNOWN", "pending cannot replay")
\tvar slot: Dictionary = pending._index["owner\\npending"]
\tcheck(DirAccess.make_dir_absolute(ProjectSettings.globalize_path(slot.folder + "/result.json")) == OK, "native obstruction")
\tcheck(pending.ready("owner\\npending").code == "UNKNOWN", "storage fail closed")
\tcheck(pending.reserve("owner\\nlater", "c".repeat(32)).code == "UNKNOWN", "fault is retained")
\tvar large = Store.new()
\tcheck(large.reserve("owner\\nlarge", "d".repeat(32)).status == "PASS", "large reserve")
\tcheck(large.finish("owner\\nlarge", {"result": "x".repeat(Store.MAX_RECORD_BYTES)}).code == "UNKNOWN", "record limit")
\tvar quota = Store.new()
\tfor i in range(Store.MAX_BYTES / Store.MAX_RECORD_BYTES):
\t\tcheck(quota.reserve("owner\\nquota-" + str(i), "e".repeat(32)).status == "PASS", "real pending byte reservations")
\tcheck(quota.reserve("owner\\noverflow", "e".repeat(32)).code == "CONFLICT", "reserved byte quota")
\tprint("SHORT_LEDGER_SAFETY_PASS")
\tquit(0)
`,
      );
      const result = await promisify(execFile)(
        process.env.GODOT_PATH!,
        ['--headless', '--path', root, '--script', 'res://probe.gd'],
        { windowsHide: true, timeout: 15000, maxBuffer: 65536 },
      );
      assert.match(result.stdout, /SHORT_LEDGER_SAFETY_PASS/);
      assert.doesNotMatch(result.stdout + result.stderr, /SCRIPT ERROR|\bERROR:|ASSERTION:/);
      passed = true;
    } finally {
      if (passed) {
        assert.equal(path.dirname(await realpath(root)), parent);
        assert.match(path.basename(root), /^wheel-ledger-smoke-[a-zA-Z0-9]+$/);
        assert.equal((await lstat(root)).isSymbolicLink(), false);
        await rm(root, { recursive: true, force: false });
      }
    }
  },
);

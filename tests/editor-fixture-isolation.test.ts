import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { startEditorFixture } from './helpers/editor-fixture.js';

const controller = `@tool
extends EditorPlugin
func _enter_tree() -> void:
\tset_process(true)
func _process(_delta: float) -> void:
\tif not FileAccess.file_exists("res://.harness/fixture-command.json"): return
\tvar command: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://.harness/fixture-command.json"))
\tDirAccess.remove_absolute(ProjectSettings.globalize_path("res://.harness/fixture-command.json"))
\tvar paths := EditorInterface.get_editor_paths()
\tcommand.configDir = paths.get_config_dir()
\tcommand.dataDir = paths.get_data_dir()
\tcommand.selfContained = paths.is_self_contained()
\tvar file := FileAccess.open("res://.harness/fixture-result.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify(command))
\tfile.close()
\tif command.action == "quit": get_tree().call_deferred("quit")
`;

test(
  'concurrent native editor fixtures never share user settings; same-project reopen retains isolated settings',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 120000 },
  async () => {
    const fixtures: Awaited<ReturnType<typeof startEditorFixture>>[] = [];
    try {
      const a = await startEditorFixture(process.env.GODOT_PATH!, { controller });
      fixtures.push(a);
      const b = await startEditorFixture(process.env.GODOT_PATH!, { controller });
      fixtures.push(b);
      const [first, second] = await Promise.all([a.command('profile'), b.command('profile')]);
      for (const [f, profile] of [
        [a, first],
        [b, second],
      ] as const) {
        const relative = path.relative(f.root, profile.configDir);
        assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), profile.configDir);
        assert.equal(profile.selfContained, true);
      }
      assert.notEqual(first.configDir, second.configDir);
      await a.command('quit');
      await a.exited;
      const reopened = await startEditorFixture(process.env.GODOT_PATH!, { controller, existingRoot: a.root });
      fixtures.push(reopened);
      const after = await reopened.command('profile');
      assert.equal(after.configDir, first.configDir);
      assert.equal(after.dataDir, first.dataDir);
      for (const f of [b, reopened]) {
        await f.command('quit');
        await f.exited;
      }
      for (const f of fixtures) assert.doesNotMatch(f.output(), /SCRIPT ERROR|\bERROR:/);
    } finally {
      await Promise.all(fixtures.map((f) => f.stop()));
    }
  },
);

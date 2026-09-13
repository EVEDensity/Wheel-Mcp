import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readGodotDiagnostics } from '../src/godot-development.js';
test('maps multiline Godot parser/stack locations, deduplicates exact errors, ignores ordinary log prose', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagnostics-map-'));
  const entry = 'SCRIPT ERROR: Parse Error: Unexpected identifier.\n   at: GDScript::reload (res://player.gd:12:4)\n';
  await writeFile(
    path.join(root, 'stderr.log'),
    entry +
      entry +
      'ERROR: health 10\n   at: update (res://enemy.gd:8)\n   [0] step (res://world.gd:19)\nERROR: health 20\n   at: update (res://enemy.gd:8)\n',
  );
  await writeFile(path.join(root, 'stdout.log'), 'error count: 0\nlevel failed? false\nparser ready\n');
  const d = await readGodotDiagnostics(root, root);
  assert.equal(d.diagnostics.length, 3);
  assert.equal(d.diagnostics[0].file, 'res://player.gd');
  assert.equal(d.diagnostics[0].line, 12);
  assert.equal(d.diagnostics[0].column, 4);
  assert.equal(d.diagnostics[0].occurrences, 2);
  assert.equal(d.diagnostics[0].kind, 'parser');
  assert.equal(d.diagnostics[1].stack.length, 2);
  assert.notEqual(d.diagnostics[1].fingerprint, d.diagnostics[2].fingerprint);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readGodotDiagnostics } from '../src/godot-development.js';

test('diagnostics retain POSIX capture script locations and distinguish warnings from successful process exit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-diagnostic-location-'));
  await writeFile(
    path.join(root, 'stderr.log'),
    [
      'SCRIPT ERROR: Assertion failed: missing event pose king-rage/6',
      '          at: record (/Users/example/game outputs/runtime/live.gd:65)',
      'WARNING: Completed room texture unavailable: res://art/wall-organic.png',
      '         [0] load_into (res://scripts/view/completed_room_art.gd:15)',
      'SCRIPT ERROR: Parse Error: Too many arguments for bridge_collapse',
      '          at: GDScript::reload (C:\\Game Files\\view.gd:803:12)',
    ].join('\n'),
  );
  const result = await readGodotDiagnostics(root);
  assert.equal(result.diagnostics[0].file, '/Users/example/game outputs/runtime/live.gd');
  assert.equal(result.diagnostics[0].line, 65);
  assert.equal(result.diagnostics[1].severity, 'warning');
  assert.equal(result.diagnostics[1].file, 'res://scripts/view/completed_room_art.gd');
  assert.equal(result.diagnostics[2].file, 'C:\\Game Files\\view.gd');
  assert.equal(result.diagnostics[2].line, 803);
  assert.equal(result.diagnostics[2].column, 12);
});

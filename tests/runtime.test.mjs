import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGodotPath } from '../src/godot-runtime.mjs';

test('resolveGodotPath requires an explicit executable', () => {
  assert.throws(() => resolveGodotPath(''), /GODOT_PATH is required/);
});

test('resolveGodotPath normalizes an executable path', () => {
  assert.equal(resolveGodotPath('E:/AI/Godot_v4.7.2-stable_win64_console.exe').endsWith('Godot_v4.7.2-stable_win64_console.exe'), true);
});

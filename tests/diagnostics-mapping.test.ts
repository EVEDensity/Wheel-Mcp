import test from 'node:test';
import assert from 'node:assert/strict';
import { readGodotDiagnostics } from '../src/godot-development.js';
test('diagnostics mapping export exists', () => assert.equal(typeof readGodotDiagnostics, 'function'));

import test from 'node:test';
import assert from 'node:assert/strict';
import { compareScreenshots } from '../src/godot-development.js';
test('screenshot diff export exists', () => assert.equal(typeof compareScreenshots, 'function'));

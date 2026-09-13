import test from 'node:test';
import assert from 'node:assert/strict';
import { callRuntimeBridge } from '../src/persistent-runtime-bridge.js';
test('runtime bridge call export exists', () => assert.equal(typeof callRuntimeBridge, 'function'));

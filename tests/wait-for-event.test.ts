import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistentRuntimeBridge } from '../src/persistent-runtime-bridge.js';
test('persistent bridge exposes waitForEvent', () =>
  assert.equal(typeof PersistentRuntimeBridge.prototype.waitForEvent, 'function'));

import test from 'node:test';
import assert from 'node:assert/strict';
import { executeScenario } from '../src/scenario-executor.js';
test('scenario executor export exists', () => assert.equal(typeof executeScenario, 'function'));

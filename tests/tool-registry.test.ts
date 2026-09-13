import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpServer } from '../src/mcp-server-sdk.js';
test('tool registry server creates successfully', () => assert.ok(createMcpServer()));

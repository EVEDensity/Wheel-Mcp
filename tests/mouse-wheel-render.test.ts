import test from 'node:test';
import { existsSync } from 'node:fs';
import { exerciseWheel } from './helpers/wheel-behavior.js';
// Local actual pixels, not hosted GPU certification.
test(
  'saved MCP-authored ScrollContainer consumes wheel input with reversible rendered pixel movement',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 },
  () => exerciseWheel(true),
);

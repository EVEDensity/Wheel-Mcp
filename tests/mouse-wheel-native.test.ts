import test from 'node:test';
import { existsSync } from 'node:fs';
import { exerciseWheel } from './helpers/wheel-behavior.js';
test(
  'real stdio native wheel input scrolls both axes, respects hit testing and replays without reinjection',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 },
  () => exerciseWheel(false),
);

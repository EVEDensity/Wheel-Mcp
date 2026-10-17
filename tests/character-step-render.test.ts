import test from 'node:test';
import { existsSync } from 'node:fs';
import { exerciseCharacter } from './helpers/character-behavior.js';

test(
  'actual rendered native character command changes sprite pixels and restores with zero difference',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 },
  () => exerciseCharacter(true),
);

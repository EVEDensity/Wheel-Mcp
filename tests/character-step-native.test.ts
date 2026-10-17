import test from 'node:test';
import { existsSync } from 'node:fs';
import { exerciseCharacter } from './helpers/character-behavior.js';

test(
  'real stdio authored CharacterBody2D moves on physics frames, hits wall/floor and replays once without disk writes',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 60000 },
  () => exerciseCharacter(false),
);

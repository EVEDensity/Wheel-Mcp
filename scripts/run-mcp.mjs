#!/usr/bin/env node
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { discoverGodotPath, loadProjectEnv, verifyGodotExecutable } from './lib/godot-discovery.mjs';
import { resolveProjectRoot } from './lib/project-root.mjs';

const projectRoot = await resolveProjectRoot(import.meta.url);
const envFile = await loadProjectEnv(projectRoot);

if (!process.env.GODOT_PATH || !(await verifyGodotExecutable(process.env.GODOT_PATH))) {
  const discovered = await discoverGodotPath({ envFile, explicit: process.env.GODOT_PATH });
  if (discovered && (await verifyGodotExecutable(discovered))) process.env.GODOT_PATH = discovered;
}

const entrypoint = path.join(projectRoot, 'build', 'src', 'mcp-server-sdk.js');
try {
  await access(entrypoint, constants.R_OK);
} catch {
  const build = spawn(process.execPath, ['scripts/setup.mjs', '--build-only'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  });
  const buildCode = await new Promise((resolve) => build.once('close', resolve));
  if (buildCode !== 0) process.exit(buildCode ?? 1);
}

if (!process.env.GODOT_PATH) {
  console.error(
    [
      'wheel-mcp: GODOT_PATH is not configured.',
      'Run `npm run setup` once, or create .env with GODOT_PATH=...',
      'Example: GODOT_PATH=D:/tools/Godot_v4.7.2-stable_win64_console.exe',
    ].join('\n'),
  );
  process.exit(1);
}

process.env.GODOT_HARNESS_ROOT = projectRoot;
process.env.GODOT_HARNESS_BRIDGE = path.join(projectRoot, 'godot-plugin', 'runtime_bridge.gd');

const child = spawn(process.execPath, [entrypoint], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: process.env,
});

child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? (signal ? 1 : 0));
});

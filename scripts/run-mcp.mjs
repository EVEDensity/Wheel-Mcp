#!/usr/bin/env node
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverGodotPath, loadProjectEnv, verifyGodotExecutable } from './lib/godot-discovery.mjs';
import { resolveProjectRoot } from './lib/project-root.mjs';

const projectRoot = await resolveProjectRoot(import.meta.url);
const entrypoint = path.join(projectRoot, 'build', 'src', 'mcp-server-sdk.js');
function requirePreparedRuntime(message) {
  console.error(
    `wheel-mcp: ${message} Reinstall the prebuilt package, or run npm run build in the source checkout before reconnecting.`,
  );
  process.exit(1);
}
try {
  await access(entrypoint, constants.R_OK);
} catch {
  // Startup is not an installer/compiler. Keep stdout protocol-only and avoid
  // abandoned build children when a client cancels initialization.
  requirePreparedRuntime('Prebuilt MCP runtime is missing or unreadable.');
}
const envFile = await loadProjectEnv(projectRoot);
if (!process.env.GODOT_PATH || !(await verifyGodotExecutable(process.env.GODOT_PATH))) {
  const discovered = await discoverGodotPath({ envFile, explicit: process.env.GODOT_PATH });
  if (discovered && (await verifyGodotExecutable(discovered))) process.env.GODOT_PATH = discovered;
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

// The client owns this PID. Do not put a second Node process between it and the
// server: EOF, cancellation and abnormal exit must reach the real stdio owner.
process.chdir(projectRoot);
const { startStdioServer } = await import(pathToFileURL(entrypoint).href);
if (typeof startStdioServer !== 'function')
  requirePreparedRuntime('MCP runtime entry is incompatible with this launcher.');
await startStdioServer();

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClientPolicy, type McpClientPolicy, type McpPermission } from './access-policy.js';
import { parseEnvFile } from '../godot-path.js';

const validScopes = new Set<McpPermission>(['read', 'run', 'write', 'admin']);

/** Local stdio is authenticated by OS process access, but it is still bounded by explicit roots and entrypoints. */
export function createStdioPolicy(env: NodeJS.ProcessEnv = process.env): McpClientPolicy {
  const scopes = split(env.MCP_STDIO_SCOPES ?? 'read,run,write') as McpPermission[];
  if (scopes.length === 0 || scopes.some((scope) => !validScopes.has(scope)))
    throw new Error('MCP_STDIO_SCOPES contains an invalid permission');
  const defaultRoots = [process.cwd(), os.tmpdir()];
  const projectRoots = env.MCP_STDIO_PROJECT_ROOTS ? split(env.MCP_STDIO_PROJECT_ROOTS) : defaultRoots;
  const evidenceRoots = env.MCP_STDIO_EVIDENCE_ROOTS ? split(env.MCP_STDIO_EVIDENCE_ROOTS) : defaultRoots;
  const packagedBridge = bundledBridgeHash();
  return createClientPolicy({
    clientId: 'stdio-local',
    scopes,
    projectRoots,
    evidenceRoots,
    approvedGodotPaths: split(env.MCP_STDIO_APPROVED_GODOT_PATHS ?? env.GODOT_PATH ?? packageGodotPath() ?? ''),
    approvedBridgePaths: split(env.MCP_STDIO_APPROVED_BRIDGE_PATHS ?? ''),
    approvedBridgeHashes: env.MCP_STDIO_APPROVED_BRIDGE_HASHES
      ? split(env.MCP_STDIO_APPROVED_BRIDGE_HASHES)
      : packagedBridge
        ? [packagedBridge]
        : [],
  });
}

function split(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function bundledBridgeHash(): string | undefined {
  const candidate = packagedFile('godot-plugin/runtime_bridge.gd');
  if (candidate) return createHash('sha256').update(readFileSync(candidate)).digest('hex');
  return undefined;
}

function packageGodotPath(): string | undefined {
  const envFile = packagedFile('.env');
  return envFile ? parseEnvFile(readFileSync(envFile, 'utf8')).GODOT_PATH : undefined;
}

function packagedFile(relative: string): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const root of [path.resolve(here, '../..'), path.resolve(here, '../../..')]) {
    const candidate = path.join(root, relative);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

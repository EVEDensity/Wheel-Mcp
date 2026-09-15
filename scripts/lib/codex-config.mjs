import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'smol-toml';

// Parse before writing: invalid or unsupported TOML must never be overwritten.
export async function mergeCodexConfig(filePath, projectRoot, godotPath, force = false) {
  let text = '';
  let exists = false;
  try {
    text = await readFile(filePath, 'utf8');
    exists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const config = parse(text);
  if (
    config.mcp_servers !== undefined &&
    (typeof config.mcp_servers !== 'object' || Array.isArray(config.mcp_servers) || config.mcp_servers === null)
  ) {
    throw new Error('Codex mcp_servers must be a TOML table; file left unchanged.');
  }
  config.mcp_servers ??= {};
  const previous = config.mcp_servers['wheel-mcp'];
  if (previous && !force) return false;
  const entry = { command: process.execPath, args: [path.join(projectRoot, 'scripts', 'run-mcp.mjs')] };
  if (previous?.env) entry.env = { ...previous.env };
  if (godotPath) entry.env = { ...entry.env, GODOT_PATH: godotPath };
  config.mcp_servers['wheel-mcp'] = entry;
  const output = stringify(config);
  parse(output);
  await mkdir(path.dirname(filePath), { recursive: true });
  // Preserve the exact original, including comments, before a serializer rewrite.
  if (exists) await copyFile(filePath, `${filePath}.wheel-mcp-${Date.now()}.bak`);
  await writeFile(filePath, output, 'utf8');
  return true;
}

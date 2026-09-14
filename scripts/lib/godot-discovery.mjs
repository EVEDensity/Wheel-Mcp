import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { defaultSearchRoots, fixedGodotCandidates, isGodotExecutableName } from './platform-paths.mjs';

export function parseEnvFile(content) {
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function isReadableFile(candidate) {
  try {
    const info = await stat(candidate);
    return info.isFile();
  } catch {
    return false;
  }
}

function normalizeCandidate(candidate) {
  if (!candidate) return undefined;
  const trimmed = String(candidate).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function scoreGodotExecutable(filePath) {
  const base = path.basename(filePath).toLowerCase();
  let score = 0;
  if (base.includes('console')) score += 20;
  if (base.includes('4.7')) score += 10;
  if (base.includes('stable')) score += 5;
  if (base.endsWith('.exe')) score += 1;
  return score;
}

async function collectExecutableCandidates(directory, limit = 8) {
  let entries;
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  const matches = entries
    .filter((entry) => isGodotExecutableName(entry))
    .map((entry) => path.join(directory, entry))
    .sort((left, right) => scoreGodotExecutable(right) - scoreGodotExecutable(left));
  const verified = [];
  for (const candidate of matches) {
    if (await isReadableFile(candidate)) verified.push(candidate);
    if (verified.length >= limit) break;
  }
  return verified;
}

function discoverFromPath() {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const output = execFileSync(command, ['godot'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function discoverGodotPath(options = {}) {
  const ordered = [];
  const seen = new Set();
  const push = (candidate) => {
    const normalized = normalizeCandidate(candidate);
    if (!normalized) return;
    const resolved = path.resolve(normalized);
    const key = resolved.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(resolved);
  };

  push(options.explicit);
  push(process.env.GODOT_PATH);

  if (options.envFile) {
    try {
      const parsed = parseEnvFile(await readFile(options.envFile, 'utf8'));
      push(parsed.GODOT_PATH);
    } catch {
      // Optional .env file.
    }
  }

  for (const candidate of discoverFromPath()) push(candidate);
  for (const candidate of fixedGodotCandidates()) push(candidate);

  for (const root of options.searchRoots ?? defaultSearchRoots()) {
    for (const candidate of await collectExecutableCandidates(root)) push(candidate);
    for (const candidate of await collectExecutableCandidates(path.join(root, 'Godot'))) push(candidate);
  }

  for (const candidate of ordered) {
    if (!(await isReadableFile(candidate))) {
      try {
        const info = await stat(candidate);
        if (info.isDirectory()) {
          for (const nested of await collectExecutableCandidates(candidate)) {
            if (await isReadableFile(nested)) return nested;
          }
        }
      } catch {
        // Ignore invalid candidates.
      }
      continue;
    }
    return candidate;
  }
  return undefined;
}

export async function verifyGodotExecutable(godotPath) {
  if (!(await isReadableFile(godotPath))) return false;
  try {
    execFileSync(godotPath, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

export async function loadProjectEnv(projectRoot) {
  const envPath = path.join(projectRoot, '.env');
  try {
    const parsed = parseEnvFile(await readFile(envPath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return envPath;
  } catch {
    return undefined;
  }
}

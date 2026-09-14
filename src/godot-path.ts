import { access, readdir, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function isGodotExecutableName(name: string): boolean {
  if (/^godot(?:[_-].*)?\.exe$/i.test(name)) return true;
  if (/^Godot(?:[_-][\w.-]+)?$/i.test(name) && !name.endsWith('.app')) return true;
  return false;
}

function fixedGodotCandidates(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (process.platform === 'darwin') {
    return [
      '/Applications/Godot.app/Contents/MacOS/Godot',
      path.join(home, 'Applications/Godot.app/Contents/MacOS/Godot'),
      '/opt/homebrew/bin/godot',
      '/usr/local/bin/godot',
    ];
  }
  if (process.platform === 'linux') {
    return ['/usr/bin/godot', '/usr/local/bin/godot', path.join(home, '.local/bin/godot')];
  }
  return [];
}

export function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
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

async function isReadableFile(candidate: string): Promise<boolean> {
  try {
    const info = await stat(candidate);
    return info.isFile();
  } catch {
    return false;
  }
}

function normalizeCandidate(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function scoreGodotExecutable(filePath: string): number {
  const base = path.basename(filePath).toLowerCase();
  let score = 0;
  if (base.includes('console')) score += 20;
  if (base.includes('4.7')) score += 10;
  if (base.includes('stable')) score += 5;
  if (base.endsWith('.exe')) score += 1;
  return score;
}

async function collectExecutableCandidates(directory: string, limit = 8): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  const matches = entries
    .filter((entry) => isGodotExecutableName(entry))
    .map((entry) => path.join(directory, entry))
    .sort((left, right) => scoreGodotExecutable(right) - scoreGodotExecutable(left));
  const verified: string[] = [];
  for (const candidate of matches) {
    if (await isReadableFile(candidate)) verified.push(candidate);
    if (verified.length >= limit) break;
  }
  return verified;
}

function discoverFromPath(): string[] {
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

function defaultSearchRoots(): string[] {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const roots = [path.join(home, 'Downloads'), path.join(home, 'Desktop')];
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    roots.unshift(
      path.join(localAppData, 'Programs', 'Godot'),
      path.join(localAppData, 'Programs', 'Godot Engine'),
      path.join(programFiles, 'Godot'),
      path.join(programFiles, 'Godot Engine'),
      path.join(programFilesX86, 'Godot'),
      path.join(home, 'scoop', 'apps', 'godot', 'current'),
      'C:\\tools',
      'D:\\tools',
    );
  } else if (process.platform === 'darwin') {
    roots.unshift('/Applications', path.join(home, 'Applications'));
  } else {
    roots.unshift('/opt/godot', '/usr/local/godot', path.join(home, '.local/share/godot'));
  }
  return roots.filter(Boolean);
}

export type DiscoverGodotOptions = {
  explicit?: string;
  envFile?: string;
  searchRoots?: string[];
};

export async function discoverGodotPath(options: DiscoverGodotOptions = {}): Promise<string | undefined> {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (candidate: string | undefined) => {
    const normalized = normalizeCandidate(candidate);
    if (!normalized) return;
    const resolved = path.resolve(normalized);
    if (seen.has(resolved.toLowerCase())) return;
    seen.add(resolved.toLowerCase());
    ordered.push(resolved);
  };

  push(normalizeCandidate(options.explicit));
  push(normalizeCandidate(process.env.GODOT_PATH));

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

export async function resolveGodotPath(value?: string, envFile?: string): Promise<string> {
  const explicit = normalizeCandidate(value);
  if (explicit && (await isReadableFile(path.resolve(explicit)))) return path.resolve(explicit);
  const discovered = await discoverGodotPath({ explicit, envFile });
  if (discovered) return discovered;
  throw new Error(
    'GODOT_PATH is required. Run `npm run setup`, set GODOT_PATH in .env, or install Godot 4.7.2 console executable.',
  );
}

export function resolveGodotPathSync(value?: string): string {
  const explicit = normalizeCandidate(value ?? process.env.GODOT_PATH);
  if (!explicit) {
    throw new Error(
      'GODOT_PATH is required. Run `npm run setup`, set GODOT_PATH in .env, or pass godotPath explicitly.',
    );
  }
  return path.resolve(explicit);
}

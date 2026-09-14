import { execFileSync, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { appendFile, chmod, mkdir } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pipeline } from 'node:stream/promises';
import { URL } from 'node:url';

const VERSION = '4.7.2-stable';
const ROOT = path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'godot');

const downloads = {
  win32: {
    archive: `Godot_v${VERSION}_win64.exe.zip`,
    // The zip contains both a GUI and a _console build; we prefer the
    // console variant since our CI runs Godot headless via --headless.
    pickFromZip: (entries) =>
      entries.find((e) => e.name.endsWith('_console.exe')) ?? entries.find((e) => e.name.endsWith('.exe')),
  },
  darwin: {
    archive: `Godot_v${VERSION}_macos.universal.zip`,
    // The macOS zip contains Godot.app/Contents/MacOS/Godot
    pickFromZip: (entries) =>
      entries.find((e) => e.name.includes('Godot.app') && !e.name.includes('_console') && e.name.endsWith('Godot')) ??
      entries.find((e) => e.name.endsWith('Godot')),
  },
  linux: {
    archive: `Godot_v${VERSION}_linux.x86_64.zip`,
    // The Linux zip contains a single Godot_v4.7.2-stable_linux.x86_64 binary
    pickFromZip: (entries) => entries.find((e) => e.name.endsWith('.x86_64')),
  },
};

function downloadFile(urlString, destination) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const client = https;
    const request = client.request(
      url,
      {
        method: 'GET',
        headers: { 'user-agent': 'wheel-mcp-ci-installer', accept: '*/*' },
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          const redirectUrl = new URL(response.headers.location, url).toString();
          downloadFile(redirectUrl, destination).then(resolve, reject);
          return;
        }
        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`HTTP ${response.statusCode ?? 'unknown'} fetching ${urlString}`));
          return;
        }
        pipeline(response, createWriteStream(destination)).then(resolve, reject);
      },
    );
    request.on('error', reject);
    request.end();
  });
}

function zipList(archivePath) {
  const result = spawnSync('unzip', ['-l', archivePath], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`unzip -l failed: ${result.stderr || result.error?.message}`);
  }
  const lines = (result.stdout || '').split('\n');
  const entries = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Archive:') || trimmed.startsWith('Length') || trimmed.startsWith('---------')) {
      continue;
    }
    if (/^\d+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+/.test(trimmed)) {
      const match = trimmed.match(/^\d+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/);
      if (match) entries.push({ name: match[1] });
    }
  }
  return entries;
}

async function install() {
  await mkdir(ROOT, { recursive: true });

  const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const cfg = downloads[platform];

  const archivePath = path.join(ROOT, cfg.archive);
  const downloadUrl = `https://github.com/godotengine/godot/releases/download/${VERSION}/${cfg.archive}`;

  console.log(`Downloading ${downloadUrl}`);
  await downloadFile(downloadUrl, archivePath);

  const zipListResult = zipList(archivePath);
  const picked = cfg.pickFromZip(zipListResult);
  if (!picked) {
    throw new Error(
      `Could not find a Godot binary in ${cfg.archive}. Entries: ${zipListResult.map((e) => e.name).join(', ')}`,
    );
  }
  console.log(`Picked binary from archive: ${picked.name}`);

  const extractDir = path.join(ROOT, 'extract');
  await mkdir(extractDir, { recursive: true });
  const unzip = spawnSync('unzip', ['-q', '-o', archivePath, picked.name, '-d', extractDir], { stdio: 'inherit' });
  if (unzip.status !== 0) process.exit(unzip.status ?? 1);

  let godotPath = path.join(extractDir, picked.name);
  if (platform === 'linux') await chmod(godotPath, 0o755);
  if (platform === 'darwin') await chmod(godotPath, 0o755);

  execFileSync(godotPath, ['--version'], { stdio: 'inherit' });

  if (process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, `GODOT_PATH=${godotPath.replaceAll('\\', '/')}\n`);
  }
  console.log(`GODOT_PATH=${godotPath.replaceAll('\\', '/')}`);
}

await install();

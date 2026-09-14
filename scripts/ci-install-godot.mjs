import { execFileSync } from 'node:child_process';
import { createWriteStream, writeFileSync } from 'node:fs';
import { appendFile, chmod, mkdir } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const VERSION = '4.7.2-stable';
const ROOT = path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'godot');

const platforms = {
  win32: { archive: `Godot_v${VERSION}_win64.exe.zip` },
  darwin: { archive: `Godot_v${VERSION}_macos.universal.zip` },
  linux: { archive: `Godot_v${VERSION}_linux.x86_64.zip` },
};

function downloadFile(urlString, destination) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const request = https.request(
      url,
      { method: 'GET', headers: { 'user-agent': 'wheel-mcp-ci-installer', accept: '*/*' } },
      (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          downloadFile(new URL(response.headers.location, url).toString(), destination).then(resolve, reject);
          return;
        }
        if (response.statusCode >= 400) {
          reject(new Error(`HTTP ${response.statusCode} fetching ${urlString}`));
          return;
        }
        pipeline(response, createWriteStream(destination)).then(resolve, reject);
      },
    );
    request.on('error', reject);
    request.end();
  });
}

/**
 * Pick the real Godot binary from the zip entries.
 *
 * Windows win64.exe.zip has TWO executables:
 *   Godot_v4.7.2-stable_win64.exe          (180MB — the real Godot)
 *   Godot_v4.7.2-stable_win64_console.exe (0.2MB — a launcher stub, crashes alone!)
 * So we MUST pick the largest .exe.
 *
 * macOS .app bundle: Godot.app/Contents/MacOS/Godot
 * Linux tarball:     Godot_v4.7.2-stable_linux.x86_64
 */
function pickBinary(platform, entries) {
  const files = entries.filter((e) => !e.isDirectory);
  if (platform === 'win32') {
    // Largest .exe wins (the real Godot, not the 0.2MB stub)
    const exes = files.filter((e) => e.name.endsWith('.exe'));
    if (exes.length === 0) return null;
    return exes.reduce((best, cur) => (cur.header.size > best.header.size ? cur : best));
  }
  if (platform === 'darwin') {
    // adm-zip may preserve full path OR flatten entries depending on host.
    // Try full path first, then basename fallback with size sanity check.
    return (
      files.find((e) => e.name === 'Godot.app/Contents/MacOS/Godot') ||
      files.find((e) => e.name === 'Godot' && e.header.size > 10 * 1024 * 1024)
    );
  }
  // linux
  return files.find((e) => /\.x86_64$/.test(e.name));
}

async function install() {
  await mkdir(ROOT, { recursive: true });

  const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const cfg = platforms[platform];

  const archivePath = path.join(ROOT, cfg.archive);
  const downloadUrl = `https://github.com/godotengine/godot/releases/download/${VERSION}/${cfg.archive}`;

  console.log(`Downloading ${downloadUrl}`);
  await downloadFile(downloadUrl, archivePath);

  console.log(`Reading zip with adm-zip`);
  const zip = new AdmZip(archivePath);
  const zipEntries = zip.getEntries();

  const picked = pickBinary(platform, zipEntries);
  if (!picked) {
    const names = zipEntries.filter((e) => !e.isDirectory).map((e) => e.name);
    throw new Error(`Could not find a Godot binary in ${cfg.archive}. Entries: ${names.join(', ')}`);
  }
  console.log(`Picked: ${picked.name} (${picked.header.size} bytes)`);

  const extractDir = path.join(ROOT, 'extract');
  await mkdir(extractDir, { recursive: true });

  // Write the single picked file to extract/<picked.name>
  // For macOS we need to preserve the subdirectory so the path is valid.
  const targetPath = path.join(extractDir, picked.name);
  await mkdir(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, picked.getData());

  if (platform === 'linux' || platform === 'darwin') await chmod(targetPath, 0o755);

  console.log(`Verifying: ${targetPath} --version`);
  execFileSync(targetPath, ['--version'], { stdio: 'inherit' });

  const godotPath = targetPath.replaceAll('\\', '/');
  if (process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, `GODOT_PATH=${godotPath}\n`);
  }
  console.log(`GODOT_PATH=${godotPath}`);
}

await install();

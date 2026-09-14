import { execFileSync, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pipeline } from 'node:stream/promises';

const VERSION = '4.7.2-stable';
const root = path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'godot');

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
  await pipeline(response.body, createWriteStream(destination));
}

async function install() {
  await mkdir(root, { recursive: true });
  let godotPath;

  if (process.platform === 'win32') {
    godotPath = path.join(root, 'Godot_v4.7.2-stable_win64_console.exe');
    await download(
      `https://github.com/godotengine/godot/releases/download/${VERSION}/Godot_v4.7.2-stable_win64_console.exe`,
      godotPath,
    );
  } else if (process.platform === 'darwin') {
    const zip = path.join(root, 'godot.zip');
    await download(
      `https://github.com/godotengine/godot/releases/download/${VERSION}/Godot_v4.7.2-stable_macos.universal.zip`,
      zip,
    );
    const unzip = spawnSync('unzip', ['-q', zip, '-d', root], { stdio: 'inherit' });
    if (unzip.status !== 0) process.exit(unzip.status ?? 1);
    godotPath = path.join(root, 'Godot.app', 'Contents', 'MacOS', 'Godot');
  } else {
    const zip = path.join(root, 'godot.zip');
    await download(
      `https://github.com/godotengine/godot/releases/download/${VERSION}/Godot_v4.7.2-stable_linux.x86_64.zip`,
      zip,
    );
    const unzip = spawnSync('unzip', ['-q', zip, '-d', root], { stdio: 'inherit' });
    if (unzip.status !== 0) process.exit(unzip.status ?? 1);
    godotPath = path.join(root, 'Godot_v4.7.2-stable_linux.x86_64');
    await chmod(godotPath, 0o755);
  }

  execFileSync(godotPath, ['--version'], { stdio: 'inherit' });
  const normalized = godotPath.replaceAll('\\', '/');
  if (process.env.GITHUB_ENV) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_ENV, `GODOT_PATH=${normalized}\n`);
  }
  console.log(`GODOT_PATH=${normalized}`);
}

await install();

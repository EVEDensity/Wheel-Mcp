import { execFileSync, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { appendFile, chmod, mkdir } from 'node:fs/promises';
import https from 'node:https';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pipeline } from 'node:stream/promises';
import { URL } from 'node:url';

const VERSION = '4.7.2-stable';
const root = path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'godot');

function downloadFile(urlString, destination) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const client = url.protocol === 'https:' ? https : http;
    const options = {
      method: 'GET',
      headers: {
        'user-agent': 'wheel-mcp-ci-installer',
        accept: '*/*',
      },
    };

    const request = client.request(url, options, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Follow redirect
        const redirectUrl = new URL(response.headers.location, url).toString();
        response.resume();
        downloadFile(redirectUrl, destination).then(resolve, reject);
        return;
      }
      if (!response.statusCode || response.statusCode >= 400) {
        reject(new Error(`HTTP ${response.statusCode ?? 'unknown'} fetching ${urlString}`));
        return;
      }
      const stream = createWriteStream(destination);
      pipeline(response, stream).then(resolve, reject);
    });

    request.on('error', reject);
    request.end();
  });
}

async function install() {
  await mkdir(root, { recursive: true });
  let godotPath;

  if (process.platform === 'win32') {
    godotPath = path.join(root, 'Godot_v4.7.2-stable_win64_console.exe');
    await downloadFile(
      `https://github.com/godotengine/godot/releases/download/${VERSION}/Godot_v4.7.2-stable_win64_console.exe`,
      godotPath,
    );
  } else if (process.platform === 'darwin') {
    const zip = path.join(root, 'godot.zip');
    await downloadFile(
      `https://github.com/godotengine/godot/releases/download/${VERSION}/Godot_v4.7.2-stable_macos.universal.zip`,
      zip,
    );
    const unzip = spawnSync('unzip', ['-q', zip, '-d', root], { stdio: 'inherit' });
    if (unzip.status !== 0) process.exit(unzip.status ?? 1);
    godotPath = path.join(root, 'Godot.app', 'Contents', 'MacOS', 'Godot');
  } else {
    const zip = path.join(root, 'godot.zip');
    await downloadFile(
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
    await appendFile(process.env.GITHUB_ENV, `GODOT_PATH=${normalized}\n`);
  }
  console.log(`GODOT_PATH=${normalized}`);
}

await install();

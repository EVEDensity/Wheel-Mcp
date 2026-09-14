#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { resolveProjectRoot } from './lib/project-root.mjs';

const args = new Set(process.argv.slice(2));
const skipNpm = args.has('--skip-npm');
const includeGlobal = args.has('--global');
const projectRoot = await resolveProjectRoot(import.meta.url);

function line(text = '') {
  console.log(text);
}

function fail(message, code = 1) {
  console.error(`✗ ${message}`);
  process.exit(code);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: projectRoot,
    stdio: 'inherit',
    encoding: 'utf8',
    shell: options.shell ?? false,
    env: process.env,
  });
  if (result.status !== 0) {
    fail(
      options.errorMessage ??
        `命令失败: ${[command, ...commandArgs].join(' ')}${result.stderr ? `\n${result.stderr}` : ''}`,
      result.status ?? 1,
    );
  }
  return result;
}

const nodeMajor = Number(process.versions.node.split('.')[0] ?? 0);
if (nodeMajor < 20) {
  fail(`需要 Node.js >= 20.19.0，当前为 ${process.version}。请从 https://nodejs.org/ 安装。`);
}

line('========================================');
line('  Wheel-mcp 一键安装');
line('========================================');
line('');

if (!skipNpm) {
  line('[1/2] 安装依赖并编译...');
  try {
    await access(path.join(projectRoot, 'node_modules'), constants.F_OK);
    line('      检测到 node_modules，正在同步依赖...');
  } catch {
    line('      首次安装，可能需要 1-2 分钟...');
  }
  if (process.platform === 'win32') {
    run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm install --no-audit --no-fund'], {
      errorMessage: 'npm install 失败。请确认已安装 Node.js 且网络可用。',
    });
  } else {
    run('npm', ['install', '--no-audit', '--no-fund'], {
      errorMessage: 'npm install 失败。请确认已安装 Node.js 且网络可用。',
    });
  }
} else {
  line('[1/2] 跳过 npm install（--skip-npm）');
}

line('[2/2] 写入 MCP 配置...');
const setupArgs = ['scripts/setup.mjs', '--force', '--pretty'];
if (includeGlobal) setupArgs.push('--global');
run(process.execPath, setupArgs, {
  errorMessage: 'MCP 配置失败。',
});

line('');
line('安装完成。用 Cursor 打开此文件夹即可使用 wheel-mcp。');
line('');

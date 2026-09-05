import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CancelledError, createTimeoutContext, TimeoutContext, TimeoutError } from './timeout.js';
import { runRegistry } from './run-registry.js';
import { readRuntimeEvents, readRuntimeEventsSince, subscribeRuntimeEvents } from './runtime-events.js';
export {
  readRuntimeEvents,
  readRuntimeEventsSince,
  subscribeRuntimeEvents,
  createEventSubscription,
  pollEventSubscription,
  cancelEventSubscription,
} from './runtime-events.js';

type LaunchOptions = {
  godotPath?: string;
  projectPath: string;
  evidenceDir?: string;
  headless?: boolean;
  extraArgs?: string[];
  timeout?: TimeoutContext;
};
type BridgeOptions = {
  godotPath?: string;
  projectPath: string;
  evidenceDir?: string;
  bridgePath: string;
  timeout?: TimeoutContext;
};
type PropertyOptions = BridgeOptions & { nodePath?: string; property: string; value?: unknown };
type InputOptions = BridgeOptions & { keycode: number; pressed?: boolean };
type ScreenshotOptions = BridgeOptions & { screenshotPath?: string };
export type ProcessMetadata = {
  schema_version: '0.1';
  source: 'REAL';
  started: boolean;
  pid?: number;
  executable: string;
  arguments: string[];
  project_path: string;
  started_at: string;
  finished_at?: string;
  exit_code: number | null;
  timed_out: boolean;
  cancelled: boolean;
  lifecycle: 'STARTING' | 'RUNNING' | 'EXITED' | 'STOPPED' | 'CANCELLED' | 'TIMEOUT' | 'FAILED';
  stdout: string;
  stderr: string;
};

type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  code: 'OK' | 'TIMEOUT' | 'CANCELLED' | 'FAILED';
  timed_out: boolean;
  cancelled: boolean;
};

export function resolveGodotPath(value = process.env.GODOT_PATH) {
  if (!value) throw new Error('GODOT_PATH is required');
  return path.resolve(value);
}

function checkTimeout(timeout?: TimeoutContext): void {
  timeout?.throwIfCancelled();
  timeout?.throwIfExpired();
}

export async function getGodotVersion(godotPath: string, timeout?: TimeoutContext): Promise<string> {
  checkTimeout(timeout);
  const result = await runProcess(godotPath, ['--version'], process.cwd(), 30, {}, timeout);
  if (result.exitCode !== 0) throw new Error(`Godot version failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export async function listProjects(directory: string, recursive = false, timeout?: TimeoutContext) {
  const root = path.resolve(directory);
  const projects: string[] = [];
  async function visit(current: string): Promise<void> {
    checkTimeout(timeout);
    const entries = await readdir(current, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === 'project.godot')) {
      projects.push(path.join(current, 'project.godot'));
      if (!recursive) return;
    }
    if (!recursive) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      await visit(path.join(current, entry.name));
    }
  }
  await visit(root);
  return { schema_version: '0.1', source: 'REAL', directory: root, recursive, projects: projects.sort() };
}

export async function getProjectInfo(projectPath: string, timeout?: TimeoutContext) {
  checkTimeout(timeout);
  const root = path.resolve(projectPath);
  const projectFile = path.join(root, 'project.godot');
  const projectText = await readFile(projectFile, 'utf8');
  const name = projectText.match(/^config\/name\s*=\s*"([^"]*)"/m)?.[1] || null;
  const mainScene = projectText.match(/^run\/main_scene\s*=\s*"([^"]*)"/m)?.[1] || null;
  const files: string[] = [];
  async function collect(current: string): Promise<void> {
    checkTimeout(timeout);
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await collect(target);
      else files.push(path.relative(root, target).split(path.sep).join('/'));
    }
  }
  await stat(root);
  await collect(root);
  return {
    schema_version: '0.1',
    source: 'REAL',
    projectPath: root,
    projectFile,
    name,
    mainScene,
    files: files.sort(),
  };
}

// Static editor-plane query: this reads a real .tscn and never claims runtime state.
export async function getSceneTree(projectPath: string, scenePath: string | null = null, timeout?: TimeoutContext) {
  checkTimeout(timeout);
  const root = path.resolve(projectPath);
  await stat(root);
  const relative = scenePath || (await getProjectInfo(root, timeout)).mainScene;
  if (!relative || !relative.startsWith('res://'))
    throw new Error('scenePath must use res:// or project main_scene must be configured');
  const sceneFile = path.resolve(root, relative.slice('res://'.length));
  if (sceneFile !== root && !sceneFile.startsWith(`${root}${path.sep}`))
    throw new Error('scenePath escapes project root');
  if (path.extname(sceneFile).toLowerCase() !== '.tscn') throw new Error('scenePath must reference a .tscn file');
  const text = await readFile(sceneFile, 'utf8');
  const nodes: Array<{ name: string; type: string; parent: string | null; owner: string | null }> = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\[node\s+([^\]]+)\]/);
    if (!match) continue;
    const attrs: Record<string, string> = {};
    for (const item of match[1].matchAll(/(\w+)="([^"]*)"|(\w+)=([^\s]+)/g)) {
      attrs[item[1] || item[3]] = item[2] ?? item[4];
    }
    if (!attrs.name || !attrs.type) continue;
    nodes.push({ name: attrs.name, type: attrs.type, parent: attrs.parent || null, owner: attrs.owner || null });
  }
  if (nodes.length === 0) throw new Error('scene contains no parseable nodes');
  return {
    schema_version: '0.1',
    source: 'REAL',
    capability: 'STATIC_SCENE_TREE',
    runtime: false,
    projectPath: root,
    scenePath: relative,
    sceneFile,
    nodes,
  };
}

export async function launchProject({
  godotPath,
  projectPath,
  evidenceDir,
  headless = false,
  extraArgs = [],
  timeout,
}: LaunchOptions) {
  const root = path.resolve(projectPath);
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const evidence = path.resolve(evidenceDir || path.join(root, '.harness', 'runs', runId));
  await mkdir(evidence, { recursive: true });
  const stdoutPath = path.join(evidence, 'stdout.log');
  const stderrPath = path.join(evidence, 'stderr.log');
  const metadataPath = path.join(evidence, 'process.json');
  const args: string[] = [];
  if (headless) args.push('--headless');
  args.push('--path', root, ...extraArgs);
  const child = spawn(resolveGodotPath(godotPath), args, {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, GODOT_PATH: resolveGodotPath(godotPath) },
    detached: process.platform !== 'win32',
  });
  const metadata: ProcessMetadata = {
    schema_version: '0.1',
    source: 'REAL',
    started: true,
    pid: child.pid,
    executable: resolveGodotPath(godotPath),
    arguments: args,
    project_path: root,
    started_at: new Date().toISOString(),
    exit_code: null,
    timed_out: false,
    cancelled: false,
    lifecycle: 'STARTING',
    stdout: stdoutPath,
    stderr: stderrPath,
  };
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  const runIdValue = path.basename(evidence) + '-' + Date.now().toString() + '-' + (child.pid ?? 'unknown').toString();
  if (child.pid) {
    try {
      runRegistry.register({ runId: runIdValue, pid: child.pid, projectPath: root, evidenceDir: evidence });
    } catch (error) {
      child.kill();
      throw error;
    }
  }
  let stdout = '',
    stderr = '';
  let cancelled = false;
  let timedOut = false;
  const terminate = () => {
    if (child.killed) return;
    cancelled = timeout?.cancelled === true;
    timedOut = timeout?.timedOut === true;
    if (process.platform === 'win32' && child.pid)
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    else if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
    metadata.lifecycle = timedOut ? 'TIMEOUT' : 'CANCELLED';
    metadata.timed_out = timedOut;
    metadata.cancelled = cancelled;
    void writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  };
  timeout?.signal.addEventListener('abort', terminate, { once: true });
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.once('spawn', async () => {
    metadata.lifecycle = 'RUNNING';
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  });
  const close = new Promise((resolve) =>
    child.once('close', async (code) => {
      metadata.exit_code = code;
      metadata.finished_at = new Date().toISOString();
      timeout?.signal.removeEventListener('abort', terminate);
      metadata.lifecycle = timedOut ? 'TIMEOUT' : cancelled ? 'CANCELLED' : code === 0 ? 'EXITED' : 'FAILED';
      metadata.timed_out = timedOut;
      metadata.cancelled = cancelled;
      if (child.pid) {
        const terminalState = timedOut ? 'FAILED' : cancelled ? 'CANCELLED' : code === 0 ? 'STOPPED' : 'FAILED';
        try {
          runRegistry.markTerminal(runIdValue, terminalState, code);
        } catch {
          /* preserve process evidence */
        }
      }
      await writeFile(stdoutPath, stdout);
      await writeFile(stderrPath, stderr);
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      resolve(metadata);
    }),
  );
  return { metadata, child, close };
}

export async function stopProcess(pid: number, timeoutMs = 5000, timeout?: TimeoutContext) {
  if (!Number.isInteger(Number(pid))) throw new Error('pid must be an integer');
  if (!Number.isInteger(Number(timeoutMs)) || Number(timeoutMs) < 0)
    throw new Error('timeoutMs must be a non-negative integer');
  const processHandle = Number(pid);
  timeout?.throwIfCancelled();
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(processHandle), '/T', '/F'], { windowsHide: true });
      await new Promise((resolve) => killer.once('close', resolve));
    } else process.kill(-processHandle);
  } catch (error: unknown) {
    if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    timeout?.throwIfCancelled();
    try {
      process.kill(processHandle, 0);
    } catch (error: unknown) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ESRCH')
        return { stopped: true, pid: processHandle };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { stopped: false, pid: processHandle, timed_out: true };
}

export async function cancelProcess(pid: number, timeoutMs = 5000, timeout?: TimeoutContext) {
  const result = await stopProcess(pid, timeoutMs, timeout);
  return { ...result, cancelled: true, lifecycle: result.stopped ? 'CANCELLED' : 'TIMEOUT' };
}

export function getProcessStatus(pid: number) {
  if (!Number.isInteger(Number(pid))) throw new Error('pid must be an integer');
  const processHandle = Number(pid);
  try {
    process.kill(processHandle, 0);
    return { schema_version: '0.1', source: 'REAL', pid: processHandle, running: true };
  } catch (error: unknown) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ESRCH')
      return { schema_version: '0.1', source: 'REAL', pid: processHandle, running: false };
    throw error;
  }
}

export async function queryRuntimeSceneTree({
  godotPath,
  projectPath,
  evidenceDir,
  bridgePath,
  timeout,
}: BridgeOptions) {
  const root = path.resolve(projectPath);
  const evidence = path.resolve(evidenceDir || path.join(root, '.harness', 'runtime-bridge'));
  await mkdir(evidence, { recursive: true });
  const requestPath = path.join(evidence, 'request.json');
  const responsePath = path.join(evidence, 'response.json');
  const eventsPath = path.join(evidence, 'events.jsonl');
  await writeFile(requestPath, JSON.stringify({ method: 'get_scene_tree' }));
  const projectInfo = await getProjectInfo(root, timeout);
  const result = await runProcess(
    resolveGodotPath(godotPath),
    ['--headless', '--path', root, '--script', path.resolve(bridgePath)],
    root,
    30,
    {
      GODOT_HARNESS_REQUEST: requestPath,
      GODOT_HARNESS_RESPONSE: responsePath,
      GODOT_HARNESS_EVENTS: eventsPath,
      GODOT_HARNESS_RUN_ID: path.basename(evidence),
      GODOT_HARNESS_MAIN_SCENE: projectInfo.mainScene || '',
    },
    timeout,
  );
  ensureProcessSuccess(result);
  const response = await readFile(responsePath, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  return {
    schema_version: '0.1',
    source: 'REAL',
    evidenceDir: evidence,
    requestPath,
    responsePath,
    eventsPath,
    process: { exit_code: result.exitCode, stdout: result.stdout, stderr: result.stderr },
    response,
  };
}

export async function queryRuntimeProperty({
  godotPath,
  projectPath,
  evidenceDir,
  bridgePath,
  nodePath = '.',
  property,
  timeout,
}: PropertyOptions) {
  const root = path.resolve(projectPath);
  const evidence = path.resolve(evidenceDir || path.join(root, '.harness', 'runtime-property'));
  await mkdir(evidence, { recursive: true });
  const requestPath = path.join(evidence, 'request.json');
  const responsePath = path.join(evidence, 'response.json');
  const eventsPath = path.join(evidence, 'events.jsonl');
  await writeFile(requestPath, JSON.stringify({ method: 'get_property', nodePath, property }));
  const projectInfo = await getProjectInfo(root, timeout);
  const result = await runProcess(
    resolveGodotPath(godotPath),
    ['--headless', '--path', root, '--script', path.resolve(bridgePath)],
    root,
    30,
    {
      GODOT_HARNESS_REQUEST: requestPath,
      GODOT_HARNESS_RESPONSE: responsePath,
      GODOT_HARNESS_EVENTS: eventsPath,
      GODOT_HARNESS_RUN_ID: path.basename(evidence),
      GODOT_HARNESS_MAIN_SCENE: projectInfo.mainScene || '',
    },
    timeout,
  );
  ensureProcessSuccess(result);
  const response = await readFile(responsePath, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  return {
    schema_version: '0.1',
    source: 'REAL',
    evidenceDir: evidence,
    requestPath,
    responsePath,
    process: { exit_code: result.exitCode, stdout: result.stdout, stderr: result.stderr },
    response,
  };
}

export async function mutateRuntimeProperty({
  godotPath,
  projectPath,
  evidenceDir,
  bridgePath,
  nodePath = '.',
  property,
  value,
  timeout,
}: PropertyOptions & { value: unknown }) {
  const root = path.resolve(projectPath);
  const evidence = path.resolve(evidenceDir || path.join(root, '.harness', 'runtime-property-write'));
  await mkdir(evidence, { recursive: true });
  const requestPath = path.join(evidence, 'request.json');
  const responsePath = path.join(evidence, 'response.json');
  const eventsPath = path.join(evidence, 'events.jsonl');
  await writeFile(requestPath, JSON.stringify({ method: 'set_property', nodePath, property, value }));
  const projectInfo = await getProjectInfo(root, timeout);
  const result = await runProcess(
    resolveGodotPath(godotPath),
    ['--headless', '--path', root, '--script', path.resolve(bridgePath)],
    root,
    30,
    {
      GODOT_HARNESS_REQUEST: requestPath,
      GODOT_HARNESS_RESPONSE: responsePath,
      GODOT_HARNESS_EVENTS: eventsPath,
      GODOT_HARNESS_RUN_ID: path.basename(evidence),
      GODOT_HARNESS_MAIN_SCENE: projectInfo.mainScene || '',
    },
    timeout,
  );
  ensureProcessSuccess(result);
  const response = await readFile(responsePath, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  return {
    schema_version: '0.1',
    source: 'REAL',
    evidenceDir: evidence,
    requestPath,
    responsePath,
    process: { exit_code: result.exitCode, stdout: result.stdout, stderr: result.stderr },
    response,
  };
}

export async function injectRuntimeInput({
  godotPath,
  projectPath,
  evidenceDir,
  bridgePath,
  keycode,
  pressed = true,
  timeout,
}: InputOptions) {
  const root = path.resolve(projectPath);
  const evidence = path.resolve(evidenceDir || path.join(root, '.harness', 'runtime-input'));
  await mkdir(evidence, { recursive: true });
  const requestPath = path.join(evidence, 'request.json');
  const responsePath = path.join(evidence, 'response.json');
  const eventsPath = path.join(evidence, 'events.jsonl');
  await writeFile(requestPath, JSON.stringify({ method: 'inject_input', keycode, pressed }));
  const projectInfo = await getProjectInfo(root, timeout);
  const result = await runProcess(
    resolveGodotPath(godotPath),
    ['--headless', '--path', root, '--script', path.resolve(bridgePath)],
    root,
    30,
    {
      GODOT_HARNESS_REQUEST: requestPath,
      GODOT_HARNESS_RESPONSE: responsePath,
      GODOT_HARNESS_EVENTS: eventsPath,
      GODOT_HARNESS_RUN_ID: path.basename(evidence),
      GODOT_HARNESS_MAIN_SCENE: projectInfo.mainScene || '',
    },
    timeout,
  );
  ensureProcessSuccess(result);
  const response = await readFile(responsePath, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  return {
    schema_version: '0.1',
    source: 'REAL',
    evidenceDir: evidence,
    requestPath,
    responsePath,
    process: { exit_code: result.exitCode, stdout: result.stdout, stderr: result.stderr },
    response,
  };
}

export async function captureRuntimeScreenshot({
  godotPath,
  projectPath,
  evidenceDir,
  bridgePath,
  screenshotPath,
  timeout,
}: ScreenshotOptions) {
  const root = path.resolve(projectPath);
  const evidence = path.resolve(evidenceDir || path.join(root, '.harness', 'runtime-screenshot'));
  await mkdir(evidence, { recursive: true });
  const outputPath = path.resolve(screenshotPath || path.join(evidence, 'screenshot.png'));
  if (outputPath !== evidence && !outputPath.startsWith(`${evidence}${path.sep}`))
    throw new Error('screenshotPath must be inside evidenceDir');
  const requestPath = path.join(evidence, 'request.json');
  const responsePath = path.join(evidence, 'response.json');
  await writeFile(requestPath, JSON.stringify({ method: 'capture_screenshot', path: outputPath }));
  const projectInfo = await getProjectInfo(root, timeout);
  const result = await runProcess(
    resolveGodotPath(godotPath),
    ['--path', root, '--script', path.resolve(bridgePath)],
    root,
    30,
    {
      GODOT_HARNESS_REQUEST: requestPath,
      GODOT_HARNESS_RESPONSE: responsePath,
      GODOT_HARNESS_MAIN_SCENE: projectInfo.mainScene || '',
    },
    timeout,
  );
  ensureProcessSuccess(result);
  const response = await readFile(responsePath, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  const imageStat = await stat(outputPath)
    .then((value) => ({ bytes: value.size }))
    .catch(() => null);
  return {
    schema_version: '0.1',
    source: 'REAL',
    evidenceDir: evidence,
    screenshotPath: outputPath,
    image: imageStat,
    requestPath,
    responsePath,
    process: { exit_code: result.exitCode, stdout: result.stdout, stderr: result.stderr },
    response,
  };
}

export async function stopLaunchedProcess(
  launch: { child: { pid?: number }; close: Promise<unknown> },
  timeoutMs = 5000,
) {
  if (!launch.child.pid) throw new Error('launched process has no pid');
  const result = await stopProcess(launch.child.pid, timeoutMs);
  await Promise.race([launch.close, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  return result;
}

export async function readEvidence(evidenceDir: string) {
  const root = path.resolve(evidenceDir);
  const [metadata, stdout, stderr] = await Promise.all([
    readFile(path.join(root, 'process.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'stdout.log'), 'utf8').catch(() => ''),
    readFile(path.join(root, 'stderr.log'), 'utf8').catch(() => ''),
  ]);
  return { metadata, stdout, stderr };
}

function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  timeoutSeconds: number,
  extraEnv: Record<string, string> = {},
  timeout?: TimeoutContext,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const context = timeout ?? createTimeoutContext(timeoutSeconds * 1000);
    const ownsContext = !timeout;
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, ...extraEnv },
    });
    let stdout = '',
      stderr = '',
      timedOut = false,
      cancelled = false,
      settled = false;
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const terminate = () => {
      if (settled) return;
      timedOut = context.timedOut;
      cancelled = context.cancelled;
      if (process.platform === 'win32' && child.pid)
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch (error: unknown) {
          if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGTERM');
        }
      }
    };
    const timer = setTimeout(terminate, context.remaining());
    context.signal.addEventListener('abort', terminate, { once: true });
    const finish = (exitCode: number | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      context.signal.removeEventListener('abort', terminate);
      const code =
        timedOut || context.timedOut
          ? 'TIMEOUT'
          : cancelled || context.cancelled
            ? 'CANCELLED'
            : error || exitCode !== 0
              ? 'FAILED'
              : 'OK';
      if (ownsContext) context.dispose();
      resolve({
        stdout,
        stderr,
        exitCode: code === 'OK' ? exitCode : null,
        code,
        timed_out: code === 'TIMEOUT',
        cancelled: code === 'CANCELLED',
      });
    };
    child.once('close', (exitCode) => {
      finish(exitCode);
    });
    child.once('error', (error) => {
      stderr += error.message;
      finish(null, error);
    });
  });
}

function ensureProcessSuccess(result: ProcessResult): void {
  if (result.code === 'TIMEOUT') throw new TimeoutError('Godot bridge timed out');
  if (result.code === 'CANCELLED') throw new CancelledError('Godot bridge cancelled');
  if (result.code === 'FAILED')
    throw new Error(`Godot bridge failed: ${result.stderr.trim() || 'process exited with an error'}`);
}

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { CancelledError, createTimeoutContext, TimeoutContext, TimeoutError } from './timeout.js';
import { runRegistry } from './run-registry.js';
import { transitionLifecycle } from './tool-types.js';
import type { LifecycleState } from './tool-types.js';
import { DEFAULT_GODOT_PROCESS_TIMEOUT_MS, DEFAULT_STOP_TIMEOUT_MS } from './timeouts.js';
import { ensureEvidenceManifest, finalizeBridgeEvidence, writeEvidenceJson } from './evidence.js';
import { terminateProcessTree, type ProcessTreeResult } from './process-tree.js';
import { readRuntimeEvents, readRuntimeEventsSince, subscribeRuntimeEvents } from './runtime-events.js';
import { resolveGodotPathSync } from './godot-path.js';
import { BridgeRpcError, validateBridgeResult } from './bridge-protocol.js';
import { isStableErrorCode } from './error-schema.js';
import { WheelError } from './error-schema.js';
import { validateVariantInput } from './protocol/variant.js';
import { readProcessIdentity, type ProcessIdentity } from './process-identity.js';
import { resolveProjectPath } from './project/paths.js';
import { EvidenceLog } from './evidence-log.js';
export {
  readRuntimeEvents,
  readRuntimeEventsSince,
  subscribeRuntimeEvents,
  streamRuntimeEvents,
  streamEventSubscription,
  createEventSubscription,
  pollEventSubscription,
  cancelEventSubscription,
  acknowledgeEventSubscription,
  pauseEventSubscription,
  closeEventSubscription,
  listEventSubscriptions,
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
  run_id?: string;
  process_identity?: ProcessIdentity;
  executable: string;
  arguments: string[];
  project_path: string;
  started_at: string;
  finished_at?: string;
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  timed_out: boolean;
  cancelled: boolean;
  lifecycle: LifecycleState;
  stdout: string;
  stderr: string;
  process_tree?: ProcessTreeResult;
  evidence_status?: 'COMPLETE' | 'INCOMPLETE';
  evidence_error?: string;
};

// Stop/cancel requests for children launched by this process, keyed by pid, so the
// close handler can record STOPPED/CANCELLED instead of a bare signal-death FAILED.
const terminationRequests = new Map<number, 'STOPPED' | 'CANCELLED' | null>();

type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  started: boolean;
  code: 'OK' | 'TIMEOUT' | 'CANCELLED' | 'FAILED';
  timed_out: boolean;
  cancelled: boolean;
  evidence_status?: 'COMPLETE' | 'INCOMPLETE';
  evidence_error?: string;
};

export function resolveGodotPath(value = process.env.GODOT_PATH) {
  return resolveGodotPathSync(value);
}

export { discoverGodotPath, parseEnvFile, resolveGodotPathSync } from './godot-path.js';

function checkTimeout(timeout?: TimeoutContext): void {
  timeout?.throwIfCancelled();
  timeout?.throwIfExpired();
}

export async function getGodotVersion(godotPath: string, timeout?: TimeoutContext): Promise<string> {
  checkTimeout(timeout);
  const result = await runProcess(
    godotPath,
    ['--version'],
    process.cwd(),
    DEFAULT_GODOT_PROCESS_TIMEOUT_MS / 1000,
    {},
    timeout,
  );
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
  const projectFile = (await resolveProjectPath(root, 'project.godot', { mode: 'read' })).absolutePath;
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
      else if (entry.isFile()) files.push(path.relative(root, target).split(path.sep).join('/'));
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
export type SceneTreeQuery = {
  subtree?: string;
  depth?: number;
  fields?: Array<'name' | 'type' | 'parent' | 'owner' | 'path'>;
  limit?: number;
  cursor?: number;
};

export async function getSceneTree(
  projectPath: string,
  scenePath: string | null = null,
  timeout?: TimeoutContext,
  query: SceneTreeQuery = {},
) {
  checkTimeout(timeout);
  const root = path.resolve(projectPath);
  await stat(root);
  const relative = scenePath || (await getProjectInfo(root, timeout)).mainScene;
  if (!relative || !relative.startsWith('res://'))
    throw new Error('scenePath must use res:// or project main_scene must be configured');
  let sceneFile: string;
  try {
    sceneFile = (await resolveProjectPath(root, relative, { mode: 'read' })).absolutePath;
  } catch (error) {
    throw new Error(`scenePath escapes project root or is unsafe: ${(error as Error).message}`, { cause: error });
  }
  if (path.extname(sceneFile).toLowerCase() !== '.tscn') throw new Error('scenePath must reference a .tscn file');
  const limit = query.limit ?? 100;
  const cursor = query.cursor ?? 0;
  const depth = query.depth ?? 64;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('scene tree limit must be 1–500');
  if (!Number.isInteger(cursor) || cursor < 0) throw new Error('scene tree cursor must be non-negative');
  if (!Number.isInteger(depth) || depth < 0 || depth > 64) throw new Error('scene tree depth must be 0–64');
  const subtree = query.subtree ?? '.';
  const fields = query.fields ?? ['name', 'type', 'parent', 'owner'];
  const allowed = new Set(['name', 'type', 'parent', 'owner', 'path']);
  if (fields.some((field) => !allowed.has(field))) throw new Error('unknown scene tree field');
  const nodes: Array<Record<string, string | null>> = [];
  let parsed = 0;
  let matched = 0;
  let truncated = false;
  const input = createReadStream(sceneFile, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      checkTimeout(timeout);
      const match = line.match(/^\[node\s+([^\]]+)\]/);
      if (!match) continue;
      const attrs: Record<string, string> = {};
      for (const item of match[1].matchAll(/(\w+)="([^"]*)"|(\w+)=([^\s]+)/g))
        attrs[item[1] || item[3]] = item[2] ?? item[4];
      if (!attrs.name || !attrs.type) continue;
      const nodePath =
        parsed++ === 0 ? '.' : attrs.parent && attrs.parent !== '.' ? `${attrs.parent}/${attrs.name}` : attrs.name;
      if (subtree !== '.' && nodePath !== subtree && !nodePath.startsWith(`${subtree}/`)) continue;
      const relativeDepth =
        (nodePath === '.' ? 0 : nodePath.split('/').length) - (subtree === '.' ? 0 : subtree.split('/').length);
      if (relativeDepth > depth) continue;
      if (matched++ < cursor) continue;
      if (nodes.length >= limit) {
        truncated = true;
        break;
      }
      const node = {
        name: attrs.name,
        type: attrs.type,
        parent: attrs.parent || null,
        owner: attrs.owner || null,
        path: nodePath,
      };
      nodes.push(Object.fromEntries(fields.map((field) => [field, node[field]])));
    }
  } finally {
    lines.close();
    input.destroy();
  }
  if (parsed === 0) throw new Error('scene contains no parseable nodes');
  return {
    schema_version: '0.1',
    source: 'REAL',
    capability: 'STATIC_SCENE_TREE',
    runtime: false,
    projectPath: root,
    scenePath: relative,
    sceneFile,
    nodes,
    truncated,
    next_cursor: truncated ? cursor + nodes.length : null,
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
  await ensureEvidenceManifest(evidence, 'PROCESS_EVIDENCE');
  const stdoutPath = path.join(evidence, 'stdout.log');
  const stderrPath = path.join(evidence, 'stderr.log');
  const metadataPath = path.join(evidence, 'process.json');
  const godotLogFile = path.join(evidence, 'godot.log');
  const logs = await EvidenceLog.create(evidence);
  await mkdir(path.dirname(godotLogFile), { recursive: true });
  const args: string[] = [];
  if (headless) args.push('--headless');
  args.push('--path', root);
  args.push('--log-file', godotLogFile);
  args.push(...extraArgs);
  const child = spawn(resolveGodotPath(godotPath), args, {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, GODOT_PATH: resolveGodotPath(godotPath) },
    detached: process.platform !== 'win32',
  });
  let spawnError: Error | undefined;
  child.on('error', (error) => {
    spawnError = error;
    logs.append('stderr', error.message + '\n');
  });
  let cancelled = timeout?.cancelled === true;
  let timedOut = timeout?.timedOut === true;
  const runIdValue = path.basename(evidence) + '-' + Date.now().toString() + '-' + (child.pid ?? 'unknown').toString();
  const metadata: ProcessMetadata = {
    schema_version: '0.1',
    source: 'REAL',
    started: true,
    pid: child.pid,
    run_id: runIdValue,
    executable: resolveGodotPath(godotPath),
    arguments: args,
    project_path: root,
    started_at: new Date().toISOString(),
    exit_code: null,
    signal: null,
    timed_out: false,
    cancelled: false,
    lifecycle: 'STARTING',
    stdout: stdoutPath,
    stderr: stderrPath,
  };
  let metadataWrites: Promise<void> = Promise.resolve();
  const saveMetadata = () => {
    const snapshot = structuredClone(metadata);
    metadataWrites = metadataWrites.then(() => writeEvidenceJson(metadataPath, snapshot));
    return metadataWrites;
  };
  if (child.pid) terminationRequests.set(child.pid, null);
  let identityCapture: Promise<ProcessIdentity | null> = Promise.resolve(null);
  let terminationPromise: Promise<void> | null = null;
  const terminate = () => {
    if (child.killed) return;
    cancelled = timeout?.cancelled === true;
    timedOut = timeout?.timedOut === true;
    if (child.pid) {
      terminationPromise = terminateProcessTree(child.pid).then(async (tree) => {
        metadata.process_tree = tree;
        await saveMetadata();
        const manifestPath = path.join(evidence, 'manifest.json');
        const manifest = await readFile(manifestPath, 'utf8')
          .then(JSON.parse)
          .catch(() => ({}));
        await writeFile(manifestPath, JSON.stringify({ ...manifest, process_tree: tree }, null, 2));
      });
    }
    metadata.lifecycle = transitionLifecycle(metadata.lifecycle, timedOut ? 'TIMEOUT' : 'CANCELLED');
    metadata.timed_out = timedOut;
    metadata.cancelled = cancelled;
    void saveMetadata().catch(() => undefined);
  };
  timeout?.signal.addEventListener('abort', terminate, { once: true });
  const logFailure = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };
  logs.attach(child.stdout, 'stdout', logFailure);
  logs.attach(child.stderr, 'stderr', logFailure);
  child.once('spawn', () => {
    void (async () => {
      if (timeout?.signal.aborted) {
        cancelled = timeout.cancelled;
        timedOut = timeout.timedOut;
        metadata.lifecycle = transitionLifecycle(metadata.lifecycle, timedOut ? 'TIMEOUT' : 'CANCELLED');
        metadata.timed_out = timedOut;
        metadata.cancelled = cancelled;
        await saveMetadata();
        terminate();
        return;
      }
      metadata.lifecycle = 'RUNNING';
      await saveMetadata();
    })().catch((error: unknown) => {
      metadata.evidence_status = 'INCOMPLETE';
      metadata.evidence_error = String(error);
      child.kill();
    });
  });
  const close = new Promise<ProcessMetadata>((resolve, reject) =>
    child.once('close', async (code, signal) => {
      try {
        if (terminationPromise) await terminationPromise;
        const requested = child.pid ? terminationRequests.get(child.pid) : null;
        if (child.pid) terminationRequests.delete(child.pid);
        if (requested === 'CANCELLED') cancelled = true;
        metadata.exit_code = code;
        metadata.signal = signal;
        metadata.started = !spawnError;
        metadata.finished_at = new Date().toISOString();
        timeout?.signal.removeEventListener('abort', terminate);
        const registeredState = runRegistry.get(runIdValue)?.state;
        const terminalState = timedOut
          ? 'TIMEOUT'
          : cancelled || registeredState === 'CANCELLING' || registeredState === 'CANCELLED'
            ? 'CANCELLED'
            : requested === 'STOPPED' || registeredState === 'STOPPING' || registeredState === 'STOPPED'
              ? 'STOPPED'
              : code === 0
                ? 'EXITED'
                : 'FAILED';
        metadata.lifecycle = transitionLifecycle(metadata.lifecycle, terminalState);
        metadata.timed_out = timedOut;
        metadata.cancelled = terminalState === 'CANCELLED';
        if (child.pid) {
          try {
            runRegistry.markTerminal(runIdValue, terminalState, code);
          } catch {
            /* preserve process evidence */
          }
        }
        metadata.evidence_status = 'COMPLETE';
        try {
          await logs.drain();
        } catch (error) {
          metadata.evidence_status = 'INCOMPLETE';
          metadata.evidence_error = String(error);
        }
        await saveMetadata();
        const manifestPath = path.join(evidence, 'manifest.json');
        const manifest = await readFile(manifestPath, 'utf8')
          .then(JSON.parse)
          .catch(() => ({}));
        await writeEvidenceJson(manifestPath, {
          ...manifest,
          finished_at: metadata.finished_at,
          lifecycle: metadata.lifecycle,
          evidence_status: metadata.evidence_status,
        });
        resolve(metadata);
      } catch (error) {
        reject(error);
      }
    }),
  );
  // Callers may only retain metadata for a detached launch. Avoid an unhandled
  // rejection while preserving the error for anyone explicitly awaiting close.
  void close.catch(() => undefined);
  // Install pipe/close/error handlers before registry writes: failed admission
  // still drains the child and leaves truthful failure evidence.
  if (child.pid) {
    try {
      runRegistry.register({ runId: runIdValue, pid: child.pid, projectPath: root, evidenceDir: evidence });
      identityCapture = readProcessIdentity(child.pid).then((identity) => {
        if (identity) {
          runRegistry.attachIdentity(runIdValue, identity);
          metadata.process_identity = identity;
        }
        return identity;
      });
    } catch (error) {
      child.kill();
      await close;
      throw error;
    }
  }
  if (child.exitCode === null && child.signalCode === null) await saveMetadata();
  let capturedIdentity: ProcessIdentity | null;
  try {
    capturedIdentity = await identityCapture;
  } catch (error) {
    child.kill();
    await Promise.race([close, new Promise((resolve) => setTimeout(resolve, DEFAULT_STOP_TIMEOUT_MS))]);
    throw error;
  }
  if (!capturedIdentity && child.exitCode === null && child.signalCode === null) {
    child.kill();
    await Promise.race([close, new Promise((resolve) => setTimeout(resolve, DEFAULT_STOP_TIMEOUT_MS))]);
    throw new WheelError('UNSUPPORTED', 'unable to verify launched process identity; process was stopped');
  }
  if (capturedIdentity && child.exitCode === null && child.signalCode === null) await saveMetadata();
  return { metadata, child, close };
}

export async function stopProcess(pid: number, timeoutMs = DEFAULT_STOP_TIMEOUT_MS, timeout?: TimeoutContext) {
  if (!Number.isInteger(Number(pid))) throw new Error('pid must be an integer');
  if (!Number.isInteger(Number(timeoutMs)) || Number(timeoutMs) < 0)
    throw new Error('timeoutMs must be a non-negative integer');
  const processHandle = Number(pid);
  const ownsRequest = terminationRequests.get(processHandle) === null;
  if (ownsRequest) terminationRequests.set(processHandle, 'STOPPED');
  try {
    const result = await stopProcessHandle(processHandle, timeoutMs, timeout);
    if (!result.stopped && ownsRequest) terminationRequests.set(processHandle, null);
    return result;
  } catch (error) {
    if (ownsRequest && terminationRequests.has(processHandle)) terminationRequests.set(processHandle, null);
    throw error;
  }
}

async function stopProcessHandle(processHandle: number, timeoutMs: number, timeout?: TimeoutContext) {
  try {
    process.kill(processHandle, 0);
  } catch (error: unknown) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ESRCH')
      return { stopped: true, pid: processHandle };
  }
  try {
    if (process.platform === 'win32') {
      const tree = await terminateProcessTree(processHandle);
      if (tree.terminated)
        return { stopped: true, pid: processHandle, process_tree_terminated: true, process_tree: tree };
      if (tree.error_code === 'ACCESS_DENIED')
        return { stopped: false, pid: processHandle, timed_out: false, process_tree: tree };
      if (tree.error_code === 'NOT_FOUND') return { stopped: true, pid: processHandle, process_tree: tree };
    } else {
      const tree = await terminateProcessTree(processHandle);
      if (tree.terminated) return { stopped: true, pid: processHandle, process_tree: tree };
    }
  } catch (error: unknown) {
    if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(processHandle, 0);
    } catch (error: unknown) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ESRCH')
        return { stopped: true, pid: processHandle };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (timeout?.timedOut) throw new TimeoutError(`process did not stop before timeout: ${processHandle}`);
  return { stopped: false, pid: processHandle, timed_out: true };
}

export async function cancelProcess(pid: number, timeoutMs = DEFAULT_STOP_TIMEOUT_MS, timeout?: TimeoutContext) {
  const ownsRequest = terminationRequests.get(Number(pid)) === null;
  if (ownsRequest) terminationRequests.set(Number(pid), 'CANCELLED');
  const result = await stopProcess(pid, timeoutMs, timeout).catch((error: unknown) => {
    if (ownsRequest && terminationRequests.has(Number(pid))) terminationRequests.set(Number(pid), null);
    throw error;
  });
  if (!result.stopped && ownsRequest) terminationRequests.set(Number(pid), null);
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
  subtree,
  depth,
  fields,
  limit,
  cursor,
}: BridgeOptions & SceneTreeQuery) {
  const root = path.resolve(projectPath);
  const evidence = path.resolve(evidenceDir || path.join(root, '.harness', 'runtime-bridge'));
  await mkdir(evidence, { recursive: true });
  await ensureEvidenceManifest(evidence, 'BRIDGE_EVIDENCE');
  const requestPath = path.join(evidence, 'request.json');
  const responsePath = path.join(evidence, 'response.json');
  const eventsPath = path.join(evidence, 'events.jsonl');
  await writeFile(requestPath, JSON.stringify({ method: 'get_scene_tree', subtree, depth, fields, limit, cursor }));
  const projectInfo = await getProjectInfo(root, timeout);
  const result = await runProcess(
    resolveGodotPath(godotPath),
    ['--headless', '--path', root, '--script', path.resolve(bridgePath)],
    root,
    DEFAULT_GODOT_PROCESS_TIMEOUT_MS / 1000,
    {
      GODOT_HARNESS_REQUEST: requestPath,
      GODOT_HARNESS_RESPONSE: responsePath,
      GODOT_HARNESS_EVENTS: eventsPath,
      GODOT_HARNESS_RUN_ID: path.basename(evidence),
      GODOT_HARNESS_MAIN_SCENE: projectInfo.mainScene || '',
    },
    timeout,
  );
  const response = await readFile(responsePath, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  await finalizeBridgeEvidence(evidence, { method: 'get_scene_tree' }, response, result);
  assertLegacyBridgeResponse('get_scene_tree', response, result);
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
  await ensureEvidenceManifest(evidence, 'BRIDGE_EVIDENCE');
  const requestPath = path.join(evidence, 'request.json');
  const responsePath = path.join(evidence, 'response.json');
  const eventsPath = path.join(evidence, 'events.jsonl');
  await writeFile(requestPath, JSON.stringify({ method: 'get_property', nodePath, property }));
  const projectInfo = await getProjectInfo(root, timeout);
  const result = await runProcess(
    resolveGodotPath(godotPath),
    ['--headless', '--path', root, '--script', path.resolve(bridgePath)],
    root,
    DEFAULT_GODOT_PROCESS_TIMEOUT_MS / 1000,
    {
      GODOT_HARNESS_REQUEST: requestPath,
      GODOT_HARNESS_RESPONSE: responsePath,
      GODOT_HARNESS_EVENTS: eventsPath,
      GODOT_HARNESS_RUN_ID: path.basename(evidence),
      GODOT_HARNESS_MAIN_SCENE: projectInfo.mainScene || '',
    },
    timeout,
  );
  const response = await readFile(responsePath, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  await finalizeBridgeEvidence(evidence, { method: 'get_property', nodePath, property }, response, result);
  assertLegacyBridgeResponse('get_property', response, result);
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
  validateVariantInput(value);
  const root = path.resolve(projectPath);
  const evidence = path.resolve(evidenceDir || path.join(root, '.harness', 'runtime-property-write'));
  await mkdir(evidence, { recursive: true });
  await ensureEvidenceManifest(evidence, 'BRIDGE_EVIDENCE');
  const requestPath = path.join(evidence, 'request.json');
  const responsePath = path.join(evidence, 'response.json');
  const eventsPath = path.join(evidence, 'events.jsonl');
  await writeFile(requestPath, JSON.stringify({ method: 'set_property', nodePath, property, value }));
  const projectInfo = await getProjectInfo(root, timeout);
  const result = await runProcess(
    resolveGodotPath(godotPath),
    ['--headless', '--path', root, '--script', path.resolve(bridgePath)],
    root,
    DEFAULT_GODOT_PROCESS_TIMEOUT_MS / 1000,
    {
      GODOT_HARNESS_REQUEST: requestPath,
      GODOT_HARNESS_RESPONSE: responsePath,
      GODOT_HARNESS_EVENTS: eventsPath,
      GODOT_HARNESS_RUN_ID: path.basename(evidence),
      GODOT_HARNESS_MAIN_SCENE: projectInfo.mainScene || '',
    },
    timeout,
  );
  const response = await readFile(responsePath, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  await finalizeBridgeEvidence(evidence, { method: 'set_property', nodePath, property, value }, response, result);
  assertLegacyBridgeResponse('set_property', response, result);
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
  await ensureEvidenceManifest(evidence, 'BRIDGE_EVIDENCE');
  const requestPath = path.join(evidence, 'request.json');
  const responsePath = path.join(evidence, 'response.json');
  const eventsPath = path.join(evidence, 'events.jsonl');
  await writeFile(requestPath, JSON.stringify({ method: 'inject_input', keycode, pressed }));
  const projectInfo = await getProjectInfo(root, timeout);
  const result = await runProcess(
    resolveGodotPath(godotPath),
    ['--headless', '--path', root, '--script', path.resolve(bridgePath)],
    root,
    DEFAULT_GODOT_PROCESS_TIMEOUT_MS / 1000,
    {
      GODOT_HARNESS_REQUEST: requestPath,
      GODOT_HARNESS_RESPONSE: responsePath,
      GODOT_HARNESS_EVENTS: eventsPath,
      GODOT_HARNESS_RUN_ID: path.basename(evidence),
      GODOT_HARNESS_MAIN_SCENE: projectInfo.mainScene || '',
    },
    timeout,
  );
  const response = await readFile(responsePath, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  await finalizeBridgeEvidence(evidence, { method: 'inject_input', keycode, pressed }, response, result);
  assertLegacyBridgeResponse('inject_input', response, result);
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
  await ensureEvidenceManifest(evidence, 'BRIDGE_EVIDENCE');
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
    DEFAULT_GODOT_PROCESS_TIMEOUT_MS / 1000,
    {
      GODOT_HARNESS_REQUEST: requestPath,
      GODOT_HARNESS_RESPONSE: responsePath,
      GODOT_HARNESS_MAIN_SCENE: projectInfo.mainScene || '',
    },
    timeout,
  );
  const response = await readFile(responsePath, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  await finalizeBridgeEvidence(evidence, { method: 'capture_screenshot', path: outputPath }, response, result);
  assertLegacyBridgeResponse('capture_screenshot', response, result);
  const imageStat = await stat(outputPath)
    .then((value) => ({ bytes: value.size }))
    .catch(() => null);
  const responseWidth = response?.width;
  const responseHeight = response?.height;
  if (
    response?.capability !== 'RUNTIME_SCREENSHOT' ||
    !Number.isInteger(responseWidth) ||
    !Number.isInteger(responseHeight) ||
    responseWidth < 16 ||
    responseHeight < 16 ||
    !imageStat ||
    imageStat.bytes < 100
  )
    throw new Error('Godot bridge returned an invalid screenshot');
  const png = await readFile(outputPath);
  if (
    png.length < 24 ||
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    png.readUInt32BE(16) !== responseWidth ||
    png.readUInt32BE(20) !== responseHeight
  )
    throw new Error('Godot bridge returned a malformed screenshot');
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
  launch: { metadata: { run_id?: string }; child: { pid?: number }; close: Promise<unknown> },
  timeoutMs = DEFAULT_STOP_TIMEOUT_MS,
) {
  if (!launch.child.pid || !launch.metadata.run_id) throw new Error('launched process has no registered identity');
  const result = await runRegistry.stop(launch.metadata.run_id, timeoutMs);
  await Promise.race([launch.close, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  return {
    stopped: result.state === 'STOPPED' || result.state === 'EXITED',
    pid: launch.child.pid,
    run_id: result.runId,
  };
}

type EvidencePageOptions = {
  stdoutCursor?: number;
  stderrCursor?: number;
  stdoutSegment?: string;
  stderrSegment?: string;
  limitBytes?: number;
};

async function readLogPage(file: string, cursor: number, limit: number) {
  const handle = await open(file, 'r').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!handle) return { text: '', nextCursor: null, totalBytes: 0 };
  try {
    const size = (await handle.stat()).size;
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > size)
      throw new WheelError('INVALID_ARGUMENT', 'log cursor is outside the selected segment');
    const buffer = Buffer.alloc(Math.min(limit + 4, size - cursor));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, cursor);
    if (cursor > 0 && bytesRead > 0 && (buffer[0] & 0xc0) === 0x80)
      throw new WheelError('INVALID_ARGUMENT', 'log cursor must be on a UTF-8 boundary');
    let end = Math.min(limit, bytesRead);
    while (end < bytesRead && (buffer[end] & 0xc0) === 0x80) end--;
    const next = cursor + end;
    return { text: buffer.subarray(0, end).toString('utf8'), nextCursor: next < size ? next : null, totalBytes: size };
  } finally {
    await handle.close();
  }
}

export async function readEvidence(evidenceDir: string, options: EvidencePageOptions = {}) {
  const root = path.resolve(evidenceDir);
  const limit = options.limitBytes ?? 16 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64 * 1024)
    throw new WheelError('INVALID_ARGUMENT', 'log page limit must be 1–65536 bytes');
  const names = await readdir(root);
  const segments = names.filter((name) => /^(stdout|stderr)\.\d{13}-\d{4}\.log$/.test(name)).sort();
  const selected = (kind: 'stdout' | 'stderr', segment?: string) => {
    const name = segment ?? `${kind}.log`;
    if (name !== `${kind}.log` && (!segments.includes(name) || !name.startsWith(`${kind}.`)))
      throw new WheelError('INVALID_ARGUMENT', 'unknown or wrong log segment');
    return path.join(root, name);
  };
  const [metadata, stdoutPage, stderrPage] = await Promise.all([
    readFile(path.join(root, 'process.json'), 'utf8')
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return readFile(path.join(root, 'persistent.json'), 'utf8');
      })
      .then(JSON.parse),
    readLogPage(selected('stdout', options.stdoutSegment), options.stdoutCursor ?? 0, limit),
    readLogPage(selected('stderr', options.stderrSegment), options.stderrCursor ?? 0, limit),
  ]);
  return {
    metadata,
    stdout: stdoutPage.text,
    stderr: stderrPage.text,
    stdoutNextCursor: stdoutPage.nextCursor,
    stderrNextCursor: stderrPage.nextCursor,
    stdoutTotalBytes: stdoutPage.totalBytes,
    stderrTotalBytes: stderrPage.totalBytes,
    availableSegments: segments,
  };
}

export async function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  timeoutSeconds: number,
  extraEnv: Record<string, string> = {},
  timeout?: TimeoutContext,
): Promise<ProcessResult> {
  // Inject --log-file so Godot writes its engine log inside the project
  // tree instead of user://logs which CI runners often cannot write to.
  const directory = extraEnv.GODOT_HARNESS_REQUEST
    ? path.dirname(extraEnv.GODOT_HARNESS_REQUEST)
    : path.join(cwd, '.harness', 'process-' + randomUUID());
  const logs = await EvidenceLog.create(directory);
  const godotLogFile = path.join(directory, 'godot.log');
  args = [...args, '--log-file', godotLogFile];
  return new Promise((resolve) => {
    const context = timeout ?? createTimeoutContext(timeoutSeconds * 1000);
    const ownsContext = !timeout;
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, ...extraEnv },
    });
    let timedOut = false,
      cancelled = false,
      settled = false;
    let spawnError: Error | undefined;
    let logError: Error | undefined;
    const logFailure = (error: Error) => {
      logError ??= error;
      if (!settled) child.kill();
    };
    logs.attach(child.stdout, 'stdout', logFailure);
    logs.attach(child.stderr, 'stderr', logFailure);
    const terminate = () => {
      if (settled) return;
      timedOut = context.timedOut;
      cancelled = context.cancelled;
      if (child.pid) void terminateProcessTree(child.pid);
    };
    const timer = setTimeout(terminate, context.remaining());
    context.signal.addEventListener('abort', terminate, { once: true });
    if (context.signal.aborted) terminate();
    const finish = async (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      context.signal.removeEventListener('abort', terminate);
      try {
        await logs.drain();
      } catch (error) {
        logError = error instanceof Error ? error : new Error(String(error));
      }
      const code =
        timedOut || context.timedOut
          ? 'TIMEOUT'
          : cancelled || context.cancelled
            ? 'CANCELLED'
            : spawnError || logError || exitCode !== 0
              ? 'FAILED'
              : 'OK';
      if (ownsContext) context.dispose();
      resolve({
        stdout: logs.tail('stdout'),
        stderr: logs.tail('stderr'),
        exitCode,
        signal,
        started: !spawnError,
        code,
        timed_out: code === 'TIMEOUT',
        cancelled: code === 'CANCELLED',
        evidence_status: logError ? 'INCOMPLETE' : 'COMPLETE',
        ...(logError ? { evidence_error: logError.message } : {}),
      });
    };
    child.once('close', (exitCode, signal) => {
      void finish(exitCode, signal);
    });
    child.once('error', (error) => {
      spawnError = error;
      logs.append('stderr', error.message + '\n');
    });
  });
}

function ensureProcessSuccess(result: ProcessResult): void {
  if (result.code === 'TIMEOUT') throw new TimeoutError('Godot bridge timed out');
  if (result.code === 'CANCELLED') throw new CancelledError('Godot bridge cancelled');
  if (result.code === 'FAILED')
    throw new Error(`Godot bridge failed: ${result.stderr.trim() || 'process exited with an error'}`);
}

function assertLegacyBridgeResponse(method: string, response: unknown, processResult: ProcessResult): void {
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    const value = response as Record<string, unknown>;
    if (value.status === 'FAIL')
      throw new BridgeRpcError(
        isStableErrorCode(value.code) ? value.code : 'INTERNAL_ERROR',
        typeof value.message === 'string' ? value.message : `Godot ${method} failed`,
        { method, bridgeResponse: value, exitCode: processResult.exitCode },
      );
  }
  if (processResult.code === 'FAILED')
    throw new BridgeRpcError('ENGINE_UNAVAILABLE', `Godot bridge process failed during ${method}`, {
      method,
      exitCode: processResult.exitCode,
      stderr: processResult.stderr,
    });
  ensureProcessSuccess(processResult);
  validateBridgeResult(method, response);
}

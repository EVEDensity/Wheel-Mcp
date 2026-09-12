import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { captureRuntimeScreenshot, injectRuntimeInput, launchProject, stopProcess } from './godot-runtime.js';
import { parse } from 'yaml';
import { createTimeoutContext } from './timeout.js';
import { DEFAULT_SCENARIO_TIMEOUT_MS, DEFAULT_STEP_TIMEOUT_MS, DEFAULT_STOP_TIMEOUT_MS } from './timeouts.js';
import { classifyError } from './error-schema.js';
import { PersistentRuntimeBridge } from './persistent-runtime-bridge.js';
import { parseScenario } from './scenario-schema.js';
import type {
  LaunchHandle,
  ScenarioDefinition,
  ScenarioExecutionContext,
  ScenarioRunStepResult,
  ScenarioStepOptions,
  ScenarioStepResult,
} from './tool-types.js';

export async function loadScenario(filePath: string) {
  const text = await readFile(filePath, 'utf8');
  const value = parse(text);
  return parseScenario(parse(text));
}

export interface ScenarioOptions {
  scenario: ScenarioDefinition;
  scenarioPath?: string;
  godotPath?: string;
  bridgePath?: string;
  evidenceDir?: string;
  defaultStepTimeoutMs?: number;
  globalTimeoutMs?: number;
  retries?: number;
  onFailure?: string;
  signal?: AbortSignal;
}
export async function executeScenario({
  scenario,
  scenarioPath,
  godotPath,
  bridgePath,
  evidenceDir,
  defaultStepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS,
  globalTimeoutMs = DEFAULT_SCENARIO_TIMEOUT_MS,
  retries = 0,
  onFailure = 'stop',
  signal,
}: ScenarioOptions) {
  const startedAt = new Date().toISOString();
  const evidence = path.resolve(evidenceDir || path.join(process.cwd(), '.harness', 'scenario'));
  await mkdir(evidence, { recursive: true });
  const deadline = Date.now() + globalTimeoutMs;
  const globalContext = createTimeoutContext(globalTimeoutMs, signal);
  const results: ScenarioStepResult[] = [];
  let launch: LaunchHandle | null = null;
  let bridge: PersistentRuntimeBridge | null = null;
  let failed = false;
  for (let index = 0; index < scenario.steps.length; index += 1) {
    const step = scenario.steps[index] || {};
    const [kind, rawOptions] = Object.entries(step as Record<string, unknown>)[0] || [];
    const options = (rawOptions && typeof rawOptions === 'object' ? rawOptions : {}) as ScenarioStepOptions;
    const attempts = Math.max(1, Number(options?.retries ?? retries) + 1);
    let result: ScenarioRunStepResult = { status: 'FAIL' };
    let attemptsUsed = 0;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      attemptsUsed = attempt;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        result = { status: 'TIMEOUT', timed_out: true };
        break;
      }
      const timeoutMs = Math.min(Number(options?.timeoutMs ?? defaultStepTimeoutMs), remaining);
      const stepTimeout = createTimeoutContext(timeoutMs, globalContext.signal);
      try {
        result = await runStep(kind, options, {
          scenario,
          evidence,
          bridgePath,
          godotPath,
          launch,
          bridge,
          timeoutMs,
          timeout: stepTimeout,
        });
      } finally {
        stepTimeout.dispose();
      }
      if (kind === 'launch' && result.status === 'PASS' && result.launch) launch = result.launch;
      if (kind === 'launch' && result.status === 'PASS' && result.bridge) bridge = result.bridge;
      if (result.status === 'PASS') break;
    }
    if (result.launch) delete result.launch;
    results.push({
      ...result,
      index,
      kind,
      attempts: attemptsUsed,
      status: result.status as ScenarioStepResult['status'],
    });
    if (result.status !== 'PASS') {
      failed = true;
      if (onFailure === 'stop') break;
    }
  }
  let cleanup = { attempted: false, stopped: true };
  if (bridge) {
    cleanup = {
      attempted: true,
      stopped: await bridge
        .stop(globalContext)
        .then(() => true)
        .catch(() => false),
    };
  } else if (launch && !launch.child.killed && launch.child.pid) {
    const stopped = await stopProcess(
      launch.child.pid,
      Math.min(DEFAULT_STOP_TIMEOUT_MS, Math.max(0, deadline - Date.now())),
    )
      .then((result) => ({ stopped: result.stopped === true }))
      .catch(() => ({ stopped: false }));
    cleanup = { attempted: true, stopped: stopped.stopped === true };
  }
  const cancelled = globalContext.cancelled || signal?.aborted === true;
  const timedOut = globalContext.timedOut || Date.now() >= deadline;
  const summary = {
    schema_version: '0.1',
    source: 'REAL',
    status: failed || cancelled || timedOut ? 'FAIL' : 'PASS',
    code: cancelled ? 'CANCELLED' : timedOut ? 'TIMEOUT' : failed ? 'FAILED' : null,
    scenario: scenario.name || null,
    scenarioPath: scenarioPath ? path.resolve(scenarioPath) : null,
    evidenceDir: evidence,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    steps: results,
    timed_out: timedOut,
    cancelled,
    cleanup,
  };
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
  globalContext.dispose();
  return summary;
}

async function runStep(
  kind: string,
  options: ScenarioStepOptions,
  context: ScenarioExecutionContext,
): Promise<ScenarioRunStepResult> {
  try {
    const projectPath = () => requiredScenarioValue(options.project || context.scenario.project, 'project');
    if (kind === 'launch' && context.bridgePath) {
      const bridge = await PersistentRuntimeBridge.start({
        godotPath: context.godotPath || process.env.GODOT_PATH,
        projectPath: projectPath(),
        evidenceDir: context.evidence,
        bridgePath: context.bridgePath,
        headless: options.mode === 'headless',
        timeout: context.timeout,
      });
      await bridge.request('subscribe_events', {}, context.timeout);
      return { status: 'PASS', bridge };
    }
    if (kind === 'launch')
      return {
        status: 'PASS',
        launch: await launchProject({
          godotPath: context.godotPath || process.env.GODOT_PATH,
          projectPath: projectPath(),
          evidenceDir: context.evidence,
          headless: options.mode !== 'windowed',
          timeout: context.timeout,
        }),
      };
    if (kind === 'input' && context.bridge) {
      const response = await context.bridge.request(
        'inject_input',
        {
          keycode: requiredScenarioNumber(options.keycode, 'keycode'),
          pressed: options.pressed !== false,
        },
        context.timeout,
      );
      return isAcceptedInputResponse(response) ? { status: 'PASS' } : { status: 'FAIL' };
    }
    if (kind === 'input')
      return (
        await injectRuntimeInput({
          godotPath: context.godotPath || process.env.GODOT_PATH,
          projectPath: projectPath(),
          evidenceDir: context.evidence,
          bridgePath: requiredScenarioValue(context.bridgePath, 'bridgePath'),
          keycode: requiredScenarioNumber(options.keycode, 'keycode'),
          pressed: options.pressed !== false,
          timeout: context.timeout,
        })
      ).response?.accepted
        ? { status: 'PASS' }
        : { status: 'FAIL' };
    if (kind === 'screenshot' && context.bridge) {
      const screenshotDir = path.join(context.evidence, `step-${options.name || 'screenshot'}`);
      await mkdir(screenshotDir, { recursive: true });
      const screenshotPath = path.join(screenshotDir, 'screenshot.png');
      const response = await context.bridge.request('capture_screenshot', { path: screenshotPath }, context.timeout);
      return (await isValidScreenshotResponse(response, screenshotPath)) ? { status: 'PASS' } : { status: 'FAIL' };
    }
    if (kind === 'screenshot')
      return (
        await captureRuntimeScreenshot({
          godotPath: context.godotPath || process.env.GODOT_PATH,
          projectPath: projectPath(),
          evidenceDir: path.join(context.evidence, `step-${options.name || 'screenshot'}`),
          bridgePath: requiredScenarioValue(context.bridgePath, 'bridgePath'),
          timeout: context.timeout,
        })
      ).response?.capability === 'RUNTIME_SCREENSHOT'
        ? { status: 'PASS' }
        : { status: 'FAIL' };
    if ((kind === 'wait' || kind === 'assert') && context.bridge)
      return await waitForBridgeEvent(context.bridge, requiredScenarioValue(options.event, 'event'), context.timeout);
    if (kind === 'wait' || kind === 'assert')
      return await waitForEvent(
        context.evidence,
        requiredScenarioValue(options.event, 'event'),
        context.timeoutMs,
        context.timeout.signal,
      );
    if (kind === 'stop' && context.bridge) {
      await context.bridge.stop(context.timeout);
      return { status: 'PASS' };
    }
    if (kind === 'stop')
      return context.launch
        ? {
            status: (await stopProcess(context.launch.child.pid!, context.timeoutMs, context.timeout), 'PASS' as const),
          }
        : { status: 'PASS' };
    return { status: 'FAIL', error: `unknown scenario step: ${kind}` };
  } catch (error: unknown) {
    const envelope = classifyError(error);
    return {
      status: 'FAIL',
      code: envelope.code,
      error: envelope.message,
      timed_out: envelope.timed_out,
      cancelled: envelope.cancelled,
    };
  }
}

function isAcceptedInputResponse(value: unknown): boolean {
  return isRecord(value) && value.accepted === true && value.capability === 'RUNTIME_INPUT_INJECTION';
}

async function isValidScreenshotResponse(value: unknown, screenshotPath: string): Promise<boolean> {
  if (
    !isRecord(value) ||
    value.capability !== 'RUNTIME_SCREENSHOT' ||
    value.path !== screenshotPath ||
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    Number(value.width) < 16 ||
    Number(value.height) < 16
  )
    return false;
  const png = await readFile(screenshotPath).catch(() => null);
  return Boolean(
    png &&
      png.length >= 100 &&
      png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      png.readUInt32BE(16) === value.width &&
      png.readUInt32BE(20) === value.height,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requiredScenarioValue(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredScenarioNumber(value: number | undefined, name: string): number {
  if (value === undefined || !Number.isFinite(value)) throw new Error(`${name} is required`);
  return value;
}

async function waitForEvent(evidence: string, expected: string, timeoutMs: number, signal?: AbortSignal) {
  const file = path.join(evidence, 'events.jsonl');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !signal?.aborted) {
    const events = await readFile(file, 'utf8').catch(() => '');
    if (
      events.split(/\r?\n/).some((line) => {
        try {
          return JSON.parse(line).event === expected;
        } catch {
          return false;
        }
      })
    )
      return { status: 'PASS', event: expected };
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 100);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
  if (signal?.aborted) {
    const reason = signal.reason as { code?: unknown } | undefined;
    if (reason?.code === 'TIMEOUT')
      return { status: 'FAIL', code: 'TIMEOUT', error: `event not observed: ${expected}`, timed_out: true };
    return { status: 'FAIL', code: 'CANCELLED', error: 'operation cancelled', cancelled: true };
  }
  return { status: 'FAIL', error: `event not observed: ${expected}`, timed_out: true };
}

async function waitForBridgeEvent(
  bridge: PersistentRuntimeBridge,
  expected: string,
  timeout: ScenarioExecutionContext['timeout'],
) {
  const observed = () => bridge.getEvents().some((notification) => notification.params?.event === expected);
  while (!observed()) {
    if (timeout.signal.aborted) {
      return timeout.cancelled
        ? { status: 'FAIL', code: 'CANCELLED', error: 'operation cancelled', cancelled: true }
        : { status: 'FAIL', code: 'TIMEOUT', error: `event not observed: ${expected}`, timed_out: true };
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, Math.min(50, Math.max(1, timeout.remaining())));
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      timeout.signal.addEventListener('abort', onAbort, { once: true });
      setTimeout(() => timeout.signal.removeEventListener('abort', onAbort), Math.max(1, timeout.remaining()));
    });
  }
  return { status: 'PASS', event: expected };
}

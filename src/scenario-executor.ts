import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { captureRuntimeScreenshot, injectRuntimeInput, launchProject, stopProcess } from './godot-runtime.js';
import { parse } from 'yaml';
import { createTimeoutContext } from './timeout.js';
import { DEFAULT_SCENARIO_TIMEOUT_MS, DEFAULT_STEP_TIMEOUT_MS, DEFAULT_STOP_TIMEOUT_MS } from './timeouts.js';
import { classifyError } from './error-schema.js';
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
  let failed = false;
  for (let index = 0; index < scenario.steps.length; index += 1) {
    const step = scenario.steps[index] || {};
    const [kind, rawOptions] = Object.entries(step as Record<string, unknown>)[0] || [];
    const options = (rawOptions && typeof rawOptions === 'object' ? rawOptions : {}) as ScenarioStepOptions;
    const attempts = Math.max(1, Number(options?.retries ?? retries) + 1);
    let result: ScenarioRunStepResult = { status: 'FAIL' };
    let attemptsUsed = 0;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        result = { status: 'TIMEOUT', timed_out: true };
        break;
      }
      const timeoutMs = Math.min(Number(options?.timeoutMs ?? defaultStepTimeoutMs), remaining);
      result = await runStep(kind, options, {
        scenario,
        evidence,
        bridgePath,
        godotPath,
        launch,
        timeoutMs,
        timeout: createTimeoutContext(timeoutMs, globalContext.signal),
      });
      if (kind === 'launch' && result.status === 'PASS' && result.launch) launch = result.launch;
      if (result.status === 'PASS') break;
    }
    if (result.launch) delete result.launch;
    results.push({ ...result, index, kind, attempts: 1, status: result.status as ScenarioStepResult['status'] });
    if (result.status !== 'PASS') {
      failed = true;
      if (onFailure === 'stop') break;
    }
  }
  let cleanup = { attempted: false, stopped: true };
  if (launch && !launch.child.killed && launch.child.pid) {
    const stopped = await stopProcess(
      launch.child.pid,
      Math.min(DEFAULT_STOP_TIMEOUT_MS, Math.max(0, globalContext.remaining())),
      globalContext,
    )
      .then(() => ({ stopped: true }))
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
    if (kind === 'launch')
      return {
        status: 'PASS',
        launch: await launchProject({
          godotPath: context.godotPath || process.env.GODOT_PATH,
          projectPath: requiredScenarioValue(options.project || context.scenario.project, 'project'),
          evidenceDir: context.evidence,
          headless: options.mode !== 'windowed',
          timeout: context.timeout,
        }),
      };
    if (kind === 'input')
      return (
        await injectRuntimeInput({
          godotPath: context.godotPath || process.env.GODOT_PATH,
          projectPath: requiredScenarioValue(context.scenario.project, 'project'),
          evidenceDir: context.evidence,
          bridgePath: requiredScenarioValue(context.bridgePath, 'bridgePath'),
          keycode: requiredScenarioNumber(options.keycode, 'keycode'),
          pressed: options.pressed !== false,
          timeout: context.timeout,
        })
      ).response?.accepted
        ? { status: 'PASS' }
        : { status: 'FAIL' };
    if (kind === 'screenshot')
      return (
        await captureRuntimeScreenshot({
          godotPath: context.godotPath || process.env.GODOT_PATH,
          projectPath: requiredScenarioValue(context.scenario.project, 'project'),
          evidenceDir: path.join(context.evidence, `step-${options.name || 'screenshot'}`),
          bridgePath: requiredScenarioValue(context.bridgePath, 'bridgePath'),
          timeout: context.timeout,
        })
      ).response?.capability === 'RUNTIME_SCREENSHOT'
        ? { status: 'PASS' }
        : { status: 'FAIL' };
    if (kind === 'wait' || kind === 'assert')
      return await waitForEvent(
        context.evidence,
        requiredScenarioValue(options.event, 'event'),
        context.timeoutMs,
        context.timeout.signal,
      );
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

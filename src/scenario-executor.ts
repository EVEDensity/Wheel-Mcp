import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { captureRuntimeScreenshot, injectRuntimeInput, launchProject } from './godot-runtime.js';
import { runRegistry } from './run-registry.js';
import { parse } from 'yaml';
import { createTimeoutContext } from './timeout.js';
import { DEFAULT_SCENARIO_TIMEOUT_MS, DEFAULT_STEP_TIMEOUT_MS, DEFAULT_STOP_TIMEOUT_MS } from './timeouts.js';
import { classifyError, WheelError } from './error-schema.js';
import { PersistentRuntimeBridge } from './persistent-runtime-bridge.js';
import { parseScenario } from './scenario-schema.js';
import { compareScreenshots, readGodotDiagnostics } from './godot-development.js';
import { evaluateCheck } from './development-loop.js';
import { snapshotProject } from './project-snapshot.js';
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
  scenario = structuredClone(parseScenario(scenario));
  if (scenarioPath) {
    const base = path.dirname(path.resolve(scenarioPath));
    const resolve = (value: string) => (path.isAbsolute(value) ? value : path.resolve(base, value));
    scenario = {
      ...scenario,
      ...(scenario.project ? { project: resolve(scenario.project) } : {}),
      steps: scenario.steps.map((step) => {
        const [kind, raw] = Object.entries(step as Record<string, unknown>)[0];
        const options = raw as ScenarioStepOptions;
        return { [kind]: { ...options, ...(options.project ? { project: resolve(options.project) } : {}) } };
      }),
    };
  }
  if (!Number.isInteger(retries) || retries < 0 || retries > 3) throw new Error('scenario retries must be 0..3');
  for (const value of [defaultStepTimeoutMs, globalTimeoutMs])
    if (!Number.isFinite(value) || value < 1 || value > 600000)
      throw new Error('scenario timeouts must be 1..600000ms');
  if (!['stop', 'continue'].includes(onFailure)) throw new WheelError('INVALID_ARGUMENT', 'Invalid onFailure policy');
  const plan = { scenario, defaultStepTimeoutMs, globalTimeoutMs, retries, onFailure };
  const planJson = JSON.stringify(plan);
  if (Buffer.byteLength(planJson) > 256 * 1024)
    throw new WheelError('INVALID_ARGUMENT', 'Scenario plan exceeds 256KiB');
  const planHash = createHash('sha256').update(planJson).digest('hex');
  const startedAt = new Date().toISOString();
  const evidence = path.resolve(evidenceDir || path.join(process.cwd(), '.harness', 'scenario'));
  await mkdir(evidence, { recursive: true });
  const deadline = Date.now() + globalTimeoutMs;
  const globalContext = createTimeoutContext(globalTimeoutMs, signal);
  const results: ScenarioStepResult[] = [];
  let launch: LaunchHandle | null = null;
  let bridge: PersistentRuntimeBridge | null = null;
  let failed = false;
  // Strictly increasing event cursor: a satisfied wait advances it, so an old
  // event can never satisfy a later step of the submitted sequence.
  let eventCursor = 0;
  const projectRoot = scenario.project ?? firstLaunchProject(scenario);
  let snapshotFailure: ReturnType<typeof classifyError> | undefined;
  const inputBefore = projectRoot
    ? await snapshotProject(path.resolve(projectRoot), globalContext, [evidence], true).catch((error) => {
        snapshotFailure = classifyError(error);
        return undefined;
      })
    : undefined;
  if (snapshotFailure) {
    failed = true;
    results.push({
      index: -1,
      kind: 'input_snapshot',
      attempts: 1,
      status: 'FAIL',
      code: snapshotFailure.code,
      error: snapshotFailure.message,
    });
  }
  for (let index = 0; index < scenario.steps.length; index += 1) {
    if (snapshotFailure) break;
    const step = scenario.steps[index] || {};
    const [kind, rawOptions] = Object.entries(step as Record<string, unknown>)[0] || [];
    const options = (rawOptions && typeof rawOptions === 'object' ? rawOptions : {}) as ScenarioStepOptions;
    if (kind === 'launch' && (launch || bridge)) {
      failed = true;
      results.push({
        index,
        kind,
        attempts: 0,
        status: 'FAIL',
        code: 'INVALID_ARGUMENT',
        error: 'Only one runtime launch is allowed per replay',
      });
      break;
    }
    const attempts = Math.max(1, Number(options?.retries ?? retries) + 1);
    let result: ScenarioRunStepResult = { status: 'FAIL' };
    let attemptsUsed = 0;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      attemptsUsed = attempt;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        result = {
          status: 'TIMEOUT',
          code: 'TIMEOUT',
          error: `scenario deadline expired before ${kind}`,
          timed_out: true,
        };
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
          eventCursor,
        });
      } finally {
        stepTimeout.dispose();
      }
      if (kind === 'launch' && result.status === 'PASS' && result.launch) launch = result.launch;
      // Retain ownership even if post-launch binding fails, so cleanup is audited.
      if (kind === 'launch' && result.bridge) bridge = result.bridge;
      if (result.status !== 'PASS' && result.bridge) break;
      if (result.status === 'PASS') {
        if (typeof result.sequence === 'number' && result.sequence > eventCursor) eventCursor = result.sequence;
        break;
      }
    }
    if (result.launch) delete result.launch;
    if (result.bridge) delete result.bridge;
    results.push({
      ...result,
      index,
      kind,
      attempts: attemptsUsed,
      status: result.status as ScenarioStepResult['status'],
    });
    try {
      await writeFile(
        path.join(evidence, 'progress.json'),
        JSON.stringify({ planHash, index, kind, status: result.status, eventCursor }),
      );
    } catch (error) {
      const envelope = classifyError(error);
      results[results.length - 1] = {
        ...results[results.length - 1],
        status: 'FAIL',
        code: envelope.code,
        error: envelope.message,
      };
      failed = true;
      break;
    }
    if (result.status !== 'PASS') {
      failed = true;
      if (onFailure === 'stop' || kind === 'launch') break;
    }
  }
  let cleanup: { attempted: boolean; stopped: boolean; error?: ReturnType<typeof classifyError> } = {
    attempted: false,
    stopped: true,
  };
  if (bridge) {
    cleanup = {
      attempted: true,
      stopped: await bridge
        .stop()
        .then(() => true)
        .catch((error) => {
          cleanup.error = classifyError(error);
          return false;
        }),
      ...(cleanup.error ? { error: cleanup.error } : {}),
    };
  } else if (launch && !launch.child.killed && launch.child.pid) {
    const stopped = await runRegistry
      .stop(launch.metadata.run_id!, DEFAULT_STOP_TIMEOUT_MS)
      .then((result) => ({ stopped: result.state === 'STOPPED' || result.state === 'EXITED' }))
      .catch(() => ({ stopped: false }));
    cleanup = { attempted: true, stopped: stopped.stopped === true };
  }
  const cancelled = globalContext.cancelled || signal?.aborted === true;
  const timedOut = globalContext.timedOut || Date.now() >= deadline;
  // Bind the submitted sequence to the exact project inputs it replayed
  // against: any change outside the evidence directory is a conflict, not a pass.
  const inputAfter = projectRoot
    ? await snapshotProject(path.resolve(projectRoot), globalContext, [evidence], true).catch(() => undefined)
    : undefined;
  const inputUnchanged = Boolean(inputBefore && inputAfter && inputBefore.sha256 === inputAfter.sha256);
  const inputConflict = Boolean(projectRoot && (!inputBefore || !inputAfter || !inputUnchanged));
  const summary = {
    schema_version: '0.1',
    source: 'REAL',
    status: failed || cancelled || timedOut || inputConflict || !cleanup.stopped ? 'FAIL' : 'PASS',
    code: cancelled
      ? 'CANCELLED'
      : timedOut
        ? 'TIMEOUT'
        : snapshotFailure
          ? snapshotFailure.code
          : inputConflict
            ? 'CONFLICT'
            : !cleanup.stopped
              ? 'FAILED'
              : failed
                ? (results.find((step) => step.status !== 'PASS')?.code ?? 'FAILED')
                : null,
    plan: { sha256: planHash, definition: plan },
    runtimeObservations: results
      .filter((step) => step.kind === 'launch')
      .map((step) => step.actual ?? { status: 'NOT_VERIFIED' }),
    scenario: scenario.name || null,
    scenarioPath: scenarioPath ? path.resolve(scenarioPath) : null,
    evidenceDir: evidence,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    steps: results,
    eventCursor,
    inputSnapshot: projectRoot
      ? {
          project: path.resolve(projectRoot),
          before: inputBefore?.sha256 ?? null,
          after: inputAfter?.sha256 ?? null,
          unchanged: inputUnchanged,
        }
      : null,
    timed_out: timedOut,
    cancelled,
    cleanup,
  };
  try {
    await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
    return summary;
  } finally {
    globalContext.dispose();
  }
}

function firstLaunchProject(scenario: ScenarioDefinition): string | undefined {
  for (const step of scenario.steps) {
    const entry = step as Record<string, unknown>;
    const options = entry?.launch;
    if (options && typeof options === 'object' && (options as ScenarioStepOptions).project)
      return (options as ScenarioStepOptions).project;
  }
  return undefined;
}

/** Frozen assertion evaluation over a bridge RPC result; "within" adds the submitted tolerance. */
function evaluateScenarioAssertion(value: unknown, options: ScenarioStepOptions): boolean {
  if (options.op === undefined) return true;
  if (options.op !== 'within')
    return evaluateCheck(value, { path: options.path ?? '', op: options.op, expected: options.expected });
  let actual: unknown = value;
  for (const key of options.path ? options.path.split('.') : []) {
    if (
      ['__proto__', 'prototype', 'constructor'].includes(key) ||
      !actual ||
      typeof actual !== 'object' ||
      !Object.hasOwn(actual, key)
    )
      return false;
    actual = (actual as Record<string, unknown>)[key];
  }
  return (
    typeof actual === 'number' &&
    typeof options.expected === 'number' &&
    typeof options.tolerance === 'number' &&
    options.tolerance >= 0 &&
    Math.abs(actual - options.expected) <= options.tolerance
  );
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
        replaySeed: context.scenario.replay?.seed,
      });
      try {
        await bridge.request('subscribe_events', {}, context.timeout);
        const handshake = bridge.handshake;
        const observed = handshake?.runtimeConditions;
        const expected = context.scenario.replay?.expected;
        if (context.scenario.replay && !observed)
          throw new WheelError('UNSUPPORTED', 'Bridge did not report runtime conditions');
        if (context.scenario.replay?.seed !== undefined && observed?.replaySeed !== context.scenario.replay.seed)
          throw new WheelError('CONFLICT', 'Runtime replay seed differs from submitted seed');
        if (expected)
          for (const [key, value] of Object.entries(expected)) {
            const actual =
              key === 'godotVersion' ? handshake?.godotVersion : observed?.[key as keyof NonNullable<typeof observed>];
            if (!isDeepStrictEqual(actual, value))
              throw new WheelError('CONFLICT', `Runtime condition differs: ${key}`, { expected: value, actual });
          }
      } catch (error) {
        const envelope = classifyError(error);
        return {
          status: 'FAIL',
          bridge,
          code: envelope.code,
          error: envelope.message,
          actual: envelope.details ?? {
            godotVersion: bridge.handshake?.godotVersion,
            runtimeConditions: bridge.handshake?.runtimeConditions ?? null,
          },
        };
      }
      return {
        status: 'PASS',
        bridge,
        actual: {
          sessionId: bridge.sessionId,
          godotVersion: bridge.handshake?.godotVersion,
          runtimeConditions: bridge.handshake?.runtimeConditions ?? null,
          conditionsStatus: bridge.handshake?.runtimeConditions ? 'OBSERVED' : 'NOT_VERIFIED',
        },
      };
    }
    if (kind === 'launch')
      if (context.scenario.replay)
        throw new WheelError('UNSUPPORTED', 'Replay condition binding requires the persistent bridge');
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
      const keycode = requiredScenarioNumber(options.keycode, 'keycode');
      const press = await context.bridge.request(
        'inject_input',
        { keycode, pressed: options.pressed !== false },
        context.timeout,
      );
      if (!isAcceptedInputResponse(press)) return { status: 'FAIL', error: 'input injection was not accepted' };
      if (options.release) {
        const release = await context.bridge.request('inject_input', { keycode, pressed: false }, context.timeout);
        if (!isAcceptedInputResponse(release)) return { status: 'FAIL', error: 'input release was not accepted' };
      }
      return { status: 'PASS' };
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
    if (kind === 'physics_frames' && context.bridge) {
      // Frame barrier: the engine answers only after the requested physics
      // frames have run; no wall-clock sleeps are involved.
      const actual = await context.bridge.request(
        'wait_physics_frames',
        { frames: requiredScenarioNumber(options.frames, 'frames') },
        context.timeout,
      );
      return { status: 'PASS', actual };
    }
    if ((kind === 'state' || kind === 'collision') && context.bridge) {
      const method = kind === 'collision' ? 'query_collisions' : requiredScenarioValue(options.method, 'method');
      const response = await context.bridge.request(method, options.params ?? {}, context.timeout);
      const passed = evaluateScenarioAssertion(response, options);
      return passed
        ? { status: 'PASS', actual: response }
        : { status: 'FAIL', error: `assertion failed for ${method}`, actual: response };
    }
    if (kind === 'diagnostics' && context.bridge) {
      const report = await readGodotDiagnostics(context.evidence, projectPath());
      const errors = report.diagnostics.filter((item) => item.severity === 'error').length;
      const budget = options.maxErrors ?? 0;
      return errors <= budget
        ? { status: 'PASS', actual: { errors } }
        : { status: 'FAIL', error: `diagnostics errors ${errors} exceed budget ${budget}`, actual: { errors } };
    }
    if (kind === 'switch_scene' && context.bridge) {
      const scene = requiredScenarioValue(options.scenePath, 'scenePath');
      const response = await context.bridge.request('reload_scene', { scenePath: scene }, context.timeout);
      if (!isRecord(response) || response.reloaded !== true)
        return { status: 'FAIL', error: 'scene reload was not confirmed', actual: response };
      return { status: 'PASS', actual: { scene: response.scene } };
    }
    if (kind === 'visual' && context.bridge) {
      if (!options.baselinePath)
        return {
          status: 'FAIL',
          code: 'INVALID_ARGUMENT',
          error: 'visual assertion requires an independent baselinePath',
        };
      const visualDir = path.join(context.evidence, `step-${options.name || 'visual'}`);
      await mkdir(visualDir, { recursive: true });
      const screenshotPath = path.join(visualDir, 'screenshot.png');
      const baselinePath = await realpath(options.baselinePath);
      const baselineStat = await lstat(options.baselinePath);
      if (
        !baselineStat.isFile() ||
        baselineStat.isSymbolicLink() ||
        baselineStat.size > 32 * 1024 * 1024 ||
        path.resolve(baselinePath).toLowerCase() === path.resolve(screenshotPath).toLowerCase()
      )
        return {
          status: 'FAIL',
          code: 'INVALID_ARGUMENT',
          error: 'visual baseline must be an independent bounded ordinary file',
        };
      const baselineHash = createHash('sha256')
        .update(await readFile(baselinePath))
        .digest('hex');
      const response = await context.bridge.request('capture_screenshot', { path: screenshotPath }, context.timeout);
      if (!(await isValidScreenshotResponse(response, screenshotPath)))
        return { status: 'FAIL', error: 'screenshot capture was not confirmed' };
      const diff = await compareScreenshots(screenshotPath, baselinePath, {
        threshold: options.threshold ?? 8,
        writeDiff: true,
        diffPath: path.join(visualDir, 'diff.png'),
      });
      const budget = options.maxDifferenceRatio ?? 0;
      if (
        createHash('sha256')
          .update(await readFile(baselinePath))
          .digest('hex') !== baselineHash
      )
        return { status: 'FAIL', code: 'CONFLICT', error: 'visual baseline changed during comparison' };
      const passed = diff.width > 1 && diff.height > 1 && diff.differenceRatio <= budget;
      return passed
        ? {
            status: 'PASS',
            actual: {
              width: diff.width,
              height: diff.height,
              differenceRatio: diff.differenceRatio,
              budget,
              baselineHash,
            },
          }
        : {
            status: 'FAIL',
            error: `visual difference ratio ${diff.differenceRatio} exceeds budget ${budget}`,
            actual: diff,
          };
    }
    if ((kind === 'wait' || kind === 'assert') && context.bridge) {
      // Cursor-bound event barrier: only an event with a sequence greater
      // than the last satisfied one can satisfy this step, so an old event
      // never satisfies a new step of the submitted sequence.
      const event = requiredScenarioValue(options.event, 'event');
      const found = await context.bridge.waitForEvent(event, context.timeout, { cursor: context.eventCursor });
      const sequence = Number(found.params?.sequence ?? 0);
      return { status: 'PASS', event, sequence };
    }
    if (kind === 'wait' || kind === 'assert')
      return await waitForEvent(
        context.evidence,
        requiredScenarioValue(options.event, 'event'),
        context.timeoutMs,
        context.timeout.signal,
        context.eventCursor,
      );
    if (kind === 'stop' && context.bridge) {
      await context.bridge.stop(context.timeout);
      return { status: 'PASS' };
    }
    if (kind === 'stop')
      return context.launch
        ? {
            status:
              (await runRegistry.stop(context.launch.metadata.run_id!, context.timeout)).state === 'STOPPED'
                ? 'PASS'
                : 'FAIL',
          }
        : { status: 'PASS' };
    return { status: 'FAIL', error: `unknown scenario step: ${kind}` };
  } catch (error: unknown) {
    const envelope = classifyError(error);
    return {
      status: 'FAIL',
      code: envelope.code,
      error: envelope.message,
      ...(envelope.details !== null ? { actual: envelope.details } : {}),
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

async function waitForEvent(evidence: string, expected: string, timeoutMs: number, signal?: AbortSignal, cursor = 0) {
  const file = path.join(evidence, 'events.jsonl');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !signal?.aborted) {
    const events = await readFile(file, 'utf8').catch(() => '');
    const lines = events.split(/\r?\n/);
    lines.pop(); // Only complete appended records can satisfy a barrier.
    if (lines.length < cursor)
      return { status: 'FAIL', code: 'CONFLICT', error: 'Legacy event log was truncated after cursor advancement' };
    const match = lines.findIndex((line, index) => {
      if (index + 1 <= cursor) return false;
      try {
        return JSON.parse(line).event === expected;
      } catch {
        return false;
      }
    });
    if (match >= 0) return { status: 'PASS', event: expected, sequence: match + 1 };
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, 100);
      signal?.addEventListener('abort', finish, { once: true });
    });
  }
  if (signal?.aborted) {
    const reason = signal.reason as { code?: unknown } | undefined;
    if (reason?.code === 'TIMEOUT')
      return { status: 'FAIL', code: 'TIMEOUT', error: `event not observed: ${expected}`, timed_out: true };
    return { status: 'FAIL', code: 'CANCELLED', error: 'operation cancelled', cancelled: true };
  }
  return { status: 'FAIL', code: 'TIMEOUT', error: `event not observed: ${expected}`, timed_out: true };
}

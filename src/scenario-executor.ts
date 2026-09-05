import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { captureRuntimeScreenshot, injectRuntimeInput, launchProject, stopProcess } from './godot-runtime.js';
import { parse } from 'yaml';

export async function loadScenario(filePath: string) {
  const text = await readFile(filePath, 'utf8');
  const value = parse(text);
  if (!value || typeof value !== 'object' || !Array.isArray(value.steps)) throw new Error('scenario must contain steps[]');
  return value;
}

export async function executeScenario({ scenario, scenarioPath, godotPath, bridgePath, evidenceDir, defaultStepTimeoutMs = 10000, globalTimeoutMs = 120000, retries = 0, onFailure = 'stop' }) {
  const startedAt = new Date().toISOString();
  const evidence = path.resolve(evidenceDir || path.join(process.cwd(), '.harness', 'scenario'));
  await mkdir(evidence, { recursive: true });
  const deadline = Date.now() + globalTimeoutMs;
  const results: any[] = [];
  let launch: any = null;
  let failed = false;
  for (let index = 0; index < scenario.steps.length; index += 1) {
    const step = scenario.steps[index] || {};
    const [kind, options] = Object.entries(step)[0] || [];
    const attempts = Math.max(1, Number(options?.retries ?? retries) + 1);
    let result: any = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) { result = { status: 'TIMEOUT', timed_out: true }; break; }
      const timeoutMs = Math.min(Number(options?.timeoutMs ?? defaultStepTimeoutMs), remaining);
      result = await runStep(kind, options || {}, { scenario, evidence, bridgePath, godotPath, launch, timeoutMs });
      if (kind === 'launch' && result.status === 'PASS') launch = result.launch;
      if (result.status === 'PASS') break;
    }
    if (result?.launch) delete result.launch;
    results.push({ index, kind, attempts: result?.attempts || 1, ...result });
    if (result?.status !== 'PASS') {
      failed = true;
      if (onFailure === 'stop') break;
    }
  }
  if (launch && !launch.child.killed) await stopProcess(launch.child.pid, 5000).catch(() => undefined);
  const summary = { schema_version: '0.1', source: 'REAL', status: failed ? 'FAIL' : 'PASS', scenario: scenario.name || null, scenarioPath: scenarioPath ? path.resolve(scenarioPath) : null, evidenceDir: evidence, started_at: startedAt, finished_at: new Date().toISOString(), steps: results, timed_out: Date.now() > deadline };
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
  return summary;
}

async function runStep(kind: string, options: any, context: any) {
  try {
    if (kind === 'launch') return { status: 'PASS', launch: await launchProject({ godotPath: context.godotPath || process.env.GODOT_PATH, projectPath: options.project || context.scenario.project, evidenceDir: context.evidence, headless: options.mode !== 'windowed' }) };
    if (kind === 'input') return (await injectRuntimeInput({ godotPath: context.godotPath || process.env.GODOT_PATH, projectPath: context.scenario.project, evidenceDir: context.evidence, bridgePath: context.bridgePath, keycode: options.keycode, pressed: options.pressed !== false })).response?.accepted ? { status: 'PASS' } : { status: 'FAIL' };
    if (kind === 'screenshot') return (await captureRuntimeScreenshot({ godotPath: context.godotPath || process.env.GODOT_PATH, projectPath: context.scenario.project, evidenceDir: path.join(context.evidence, `step-${options.name || 'screenshot'}`), bridgePath: context.bridgePath })).response?.capability === 'RUNTIME_SCREENSHOT' ? { status: 'PASS' } : { status: 'FAIL' };
    if (kind === 'wait' || kind === 'assert') return await waitForEvent(context.evidence, options.event, context.timeoutMs);
    if (kind === 'stop') return context.launch ? { status: (await stopProcess(context.launch.child.pid, context.timeoutMs)).stopped ? 'PASS' : 'FAIL' } : { status: 'PASS' };
    return { status: 'FAIL', error: `unknown scenario step: ${kind}` };
  } catch (error: any) { return { status: 'FAIL', error: error.message }; }
}

async function waitForEvent(evidence: string, expected: string, timeoutMs: number) {
  const file = path.join(evidence, 'events.jsonl');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await readFile(file, 'utf8').catch(() => '');
    if (events.split(/\r?\n/).some(line => { try { return JSON.parse(line).event === expected; } catch { return false; } })) return { status: 'PASS', event: expected };
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return { status: 'FAIL', error: `event not observed: ${expected}`, timed_out: true };
}

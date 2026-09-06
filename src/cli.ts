#!/usr/bin/env node
import {
  getGodotVersion,
  listProjects,
  getProjectInfo,
  getSceneTree,
  queryRuntimeSceneTree,
  queryRuntimeProperty,
  mutateRuntimeProperty,
  injectRuntimeInput,
  captureRuntimeScreenshot,
  launchProject,
  readEvidence,
  resolveGodotPath,
  stopProcess,
  cancelProcess,
} from './godot-runtime.js';
import { executeScenario, loadScenario } from './scenario-executor.js';
import { buildContextPack } from './context-pack.js';
import { classifyError } from './error-schema.js';
import { createTimeoutContext } from './timeout.js';
import { DEFAULT_COMMAND_TIMEOUT_MS, DEFAULT_SCENARIO_TIMEOUT_MS, DEFAULT_STOP_TIMEOUT_MS } from './timeouts.js';
import type { CliOptions } from './tool-types.js';
import { parseCliBoolean, parseCliJson, parseCliNumber } from './input-schemas.js';

const [command = 'doctor', ...args] = process.argv.slice(2);
const options: CliOptions = parseOptions(args);
const commandTimeoutMs = parseCliNumber(options.timeout, 'timeout', DEFAULT_COMMAND_TIMEOUT_MS);
const commandContext = createTimeoutContext(commandTimeoutMs);
const cancelProcessSignals = () => commandContext.cancel('CLI process interrupted');
process.once('SIGINT', cancelProcessSignals);
process.once('SIGTERM', cancelProcessSignals);

try {
  if (command === 'doctor') {
    const executable = resolveGodotPath(options.godot || process.env.GODOT_PATH);
    console.log(
      JSON.stringify(
        {
          schema_version: '0.1',
          source: 'REAL',
          godot_path: executable,
          version: await getGodotVersion(executable, commandContext),
        },
        null,
        2,
      ),
    );
  } else if (command === 'list-projects') {
    console.log(
      JSON.stringify(
        await listProjects(required(options.directory, '--directory'), parseCliBoolean(options.recursive, false), commandContext),
        null,
        2,
      ),
    );
  } else if (command === 'project-info') {
    console.log(JSON.stringify(await getProjectInfo(required(options.project, '--project'), commandContext), null, 2));
  } else if (command === 'launch') {
    const result = await launchProject({
      godotPath: options.godot || process.env.GODOT_PATH,
      projectPath: required(options.project, '--project'),
      evidenceDir: options.evidence,
      headless: parseCliBoolean(options.headless),
      timeout: commandContext,
    });
    process.stdout.write(JSON.stringify(result.metadata, null, 2) + '\n', () => process.exit(0));
  } else if (command === 'logs') {
    console.log(JSON.stringify(await readEvidence(required(options.evidence, '--evidence')), null, 2));
  } else if (command === 'scene-tree') {
    console.log(
      JSON.stringify(
        await getSceneTree(required(options.project, '--project'), options.scene, commandContext),
        null,
        2,
      ),
    );
  } else if (command === 'runtime-scene-tree') {
    console.log(
      JSON.stringify(
        await queryRuntimeSceneTree({
          godotPath: options.godot || process.env.GODOT_PATH,
          projectPath: required(options.project, '--project'),
          evidenceDir: options.evidence,
          bridgePath: required(options.bridge, '--bridge'),
          timeout: commandContext,
        }),
        null,
        2,
      ),
    );
  } else if (command === 'runtime-property') {
    console.log(
      JSON.stringify(
        await queryRuntimeProperty({
          godotPath: options.godot || process.env.GODOT_PATH,
          projectPath: required(options.project, '--project'),
          evidenceDir: options.evidence,
          bridgePath: required(options.bridge, '--bridge'),
          nodePath: options.node,
          property: required(options.property, '--property'),
          timeout: commandContext,
        }),
        null,
        2,
      ),
    );
  } else if (command === 'set-runtime-property') {
    const rawValue = required(options.value, '--value');
    const value: unknown = parseCliJson(rawValue, '--value');
    console.log(
      JSON.stringify(
        await mutateRuntimeProperty({
          godotPath: options.godot || process.env.GODOT_PATH,
          projectPath: required(options.project, '--project'),
          evidenceDir: options.evidence,
          bridgePath: required(options.bridge, '--bridge'),
          nodePath: options.node,
          property: required(options.property, '--property'),
          value,
          timeout: commandContext,
        }),
        null,
        2,
      ),
    );
  } else if (command === 'inject-input') {
    console.log(
      JSON.stringify(
        await injectRuntimeInput({
          godotPath: options.godot || process.env.GODOT_PATH,
          projectPath: required(options.project, '--project'),
          evidenceDir: options.evidence,
          bridgePath: required(options.bridge, '--bridge'),
          keycode: parseCliNumber(options.keycode, '--keycode'),
          pressed: parseCliBoolean(options.pressed),
          timeout: commandContext,
        }),
        null,
        2,
      ),
    );
  } else if (command === 'screenshot') {
    console.log(
      JSON.stringify(
        await captureRuntimeScreenshot({
          godotPath: options.godot || process.env.GODOT_PATH,
          projectPath: required(options.project, '--project'),
          evidenceDir: options.evidence,
          bridgePath: required(options.bridge, '--bridge'),
          screenshotPath: options.output,
          timeout: commandContext,
        }),
        null,
        2,
      ),
    );
  } else if (command === 'scenario') {
    const scenarioPath = required(options.file, '--file');
    const scenario = await loadScenario(scenarioPath);
    console.log(
      JSON.stringify(
        await executeScenario({
          scenario,
          scenarioPath,
          godotPath: options.godot || process.env.GODOT_PATH,
          bridgePath: required(options.bridge, '--bridge'),
          evidenceDir: options.evidence,
          globalTimeoutMs: parseCliNumber(options.timeout, '--timeout', DEFAULT_SCENARIO_TIMEOUT_MS),
          signal: commandContext.signal,
        }),
        null,
        2,
      ),
    );
  } else if (command === 'context-pack') {
    console.log(
      JSON.stringify(
        await buildContextPack({
          projectPath: required(options.project, '--project'),
          godotPath: options.godot || process.env.GODOT_PATH,
          evidenceDir: options.evidence,
          scenePath: options.scene,
          timeout: commandContext,
        }),
        null,
        2,
      ),
    );
  } else if (command === 'stop') {
    console.log(
      JSON.stringify(
        await stopProcess(
          Number(required(options.pid, '--pid')),
          Math.min(DEFAULT_STOP_TIMEOUT_MS, commandContext.remaining()),
          commandContext,
        ),
        null,
        2,
      ),
    );
  } else if (command === 'cancel') {
    console.log(
      JSON.stringify(
        await cancelProcess(
          Number(required(options.pid, '--pid')),
          Math.min(DEFAULT_STOP_TIMEOUT_MS, commandContext.remaining()),
          commandContext,
        ),
        null,
        2,
      ),
    );
  } else {
    throw new Error(
      `Unknown command: ${command}. Use doctor, list-projects, project-info, launch, logs, scene-tree, runtime-scene-tree, runtime-property, set-runtime-property, inject-input, screenshot, scenario, context-pack, stop, or cancel.`,
    );
  }
} catch (error) {
  console.error(JSON.stringify(classifyError(error), null, 2));
  process.exitCode = 1;
} finally {
  commandContext.dispose();
  process.removeListener('SIGINT', cancelProcessSignals);
  process.removeListener('SIGTERM', cancelProcessSignals);
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function parseOptions(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    result[key] = values[i + 1]?.startsWith('--') ? 'true' : (values[i + 1] ?? 'true');
    if (result[key] !== 'true') i += 1;
  }
  return result;
}

#!/usr/bin/env node
import { getGodotVersion, getSceneTree, launchProject, readEvidence, resolveGodotPath, stopProcess } from './godot-runtime.js';
import { executeScenario, loadScenario } from './scenario-executor.js';
import { buildContextPack } from './context-pack.js';

const [command = 'doctor', ...args] = process.argv.slice(2);
const options = parseOptions(args);

try {
  if (command === 'doctor') {
    const executable = resolveGodotPath(options.godot || process.env.GODOT_PATH);
    console.log(JSON.stringify({ schema_version: '0.1', source: 'REAL', godot_path: executable, version: await getGodotVersion(executable) }, null, 2));
  } else if (command === 'launch') {
    const result = await launchProject({ godotPath: options.godot || process.env.GODOT_PATH, projectPath: required(options.project, '--project'), evidenceDir: options.evidence, headless: options.headless === 'true' });
    console.log(JSON.stringify(result.metadata, null, 2));
  } else if (command === 'logs') {
    console.log(JSON.stringify(await readEvidence(required(options.evidence, '--evidence')), null, 2));
  } else if (command === 'scene-tree') {
    console.log(JSON.stringify(await getSceneTree(required(options.project, '--project'), options.scene), null, 2));
  } else if (command === 'scenario') {
    const scenarioPath = required(options.file, '--file');
    const scenario = await loadScenario(scenarioPath);
    console.log(JSON.stringify(await executeScenario({ scenario, scenarioPath, godotPath: options.godot || process.env.GODOT_PATH, bridgePath: required(options.bridge, '--bridge'), evidenceDir: options.evidence, globalTimeoutMs: Number(options.timeout || 120000) }), null, 2));
  } else if (command === 'context-pack') {
    console.log(JSON.stringify(await buildContextPack({ projectPath: required(options.project, '--project'), godotPath: options.godot || process.env.GODOT_PATH, evidenceDir: options.evidence, scenePath: options.scene }), null, 2));
  } else if (command === 'stop') {
    console.log(JSON.stringify(await stopProcess(required(options.pid, '--pid')), null, 2));
  } else {
    throw new Error(`Unknown command: ${command}. Use doctor, launch, logs, scene-tree, scenario, context-pack, or stop.`);
  }
} catch (error) {
  console.error(JSON.stringify({ schema_version: '0.1', source: 'REAL', status: 'FAIL', error: error.message }, null, 2));
  process.exitCode = 1;
}

function required(value, name) { if (!value) throw new Error(`${name} is required`); return value; }
function parseOptions(values) {
  const result = {};
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    result[key] = values[i + 1]?.startsWith('--') ? 'true' : (values[i + 1] ?? 'true');
    if (result[key] !== 'true') i += 1;
  }
  return result;
}

/** Controlled seeded defects in pinned upstream games, NOT a universal autonomous-repair benchmark. */
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { evaluateCheck } from '../build/src/development-loop.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root = process.cwd();
const source = path.resolve(process.env.GODOT_DEMO_SOURCE || '.harness/benchmark-sources/godot-demo-projects');
const revision = 'a3b5c113112f77291d5f3d1360f33a882fdc52f7';
if (execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== revision)
  throw Error('source revision mismatch');
const godotPath = process.env.GODOT_PATH;
if (!godotPath) throw Error('GODOT_PATH required');
const godotVersion = execFileSync(godotPath, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
const output = path.resolve(
  process.env.REPAIR_BENCHMARK_OUTPUT ||
    path.join('runs', 'repair-benchmark', new Date().toISOString().replaceAll(':', '-')),
);
const bridgePath = path.resolve('godot-plugin/runtime_bridge.gd');
const key = { method: 'inject_input', params: { keycode: 4194321, pressed: true } };
const frames = { method: 'wait_physics_frames', params: { frames: 24 } };
const property = (id, nodePath, property, expected, op = 'equals', valuePath = 'value') => ({
  id,
  method: 'get_property',
  params: { nodePath, property },
  path: valuePath,
  op,
  expected,
});
const specs = [
  {
    name: 'platformer',
    category: 'Platformer',
    source: '2d/platformer',
    scene: 'res://game_singleplayer.tscn',
    file: 'player/player.gd',
    good: 'const WALK_SPEED = 300.0',
    bad: 'const WALK_SPEED = 0.0',
    actions: [key, frames],
    checks: [property('move-right', 'Level/Player', 'velocity', 50, 'greater', 'value.x')],
  },
  {
    name: 'rpg',
    category: 'Top-down RPG',
    source: '2d/role_playing_game',
    scene: 'res://game.tscn',
    file: 'grid_movement/pawns/player.gd',
    good: 'return Input.get_vector(&"move_left", &"move_right", &"move_up", &"move_down")',
    bad: 'return Vector2.ZERO',
    actions: [key, frames],
    checks: [property('move-right', 'Exploration/Grid/Player', 'position', 224, 'greater', 'value.x')],
  },
  {
    name: 'action',
    category: '2D action',
    source: '2d/dodge_the_creeps',
    scene: 'res://main.tscn',
    file: 'player.gd',
    good: '@export var speed = 400',
    bad: '@export var speed = 0',
    actions: [{ method: 'call_method', params: { nodePath: '.', method: 'new_game' } }, key, frames],
    checks: [property('move-right', 'Player', 'position', 270, 'greater', 'value.x')],
  },
  {
    name: 'ui',
    category: 'UI intensive',
    source: 'gui/control_gallery',
    scene: 'res://control_gallery.tscn',
    file: 'control_gallery.tscn',
    good: 'text = "Button"',
    bad: 'disabled = true\ntext = "Button"',
    actions: [],
    checks: [
      property('button-enabled', 'MainPanel/HSplitContainer/BasicControls/VBoxContainer/Button', 'disabled', false),
    ],
  },
  {
    name: 'navigation',
    category: 'Navigation',
    source: '2d/navigation',
    scene: 'res://navigation.tscn',
    file: 'character.gd',
    good: 'var movement_speed := 200.0',
    bad: 'var movement_speed := 0.0',
    actions: [
      {
        method: 'call_method',
        params: { nodePath: 'Character', method: 'set_movement_target', args: [{ type: 'Vector2', x: 260, y: 126 }] },
      },
      frames,
    ],
    checks: [
      property('move-target', 'Character', 'position', 220, 'greater', 'value.x'),
      {
        id: 'reachable',
        method: 'get_specialized_state',
        params: { nodePath: 'Character/NavigationAgent2D' },
        path: 'state.navigation.target_reachable',
        op: 'equals',
        expected: true,
      },
    ],
  },
  {
    name: 'audio',
    category: 'Audio',
    source: 'audio/generator',
    scene: 'res://generator.tscn',
    file: 'generator.tscn',
    good: 'volume_db = -12.041',
    bad: 'volume_db = -80.0',
    actions: [],
    checks: [
      property('audible-volume', 'Player', 'volume_db', -40, 'greater'),
      {
        id: 'playing',
        method: 'get_specialized_state',
        params: { nodePath: 'Player' },
        path: 'state.audio.playing',
        op: 'equals',
        expected: true,
      },
    ],
  },
  {
    name: 'multi-scene',
    category: 'Multi-scene',
    source: 'loading/scene_changer',
    scene: 'res://scene_a.tscn',
    file: 'scene_a.gd',
    good: 'change_scene_to_file("res://scene_b.tscn")',
    bad: 'change_scene_to_file("res://scene_a.tscn")',
    actions: [{ method: 'call_method', params: { nodePath: '.', method: '_on_goto_scene_pressed' } }, frames],
    checks: [
      {
        id: 'scene-transition',
        method: 'get_scene_tree',
        params: {},
        path: 'scene',
        op: 'equals',
        expected: 'res://scene_b.tscn',
      },
    ],
  },
];
await mkdir(output, { recursive: true });
await cp(path.join(source, 'LICENSE.md'), path.join(output, 'UPSTREAM-LICENSE.md'));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'build/src/mcp-server-sdk.js')],
  stderr: 'pipe',
});
transport.stderr?.on('data', (d) => process.stderr.write(d));
const client = new Client({ name: 'controlled-repair-benchmark', version: '1' });
await client.connect(transport);
const results = [];
const wire = [];
async function call(name, args) {
  const start = Date.now();
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
  wire.push({
    name,
    args,
    response,
    durationMs: Date.now() - start,
    estimatedTokens: Math.ceil(
      (JSON.stringify({ name, arguments: args }).length + JSON.stringify(response).length) / 4,
    ),
  });
  return { response, value: JSON.parse(response.content[0].text) };
}
async function loop(spec, projectPath, phase, extra = {}) {
  const request = {
    projectPath,
    godotPath,
    bridgePath,
    scenePath: spec.scene,
    evidenceDir: path.join(output, spec.name, 'evidence', phase),
    actions: spec.actions,
    checks: spec.checks,
    screenshot: true,
    diagnosticsScope: 'runtime',
    maxRetries: 1,
    timeoutMs: 45000,
    responseMode: 'compact',
    ...extra,
  };
  const start = Date.now();
  const { value } = await call('dev_loop', request);
  const result = value.evidenceDir
    ? JSON.parse(await readFile(path.join(value.evidenceDir, 'result.json'), 'utf8'))
    : value;
  return {
    status: result.status,
    result,
    durationMs: Date.now() - start,
    requests: 1,
    estimatedTokens: wire.at(-1).estimatedTokens,
  };
}
// Scripted fine-grained MCP baseline: the same fixed actions/oracle and the same known patch.
// This is orchestration overhead, NOT human or model debugging time.
async function granular(spec, projectPath) {
  const start = Date.now();
  const first = wire.length;
  const attempts = [];
  for (let index = 0; index < 2; index++) {
    const evidenceDir = path.join(output, spec.name, 'evidence', 'granular-' + index);
    let sessionId;
    const checks = [];
    try {
      const opened = await call('open_runtime_bridge', {
        projectPath,
        godotPath,
        bridgePath,
        scenePath: spec.scene,
        headless: false,
        evidenceDir,
        timeoutMs: 15000,
      });
      sessionId = opened.value.session_id;
      if (!sessionId) throw Error(JSON.stringify(opened.value));
      const rpc = async (method, params = {}) => {
        const r = await call('call_runtime_bridge', { sessionId, method, params, timeoutMs: 10000 });
        if (r.response.isError) throw Error(JSON.stringify(r.value));
        return r.value.response;
      };
      await call('wait_for_event', { sessionId, event: 'level_started', timeoutMs: 10000 });
      await rpc('wait_physics_frames', { frames: 3 });
      for (const action of spec.actions) await rpc(action.method, action.params);
      for (const check of spec.checks) {
        const actual = await rpc(check.method, check.params);
        checks.push({ id: check.id, passed: evaluateCheck(actual, check), actual });
      }
      const screenshot = path.join(evidenceDir, 'screenshot.png');
      await rpc('capture_screenshot', { path: screenshot });
      const diff = await call('compare_screenshots', { firstPath: screenshot, secondPath: screenshot });
      checks.push({
        id: 'screenshot',
        passed: !diff.response.isError && diff.value.width > 1 && diff.value.height > 1,
        actual: diff.value,
      });
      const logs = await call('get_debug_output', { evidenceDir });
      if (logs.response.isError) throw Error(JSON.stringify(logs.value));
      const errors = (logs.value.stdout + '\n' + logs.value.stderr)
        .split(/\r?\n/)
        .filter((l) => /^\s*(?:SCRIPT ERROR:|ERROR:|Parse Error:|Parser Error:)/.test(l));
      checks.push({ id: 'diagnostics', passed: errors.length === 0, actual: errors });
    } catch (e) {
      checks.push({ id: 'execution', passed: false, error: String(e) });
    } finally {
      if (sessionId) {
        const stopped = await call('stop_runtime_bridge', { sessionId, timeoutMs: 10000 });
        checks.push({ id: 'cleanup', passed: !stopped.response.isError && stopped.value.stopped === true });
      }
    }
    const passed = checks.every((c) => c.passed);
    attempts.push({ status: passed ? 'PASS' : 'FAIL', checks });
    if (passed) break;
    if (index === 0 && checks.some((c) => c.id === spec.checks[0].id && !c.passed)) {
      const read = await call('read_project_file', { projectPath, filePath: spec.file });
      const before = read.value.content;
      if (typeof before !== 'string' || before.split(spec.bad).length !== 2) throw Error('baseline patch precondition');
      const written = await call('write_project_file', {
        projectPath,
        filePath: spec.file,
        content: before.replace(spec.bad, spec.good),
      });
      if (written.response.isError) throw Error('baseline patch failed');
    } else break;
  }
  const records = wire.slice(first);
  return {
    status: attempts.at(-1)?.status,
    attempts,
    requests: records.length,
    estimatedTokens: records.reduce((a, r) => a + r.estimatedTokens, 0),
    durationMs: Date.now() - start,
  };
}
try {
  for (const spec of specs) {
    if (process.env.REPAIR_BENCHMARK_FILTER && !process.env.REPAIR_BENCHMARK_FILTER.split(',').includes(spec.name))
      continue;
    console.log('RUN ' + spec.name);
    const row = {
      name: spec.name,
      category: spec.category,
      defect: { file: spec.file, good: spec.good, bad: spec.bad },
      paths: {},
    };
    results.push(row);
    try {
      const healthy = path.join(output, spec.name, 'healthy');
      row.paths.healthy = healthy;
      await cp(path.join(source, spec.source), healthy, {
        recursive: true,
        filter: (p) =>
          !path
            .relative(path.join(source, spec.source), p)
            .split(path.sep)
            .some((v) => ['.godot', '.harness', '.git'].includes(v)),
      });
      const original = await readFile(path.join(healthy, spec.file), 'utf8');
      if (original.split(spec.good).length !== 2) throw Error('mutation precondition');
      row.sourceSha256 = createHash('sha256').update(original).digest('hex');
      try {
        const log = execFileSync(godotPath, ['--headless', '--path', healthy, '--editor', '--import'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 120000,
          maxBuffer: 20 * 1024 * 1024,
        });
        await writeFile(path.join(output, spec.name, 'import.log'), log);
      } catch (e) {
        await writeFile(path.join(output, spec.name, 'import.log'), String(e.stdout || '') + String(e.stderr || ''));
        throw e;
      }
      row.healthy = await loop(spec, healthy, 'healthy');
      const broken = original.replace(spec.good, spec.bad);
      for (const phase of ['broken', 'repaired', 'wrong-repair', 'granular']) {
        const dir = path.join(output, spec.name, phase);
        row.paths[phase] = dir;
        await cp(healthy, dir, { recursive: true });
        await writeFile(path.join(dir, spec.file), broken);
      }
      row.broken = await loop(spec, row.paths.broken, 'broken', { maxRetries: 0 });
      row.repaired = await loop(spec, row.paths.repaired, 'repaired', {
        repairs: [
          {
            id: 'known-fix',
            whenFailedCheckId: spec.checks[0].id,
            edits: [{ path: spec.file, find: spec.bad, replace: spec.good }],
          },
        ],
      });
      row.reverified = await loop(spec, row.paths.repaired, 'independent-rerun', { maxRetries: 0 });
      row.normalResponse = await loop(spec, row.paths.repaired, 'normal-response', {
        maxRetries: 0,
        responseMode: 'normal',
      });
      row.responseTokenEstimateComparison = {
        compactEstimatedTokens: row.reverified.estimatedTokens,
        normalEstimatedTokens: row.normalResponse.estimatedTokens,
        savingsPercent: 100 * (1 - row.reverified.estimatedTokens / row.normalResponse.estimatedTokens),
        method:
          'Paired verified healthy dev_loop calls, JSON character count / 4; response detail only, not total LLM token savings',
      };
      row.wrongRepair = await loop(spec, row.paths['wrong-repair'], 'wrong-repair', {
        repairs: [
          {
            id: 'ineffective-edit',
            whenFailedCheckId: spec.checks[0].id,
            edits: [{ path: spec.file, find: spec.bad, replace: spec.bad + ' ' }],
          },
        ],
      });
      row.granular = await granular(spec, row.paths.granular);
      row.verifiedRepair =
        row.healthy.status === 'PASS' &&
        row.broken.status === 'FAIL' &&
        row.repaired.status === 'PASS' &&
        row.reverified.status === 'PASS' &&
        row.repaired.result.metrics?.retryCount === 1;
      row.falseAlarm = row.healthy.status !== 'PASS';
      row.missedDefect = row.broken.status === 'PASS';
      row.wrongRepairAccepted = row.wrongRepair.status === 'PASS';
      console.log(
        spec.name +
          ' ' +
          JSON.stringify({
            healthy: row.healthy.status,
            broken: row.broken.status,
            repaired: row.repaired.status,
            reverified: row.reverified.status,
            wrongRepair: row.wrongRepair.status,
          }),
      );
    } catch (e) {
      row.error = String(e);
      console.error(spec.name + ': ' + e);
    }
    await save();
  }
} finally {
  await client.close();
  await save();
}
async function save() {
  const complete = results.filter((r) => r.healthy && r.broken && r.repaired && r.reverified && r.wrongRepair);
  const eligible = complete.filter((r) => r.healthy.status === 'PASS' && r.broken.status === 'FAIL');
  const repaired = eligible.filter((r) => r.verifiedRepair);
  const paired = repaired.filter((r) => r.granular?.status === 'PASS' && r.granular.attempts.length === 2);
  const data = {
    generatedAt: new Date().toISOString(),
    godotVersion,
    source: { repository: 'https://github.com/godotengine/godot-demo-projects', revision, license: 'MIT' },
    method:
      'Caller-supplied exact repair candidates; one deliberately seeded defect per category; upstream games, not newly authored games. No claim of arbitrary patch synthesis.',
    output,
    results,
    aggregate: {
      completed: complete.length,
      totalPlanned: specs.length,
      eligible: eligible.length,
      verifiedRepairs: repaired.length,
      repairRate: eligible.length ? repaired.length / eligible.length : null,
      healthyFalseAlarms: complete.filter((r) => r.falseAlarm).length,
      healthySamples: complete.length,
      falsePositiveRate: complete.length ? complete.filter((r) => r.falseAlarm).length / complete.length : null,
      missedDefects: complete.filter((r) => r.missedDefect).length,
      wrongRepairsAccepted: complete.filter((r) => r.wrongRepairAccepted).length,
      averageRepairDurationMs: repaired.length
        ? repaired.reduce((a, r) => a + r.repaired.durationMs, 0) / repaired.length
        : null,
      totalRepairRetries: complete.reduce((a, r) => a + (r.repaired.result.metrics?.retryCount ?? 0), 0),
      responseModeEstimatedSavingsPercent: complete.length
        ? 100 *
          (1 -
            complete.reduce((a, r) => a + r.reverified.estimatedTokens, 0) /
              complete.reduce((a, r) => a + r.normalResponse.estimatedTokens, 0))
        : null,
      pairedGranularSamples: paired.length,
      requestReductionPercent: paired.length
        ? 100 *
          (1 -
            paired.reduce((a, r) => a + r.repaired.requests, 0) / paired.reduce((a, r) => a + r.granular.requests, 0))
        : null,
      pairedEstimatedPayloadReductionPercent: paired.length
        ? 100 *
          (1 -
            paired.reduce((a, r) => a + r.repaired.estimatedTokens, 0) /
              paired.reduce((a, r) => a + r.granular.estimatedTokens, 0))
        : null,
      tokenSavingsPercent: null,
      universalRepairSuccessRate: null,
    },
    metricLimits: [
      'n=1 seeded defect per category; no population inference',
      'False positives are healthy-oracle failures, not precision of a general bug detector',
      'Token estimates are serialized JSON characters / 4, not billable usage',
      'No human/LLM debugging-time baseline; duration is automated wall time',
      'Granular comparison is a scripted equivalent with known fixes, not human/LLM debugging. Counts include requests and response payloads but exclude tool discovery, prompts, reasoning and billing.',
      'Oracle gates runtime diagnostics; exit-phase diagnostics are retained separately and do not determine repair success',
    ],
  };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(data, null, 2));
  await writeFile(path.join(output, 'mcp-transcript.json'), JSON.stringify(wire, null, 2));
  await mkdir(path.resolve('runs/repair-benchmark'), { recursive: true });
  await writeFile(
    path.resolve('runs/repair-benchmark/latest.json'),
    JSON.stringify({ output, report: path.join(output, 'report.json') }, null, 2),
  );
}
console.log('REPORT ' + path.join(output, 'report.json'));
if (results.some((r) => !r.verifiedRepair || r.granular?.status !== 'PASS' || r.wrongRepairAccepted))
  process.exitCode = 1;

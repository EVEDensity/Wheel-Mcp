import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { sourceIdentity, sha256 } from './lib/production-manifest.mjs';
const repo = process.cwd();
const godot = process.env.GODOT_PATH;
if (!godot || !statSync(godot).isFile()) throw new Error('Real GODOT_PATH is required; no skipped comparison');
const source = await sourceIdentity(repo);
const out = path.resolve('runs/efficiency-comparison', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(out, { recursive: true });
const project = await mkdtemp(path.join(os.tmpdir(), 'wheel-efficiency-'));
const files = {
  'project.godot': '[application]\nconfig/name="Isolated efficiency fixture"\nrun/main_scene="res://main.tscn"\n',
  'main.tscn': '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n',
};
for (const [name, text] of Object.entries(files)) await writeFile(path.join(project, name), text);
const bridge = path.resolve('godot-plugin/runtime_bridge.gd');
const query = { nodePath: '.', property: 'visible' };
const rounds = 3,
  queries = 5;
const pairs = [];
function collect(args, env) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, args, { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '';
    const timer = setTimeout(() => {
      c.kill();
      reject(new Error('CLI deadline exceeded'));
    }, 30000);
    c.stdout.on('data', (b) => (stdout += b));
    c.stderr.on('data', (b) => (stderr += b));
    c.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    c.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}
async function oneShot(i) {
  const trace = [];
  const start = performance.now();
  for (let j = 0; j < queries; j++) {
    const evidence = path.join(out, `pair-${i}/one-shot/query-${j}`);
    const args = [
      'build/src/cli.js',
      'runtime-property',
      '--project',
      project,
      '--godot',
      godot,
      '--bridge',
      bridge,
      '--node',
      '.',
      '--property',
      'visible',
      '--evidence',
      evidence,
      '--timeout',
      '10000',
    ];
    const r = await collect(args, {
      ...process.env,
      GODOT_PATH: godot,
      GODOT_HARNESS_RUN_REGISTRY_PATH: path.join(out, `registry-cli-${i}.json`),
    });
    assert.equal(r.code, 0, r.stderr);
    const response = JSON.parse(r.stdout);
    assert.equal(response.response?.value, true);
    trace.push({ request: { command: process.execPath, args }, response: r });
  }
  return {
    mode: 'one-shot-cli',
    durationMs: performance.now() - start,
    verifiedQueries: queries,
    toolCalls: queries,
    processStarts: queries,
    trace,
  };
}
async function persistent(i) {
  const start = performance.now();
  const trace = [];
  const client = new Client({ name: 'efficiency-comparison', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['build/src/mcp-server-sdk.js'],
    stderr: 'pipe',
    env: {
      GODOT_PATH: godot,
      MCP_STDIO_PROJECT_ROOTS: project,
      MCP_STDIO_EVIDENCE_ROOTS: out,
      MCP_STDIO_SCOPES: 'read,run',
      GODOT_HARNESS_RUN_REGISTRY_PATH: path.join(out, `registry-mcp-${i}.json`),
    },
  });
  let stderr = '';
  transport.stderr?.on('data', (b) => (stderr += b));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    trace.push({ request: { name, arguments: args }, response: r });
    assert.notEqual(r.isError, true, JSON.stringify(r));
    return r.structuredContent;
  };
  let session;
  try {
    await client.connect(transport);
    const opened = await call('open_runtime_bridge', {
      projectPath: project,
      godotPath: godot,
      bridgePath: bridge,
      headless: true,
      evidenceDir: path.join(out, `pair-${i}/persistent`),
      timeoutMs: 10000,
    });
    session = opened.session_id;
    for (let j = 0; j < queries; j++) {
      const r = await call('call_runtime_bridge', {
        sessionId: session,
        method: 'get_property',
        params: query,
        timeoutMs: 10000,
      });
      assert.equal(r.response?.value, true);
    }
    await call('stop_runtime_bridge', { sessionId: session, timeoutMs: 5000 });
    session = undefined;
  } finally {
    if (session)
      await client
        .callTool({ name: 'stop_runtime_bridge', arguments: { sessionId: session, timeoutMs: 5000 } })
        .catch(() => undefined);
    await client.close();
  }
  return {
    mode: 'persistent-mcp',
    durationMs: performance.now() - start,
    verifiedQueries: queries,
    toolCalls: trace.length,
    processStarts: 1,
    stderr,
    trace,
  };
}
let failure;
try {
  for (let i = 0; i < rounds; i++) {
    const order = i % 2 ? ['persistent', 'one-shot'] : ['one-shot', 'persistent'];
    const results = {};
    for (const mode of order) results[mode] = await (mode === 'persistent' ? persistent(i) : oneShot(i));
    for (const r of Object.values(results)) {
      r.serializedRequestResponseBytes = Buffer.byteLength(JSON.stringify(r.trace), 'utf8');
      r.tracePath = path.join(out, `pair-${i}-${r.mode}.json`);
      await writeFile(r.tracePath, JSON.stringify(r.trace, null, 2));
      delete r.trace;
    }
    pairs.push({ order, results });
  }
} catch (error) {
  failure = error.message;
}
const unchanged = (await sourceIdentity(repo)).sourceHash === source.sourceHash;
const report = {
  schemaVersion: 1,
  status: !failure && unchanged && pairs.length === rounds ? 'PASS' : 'FAIL',
  source,
  environment: {
    node: process.version,
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    godot: execFileSync(godot, ['--version'], { encoding: 'utf8' }).trim(),
  },
  fixture: { projectPath: project, inputHash: sha256(JSON.stringify(files)), files },
  rounds,
  queriesPerRound: queries,
  pairs,
  ...(failure ? { failure } : {}),
  sourceUnchanged: unchanged,
  scope:
    'Three alternating-order cold-start pairs of five identical static-property reads. Includes client/process startup and shutdown. Not a gameplay, repair, manual-workflow or model-token benchmark.',
  tokenCost: 'NOT_MEASURED',
  manualTimeReduction: 'NOT_MEASURED',
  latencyMetric: 'end-to-end wall-clock milliseconds; retain every pair, no best-run selection',
};
await writeFile(path.join(out, 'comparison.json'), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    { status: report.status, report: path.join(out, 'comparison.json'), pairs: pairs.length, failure },
    null,
    2,
  ),
);
if (report.status !== 'PASS') process.exitCode = 1;

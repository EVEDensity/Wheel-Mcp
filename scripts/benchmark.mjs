import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const godotPath = process.env.GODOT_PATH;
const manifestPath = path.resolve(process.env.GODOT_BENCHMARK_MANIFEST || 'benchmarks/projects.json');
const outputPath = path.resolve(process.env.GODOT_BENCHMARK_OUTPUT || 'runs/benchmark/latest.json');
const bridgePath = path.resolve(process.env.GODOT_BRIDGE_PATH || 'godot-plugin/runtime_bridge.gd');
const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : { projects: [] };
const metrics = [];
const baseline = [];

for (const project of manifest.projects || []) {
  const projectPath = path.resolve(project.path);
  if (!godotPath || !existsSync(projectPath)) { metrics.push({ name: project.name, category: project.category, status: 'SKIP', reason: !godotPath ? 'GODOT_PATH missing' : 'project missing' }); continue; }
  const started = performance.now(); let requests = 0; let bytes = 0; let retries = 0; let status = 'PASS'; let error = undefined;
  const client = new Client({ name: 'godot-benchmark', version: '0.1.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['build/src/mcp-server-sdk.js'], stderr: 'pipe' }));
    const call = async (name, args) => { requests++; const result = await client.callTool({ name, arguments: args }); bytes += JSON.stringify(result).length + JSON.stringify(args).length; return result; };
    const opened = await call('open_runtime_bridge', { godotPath, projectPath, bridgePath, headless: true, evidenceDir: path.resolve('runs/benchmark', project.name), timeoutMs: project.timeoutMs || 20000 });
    const raw = JSON.parse(opened.content[0].text); const sessionId = raw.session_id || raw.sessionId;
    if (!sessionId) throw new Error('bridge did not return session id');
    for (const check of project.checks || [{ tool: 'get_project_info', args: {} }]) {
      let passed = false;
      for (let attempt = 0; attempt <= Number(check.retries || 0); attempt++) { const result = await call(check.tool, { sessionId, ...(check.args || {}) }); if (!result.isError) { passed = true; break; } retries++; }
      if (!passed) throw new Error(`check failed: ${check.tool}`);
    }
    await call('stop_runtime_bridge', { sessionId, timeoutMs: 5000 });
  } catch (cause) { status = 'FAIL'; error = String(cause); } finally { await client.close().catch(() => undefined); }
  metrics.push({ name: project.name, category: project.category, status, error, requests, retries, durationMs: Math.round(performance.now() - started), estimatedTokens: Math.ceil(bytes / 4) });
}
const runnable = metrics.filter((item) => item.status !== 'SKIP');
const passed = runnable.filter((x) => x.status === 'PASS');
const summary = { schemaVersion: '0.2', generatedAt: new Date().toISOString(), godotPath, manifestRevision: manifest.revision || null, projects: metrics, aggregate: { total: runnable.length, passed: passed.length, successRate: runnable.length ? passed.length / runnable.length : null, averageRequests: avg('requests'), averageTokens: avg('estimatedTokens'), averageDurationMs: avg('durationMs'), averageRetries: avg('retries'), requestReductionVsManual: null, tokenReductionVsManual: null, debugTimeReductionVsManual: null, repairSuccessRate: null, falsePositiveRate: null, note: 'Reduction, repair and false-positive metrics require a labelled manual baseline; not estimated.' } };
await mkdir(path.dirname(outputPath), { recursive: true }); await writeFile(outputPath, JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary, null, 2));
function avg(key) { return runnable.length ? Math.round(runnable.reduce((sum, item) => sum + Number(item[key] || 0), 0) / runnable.length) : null; }

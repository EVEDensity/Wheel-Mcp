import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root = process.cwd();
const prior = JSON.parse(await readFile('benchmarks/repair-results-2026-09-13.json', 'utf8'));
const transcript = JSON.parse(await readFile(path.join(prior.output, 'mcp-transcript.json'), 'utf8'));
const output = path.resolve('runs/strict-shutdown', new Date().toISOString().replaceAll(':', '-'));
await mkdir(output, { recursive: true });
const oldBridge = path.join(output, 'before-bridge.gd');
// Frozen pre-cleanup bridge from the baseline commit, never the evolving HEAD.
const beforeRevision = 'abfc3fb';
await writeFile(oldBridge, execFileSync('git', ['show', beforeRevision + ':godot-plugin/runtime_bridge.gd']));
const client = new Client({ name: 'strict-shutdown-paired-evaluation', version: '1' });
const wire = [],
  results = [];
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('build/src/mcp-server-sdk.js')],
      stderr: 'pipe',
    }),
  );
  for (const sample of prior.results) {
    const original = transcript.find(
      (t) => t.name === 'dev_loop' && t.args.projectPath === path.join(prior.output, sample.name, 'healthy'),
    );
    if (!original) throw Error('missing original oracle: ' + sample.name);
    const pair = { name: sample.name, projectPath: sample.projectPath };
    for (const phase of ['before', 'after']) {
      const args = {
        ...original.args,
        projectPath: sample.projectPath,
        godotPath: process.env.GODOT_PATH,
        bridgePath: phase === 'before' ? oldBridge : path.resolve('godot-plugin/runtime_bridge.gd'),
        evidenceDir: path.join(output, sample.name, phase),
        diagnosticsScope: 'including-shutdown',
        maxErrors: 0,
        maxRetries: 0,
        repairs: [],
        edits: [],
        responseMode: 'normal',
        timeoutMs: 25000,
      };
      const response = await client.callTool({ name: 'dev_loop', arguments: args }, undefined, { timeout: 40000 });
      wire.push({ name: 'dev_loop', args, response });
      const result = response.structuredContent || JSON.parse(response.content[0].text);
      pair[phase] = {
        status: result.status,
        errorCount: result.errorCount,
        evidenceDir: result.evidenceDir,
        shutdownDiagnostics: result.attempts?.[0]?.shutdownDiagnostics,
        shutdown: result.attempts?.[0]?.shutdown,
        failedChecks: result.attempts?.[0]?.checks.filter((c) => !c.passed).map((c) => c.id),
        screenshotPath: result.screenshotPath,
      };
      console.log(sample.name, phase, result.status, result.errorCount);
    }
    results.push(pair);
  }
} finally {
  await client.close();
}
const data = {
  generatedAt: new Date().toISOString(),
  godotVersion: execFileSync(process.env.GODOT_PATH, ['--version'], { encoding: 'utf8' }).trim(),
  sourceBenchmark: 'benchmarks/repair-results-2026-09-13.json',
  beforeRevision,
  output,
  methodology:
    'Same seven already-repaired projects and original gameplay assertions, non-headless screenshots, strict diagnostics and zero error budget. Only bridge teardown differs between paired runs. Not independent unseen-defect data.',
  bridgeHashes: {
    before: createHash('sha256')
      .update(await readFile(oldBridge))
      .digest('hex'),
    after: createHash('sha256')
      .update(await readFile('godot-plugin/runtime_bridge.gd'))
      .digest('hex'),
  },
  results,
  aggregate: {
    samples: results.length,
    beforePass: results.filter((r) => r.before.status === 'PASS').length,
    afterPass: results.filter((r) => r.after.status === 'PASS').length,
  },
};
await writeFile(path.join(output, 'report.json'), JSON.stringify(data, null, 2));
await writeFile(path.join(output, 'mcp-transcript.json'), JSON.stringify(wire, null, 2));
await writeFile('benchmarks/strict-shutdown-results-2026-09-13.json', JSON.stringify(data, null, 2) + '\n');
console.log('REPORT', path.join(output, 'report.json'));

/** Pre-registered historical defects; keep the FIRST evaluation, even when reproduction fails. */
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const manifestBytes = await readFile('benchmarks/historical-defects.v1.json');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const manifestHash = sha(manifestBytes);
if (manifestHash !== (await readFile('benchmarks/historical-defects.v1.sha256', 'utf8')).trim())
  throw Error('frozen corpus changed');
const manifest = JSON.parse(manifestBytes);
const source = path.resolve(process.env.GODOT_DEMO_SOURCE || '.harness/benchmark-sources/godot-demo-projects');
const godotPath = process.env.GODOT_PATH;
if (!godotPath) throw Error('GODOT_PATH required');
const output = path.resolve('runs/historical-repair', new Date().toISOString().replaceAll(':', '-'));
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'frozen-manifest.json'), manifestBytes, { flag: 'wx' });
const client = new Client({ name: 'historical-candidate-client', version: '1' });
const wire = [],
  results = [];
const git = (...args) =>
  execFileSync('git', ['-C', source, ...args], { windowsHide: true, timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
const call = async (name, args) => {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 45000 });
  wire.push({ timestamp: new Date().toISOString(), name, args, response });
  await writeFile(path.join(output, 'mcp-transcript.json'), JSON.stringify(wire, null, 2));
  return response.structuredContent || JSON.parse(response.content[0].text);
};
async function copyRevision(spec, revision, destination) {
  // Materialize only project blobs; avoid unrelated promisor attributes.
  await mkdir(destination, { recursive: true });
  const entries = git('ls-tree', '-rz', revision, '--', spec.project)
    .toString('utf8')
    .split(String.fromCharCode(0))
    .filter(Boolean);
  for (const entry of entries) {
    const [header, file] = entry.split('\t');
    const [mode, type, oid] = header.split(' ');
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) throw Error('unsupported source entry');
    const relative = path.posix.relative(spec.project, file);
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) throw Error('unsafe source path');
    const target = path.join(destination, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, git('cat-file', 'blob', oid));
  }
  if (spec.reproduction) {
    const p = path.join(destination, spec.reproduction.file),
      s = await readFile(p, 'utf8');
    if (s.split(spec.reproduction.find).length !== 2) throw Error('frozen reproduction precondition failed');
    await writeFile(p, s.replace(spec.reproduction.find, spec.reproduction.replace));
  }
  const imported = spawnSync(godotPath, ['--headless', '--path', destination, '--editor', '--import'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024,
  });
  // Godot can report parser errors on stderr while the editor import exits zero.
  // Preserve both streams; runtime controls, not import exit code, decide health.
  const log =
    String(imported.stdout || '') +
    '\n--- STDERR ---\n' +
    String(imported.stderr || '') +
    (imported.error ? '\n' + String(imported.error) : '');
  await writeFile(destination + '-import.log', log);
  return {
    importStatus: imported.status === 0 && !imported.error ? 'PASS' : 'FAIL',
    exitCode: imported.status,
    signal: imported.signal,
    logPath: destination + '-import.log',
  };
}
let harnessError;
try {
  await writeFile(path.join(output, 'UPSTREAM-LICENSE.md'), git('show', manifest.cases[0].fixCommit + ':LICENSE.md'));
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('build/src/mcp-server-sdk.js')],
      stderr: 'pipe',
    }),
  );
  for (const spec of manifest.cases) {
    const entry = {
      phase: 'preparation',
      id: spec.id,
      fixCommit: spec.fixCommit,
      buggyCommit: spec.buggyCommit,
      repairFiles: spec.repairFiles,
    };
    results.push(entry);
    try {
      const buggy = path.join(output, spec.id, 'candidate'),
        fixed = path.join(output, spec.id, 'upstream-fixed');
      entry.imports = {
        buggy: await copyRevision(spec, spec.buggyCommit, buggy),
        fixed: await copyRevision(spec, spec.fixCommit, fixed),
      };
      entry.phase = 'runtime';
      entry.projectPath = buggy;
      entry.fixedProjectPath = fixed;
      const base = {
        godotPath,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        ...(spec.scenePath ? { scenePath: spec.scenePath } : {}),
        checks: spec.checks,
        actions: spec.actions,
        screenshot: true,
        timeoutMs: 25000,
      };
      const options = {
        ...base,
        projectPath: buggy,
        evidenceDir: path.join(output, spec.id, 'evidence'),
        allowedRepairFiles: spec.repairFiles,
        maxCandidates: 2,
      };
      entry.begin = await call('begin_client_repair', options);
      entry.fixed = await call('dev_loop', {
        ...base,
        projectPath: fixed,
        evidenceDir: path.join(output, spec.id, 'fixed-evidence'),
        maxRetries: 0,
      });
      if (entry.begin.status === 'NEEDS_REPAIR') {
        const files = entry.begin.files;
        // Negative control: whitespace-only change cannot repair a behavioral/parser defect.
        const first = files[0];
        entry.ineffective = await call('submit_repair_candidate', {
          repairId: entry.begin.repairId,
          approved: true,
          proposal: {
            source: 'negative-control-whitespace',
            rationale: 'Deliberately ineffective patch',
            edits: [
              { path: first.path, find: first.content, replace: first.content + '\n', expectedSha256: first.sha256 },
            ],
          },
        });
        entry.rollbackVerified = (
          await Promise.all(files.map(async (f) => sha(await readFile(path.join(buggy, f.path))) === f.sha256))
        ).every(Boolean);
        const edits = await Promise.all(
          files.map(async (f) => ({
            path: f.path,
            find: f.content,
            replace: await readFile(path.join(fixed, f.path), 'utf8'),
            expectedSha256: f.sha256,
          })),
        );
        entry.candidate = await call('submit_repair_candidate', {
          repairId: entry.begin.repairId,
          approved: true,
          proposal: {
            source: 'upstream-commit:' + spec.fixCommit,
            rationale: 'Recorded historical fix supplied by the client; not a live LLM output',
            edits,
          },
        });
        entry.reverified = await call('dev_loop', {
          ...base,
          projectPath: buggy,
          evidenceDir: path.join(output, spec.id, 'reverify-evidence'),
          maxRetries: 0,
        });
      }
      entry.reproduced = entry.begin.status === 'NEEDS_REPAIR' && entry.fixed.status === 'PASS';
      entry.verifiedRepair =
        entry.reproduced && entry.candidate?.status === 'PASS' && entry.reverified?.status === 'PASS';
      entry.negativeControlRejected = entry.ineffective?.status === 'FAIL' && entry.rollbackVerified === true;
      console.log(
        spec.id,
        JSON.stringify({
          buggy: entry.begin.status,
          fixed: entry.fixed.status,
          candidate: entry.candidate?.status,
          reverified: entry.reverified?.status,
          negative: entry.negativeControlRejected,
        }),
      );
    } catch (e) {
      entry.error = String(e);
      console.log(spec.id, 'ERROR', entry.error);
    }
    await report();
  }
} catch (e) {
  harnessError = String(e);
} finally {
  await client.close();
  await report();
}
async function report() {
  const data = {
    generatedAt: new Date().toISOString(),
    output,
    manifestHash,
    harnessError,
    source: manifest.repository,
    godotVersion: execFileSync(godotPath, ['--version'], { encoding: 'utf8', windowsHide: true }).trim(),
    independence: manifest.independence,
    candidateSource: manifest.candidateSource,
    results,
    aggregate: {
      planned: manifest.cases.length,
      recorded: results.length,
      completed: results.filter((r) => r.begin && r.fixed).length,
      preparationErrors: results.filter((r) => r.error && r.phase === 'preparation').length,
      runtimeErrors: results.filter((r) => r.error && r.phase === 'runtime').length,
      reproduced: results.filter((r) => r.reproduced).length,
      verifiedRepairs: results.filter((r) => r.verifiedRepair).length,
      negativeControlsRejected: results.filter((r) => r.negativeControlRejected).length,
      notReproduced: results.filter((r) => r.begin && r.fixed && !r.reproduced).length,
    },
    limitations: [
      'Small source-reviewed historical set, not a blind model generation benchmark.',
      'A fixed control failing remains a failure; no diagnostic filtering or oracle tuning.',
      'The complete first run remains local evidence even if later regressions are rerun.',
    ],
  };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(data, null, 2));
  await mkdir('runs/historical-repair', { recursive: true });
  await writeFile(
    'runs/historical-repair/latest.json',
    JSON.stringify({ output, report: path.join(output, 'report.json') }, null, 2),
  );
}
console.log('REPORT', path.join(output, 'report.json'));

if (harnessError || results.some((r) => r.error) || results.length !== manifest.cases.length) process.exitCode = 1;

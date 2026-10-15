import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  appendFile,
  realpath,
  lstat,
  rm,
  copyFile,
  rename,
  readdir,
  stat,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sourceIdentity, sha256 } from './lib/production-manifest.mjs';

// --workload runs the bounded 1000-cycle workload, NOT long-session/production qualification.
const modeArg = process.argv[2];
if (
  process.argv.length !== 3 ||
  !['--smoke', '--smoke-paced', '--smoke-stress', '--workload'].includes(modeArg) ||
  process.platform !== 'win32'
) {
  console.error(
    'NOT_RUN: use --smoke, --smoke-paced, --smoke-stress or --workload on Windows. Full chaos/security qualification is separate.',
  );
  process.exit(2);
}
const godot = process.env.GODOT_PATH;
if (!godot) throw new Error('GODOT_PATH is required');
const repo = process.cwd(),
  source = await sourceIdentity(repo);
const { SOAK_LIMITS, BOUNDED_SOAK_LIMITS, SOAK_RESPONSE_CONFIGURATION, assessSoakReport } = await import('../build/src/soak-contract.js');
const { scheduleSoak } = await import('../build/src/soak-scheduler.js');
const longRun = modeArg === '--workload';
const responseConfiguration = SOAK_RESPONSE_CONFIGURATION;
const plan = Object.freeze({
  durationMs: modeArg === '--smoke-paced' ? 90000 : 1,
  cycles: longRun ? SOAK_LIMITS.cycles : modeArg === '--smoke-stress' ? 40 : 4,
  concurrency: 2,
  sampleIntervalMs: 15000,
  maxSampleGapMs: SOAK_LIMITS.maxSampleGapMs,
  maxDurationMs: longRun ? BOUNDED_SOAK_LIMITS.maxDurationMs : 300000,
});
const budgets = Object.freeze({
  traceBytes: 32 * 1024 * 1024,
  reportBytes: 16 * 1024 * 1024,
  fixtureDataBytes: 192 * 1024 * 1024,
  diagnosticFileBytes: 16 * 1024 * 1024,
  maxFiles: 16000,
});
const runDir = path.resolve(
  'runs/production-roadmap/T31',
  (longRun ? 'native-workload-' : 'native-smoke-') + new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid,
);
await mkdir(runDir, { recursive: true });
const tempParent = await realpath(os.tmpdir());
const ownedRoot = await mkdtemp(path.join(tempParent, 'wheel-soak-smoke-'));
process.env.TEMP = ownedRoot;
process.env.TMP = ownedRoot;
process.env.GODOT_HARNESS_RUN_REGISTRY_PATH = path.join(runDir, 'test-run-registry.json');
// Set the owned registry before importing any engine helpers; never touch the user's registry.
const { startEditorFixture } = await import('../build/tests/helpers/editor-fixture.js');
const { wireEditor } = await import('../build/tests/helpers/editor-mcp.js');
const { compareScreenshots } = await import('../build/src/godot-development.js');
const { getProcessStatus } = await import('../build/src/godot-runtime.js');
const { readProcessIdentity, stopIdentifiedProcess } = await import('../build/src/process-identity.js');
const { retainStoppedSoakShadow } = await import('../build/src/soak-retention.js');
const { inspectSoakInventory } = await import('../build/src/soak-inventory.js');
const { completeResponse, responseBody } = await import('../build/tests/helpers/paged-response.js');
const exec = promisify(execFile);
const report = {
  schemaVersion: longRun ? 3 : 2,
  mode: longRun ? 'bounded' : 'smoke',
  longSessionClaims: 'NOT_VERIFIED',
  responseConfiguration,
  command: modeArg,
  measurementSource: 'REAL',
  approval: 'MOCK exact fixture host',
  sourceHash: source.sourceHash,
  status: 'RUNNING',
  qualification: 'NOT_QUALIFIED',
  completedCycles: 0,
  cycles: [],
  persistentActors: [],
  samples: [],
  projectIds: ['A', 'B'],
  frameTiming: 'NOT_MEASURED: this is a control-plane workload, not a game frame-time benchmark',
  failedCycles: 0,
  skippedCycles: 0,
  unknownTransactions: 0,
  leakedOwnedProcesses: 0,
  plan,
  budgets,
  cleanup: false,
  error: null,
};
const projects = [];
let traceBytes = 0;
let traceQueue = Promise.resolve();
let activeSignal;
let workloadStart = 0;
let lastSourceCheck = -60000;
const cancelled = new AbortController();
let diagnosticQueue = Promise.resolve();
const onWarning = (warning) => {
  report.warning = warning.stack ?? String(warning);
  cancelled.abort(new Error(`Worker warning must be investigated: ${warning.name}`));
};
process.on('warning', onWarning);
const workerIdentity = await readProcessIdentity(process.pid);
assert.ok(workerIdentity, 'Worker birth identity required for cooperative stop');
const workerIdentityHash = sha256(JSON.stringify(workerIdentity));
const onInterrupt = () => cancelled.abort(new Error('Native soak interrupted; no partial PASS'));
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onInterrupt);
const traceFile = path.join(runDir, 'calls.jsonl');
async function record(value) {
  const line = JSON.stringify(value) + '\n';
  traceBytes += Buffer.byteLength(line);
  if (traceBytes > budgets.traceBytes) throw new Error('Native trace exceeded frozen 32MiB budget');
  traceQueue = traceQueue.then(() => appendFile(traceFile, line));
  await traceQueue;
}
async function call(p, tool, args = {}, expectedCode) {
  const started = performance.now();
  activeSignal?.throwIfAborted();
  let response;
  try {
    response = await p.client.call(tool, args, { signal: activeSignal });
  } catch (error) {
    // A transport exception on a dispatched writer has no trustworthy commit verdict. Never silently retry.
    if (
      [
        'apply_editor_scene',
        'save_editor_scene',
        'reload_scene',
        'open_runtime_bridge',
        'stop_runtime_bridge',
        'call_runtime_bridge',
      ].includes(tool)
    )
      report.unknownTransactions++;
    await record({
      project: p.id,
      tool,
      kind: 'TRANSPORT_FAILURE',
      argumentsSha256: sha256(JSON.stringify(args)),
      error: String(error).slice(0, 2048),
    });
    throw error;
  }
  let data = responseBody(response);
  if (data.code === 'UNKNOWN' && ['apply_editor_scene', 'save_editor_scene', 'reload_scene',
    'open_runtime_bridge', 'stop_runtime_bridge', 'call_runtime_bridge'].includes(tool))
    report.unknownTransactions++;
  await record({
    project: p.id,
    tool,
    durationMs: performance.now() - started,
    argumentsSha256: sha256(JSON.stringify(args)),
    responseSha256: sha256(JSON.stringify(response)),
    code: data.code,
    status: data.status,
    isError: response.isError === true,
  });
  if (expectedCode) {
    assert.equal(response.isError, true);
    assert.equal(data.code, expectedCode);
  } else {
    assert.notEqual(response.isError, true, JSON.stringify(data).slice(0, 2048));
    assert.notEqual(data.status, 'FAIL');
    data = await completeResponse(data, async (ref, cursor) => {
      const page = await p.client.call('get_response_page', { ref, cursor }, { signal: activeSignal });
      const body = responseBody(page);
      await record({ project: p.id, tool: 'get_response_page', kind: 'SNAPSHOT_READ', ref, cursor,
        responseSha256: sha256(JSON.stringify(page)), isError: page.isError === true });
      assert.notEqual(page.isError, true, JSON.stringify(body).slice(0, 2048));
      return body;
    });
  }
  return data;
}
async function rpc(p, method, params) {
  const data = await call(p, 'call_runtime_bridge', { sessionId: p.sessionId, method, params, responseMode: responseConfiguration.runtimeRpc });
  assert.ok(data.response && typeof data.response === 'object', `Missing complete runtime response for ${method}`);
  return data.response;
}
const rssScript = `
$ErrorActionPreference='Stop'
$taskPids=($env:WHEEL_SOAK_PIDS -split ',') | ForEach-Object { [int]$_ }
$rows=@(foreach($taskPid in $taskPids) {
 $p=Get-Process -Id $taskPid -ErrorAction Stop
 $p.Refresh()
 [pscustomobject]@{ pid=$p.Id; startToken=$p.StartTime.ToUniversalTime().ToString('o'); executablePath=$p.Path; bytes=[long]$p.WorkingSet64 }
})
ConvertTo-Json -InputObject $rows -Compress
`;
async function sample(elapsed, signal) {
  const stopFile = path.join(runDir, 'stop-request.json');
  const stopInfo = await lstat(stopFile).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (stopInfo) {
    assert.ok(stopInfo.isFile() && !stopInfo.isSymbolicLink() && stopInfo.nlink === 1 && stopInfo.size <= 2048);
    const request = JSON.parse(await readFile(stopFile, 'utf8'));
    assert.equal(request.schemaVersion, 1);
    assert.equal(request.workerPid, process.pid);
    assert.equal(request.workerIdentityHash, workerIdentityHash);
    assert.equal(request.sourceHash, source.sourceHash);
    cancelled.abort(new Error('Operator requested cooperative stop; partial workload cannot pass'));
    signal.throwIfAborted();
  }
  const declared = projects.flatMap((p) => [
    { projectId: p.id, role: 'server', pid: p.client.client.transport.pid },
    { projectId: p.id, role: 'editor', pid: p.fixture.endpoint.editorPid },
    { projectId: p.id, role: 'runtime', pid: p.runtimePid },
  ]);
  assert.equal(new Set(declared.map((a) => a.pid)).size, 6);
  assert.ok(declared.every((a) => Number.isSafeInteger(a.pid) && a.pid > 0));
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', rssScript], {
    windowsHide: true,
    timeout: 10000,
    signal,
    maxBuffer: 16384,
    env: {
      SystemRoot: process.env.SystemRoot,
      PATH: process.env.PATH,
      WHEEL_SOAK_PIDS: declared.map((a) => a.pid).join(','),
    },
  });
  const rows = JSON.parse(stdout);
  const rss = declared.map((a) => {
    const native = rows.find((r) => r.pid === a.pid);
    assert.ok(native?.startToken && native?.executablePath && Number.isSafeInteger(native.bytes) && native.bytes > 0);
    const identity = sha256(
      JSON.stringify({ startToken: native.startToken, executablePath: path.resolve(native.executablePath) }),
    );
    return { ...a, identity, bytes: native.bytes };
  });
  if (!report.persistentActors.length) report.persistentActors = rss.map(({ bytes, ...a }) => a);
  else
    for (const a of rss)
      assert.ok(
        report.persistentActors.some(
          (b) => b.projectId === a.projectId && b.role === a.role && b.pid === a.pid && b.identity === a.identity,
        ),
        'An owned persistent OS identity changed',
      );
  report.samples.push({ elapsedMs: elapsed(), completedCycles: report.completedCycles, rss });
}
const nativeError = /SCRIPT ERROR|\bERROR:|ObjectDB instances leaked|resources still in use/;
// No symlink traversal, no deletion, and engine copies excluded only at our exact immutable fixture paths.
async function inspectOwnedData() {
  let bytes = 0,
    files = 0;
  const transients = [];
  for (const p of projects) {
    const inventory = await inspectSoakInventory(p.fixture.root, {
      maxFiles: budgets.maxFiles,
      maxBytes: budgets.fixtureDataBytes,
      retiredShadowDirs: p.retiredShadowDirs,
      editorOutcomeSession: p.fixture.endpoint.sessionId,
    });
    bytes += inventory.bytes;
    files += inventory.files;
    if (files > budgets.maxFiles) throw new Error('Fixture file-count quota exhausted');
    if (bytes > budgets.fixtureDataBytes) throw new Error('Fixture data quota exhausted');
    if (inventory.vanishedEntries) {
      transients.push({ project: p.id, ...inventory });
      await record({ project: p.id, kind: 'INVENTORY_KNOWN_TRANSIENT_REMOVAL', ...inventory });
    }
    assert.doesNotMatch(p.fixture.output(), nativeError);
    for (const log of [
      path.join(p.fixture.root, '.harness/editor.log'),
      path.join(p.fixture.root, '.harness/persistent-runtime/godot.log'),
    ]) {
      if ((await stat(log)).size > budgets.diagnosticFileBytes)
        throw new Error('Native diagnostic log quota exhausted');
      assert.doesNotMatch(await readFile(log, 'utf8'), nativeError);
    }
  }
  report.fixtureData = { bytes, files, immutableEngineCopies: projects.length, atomicSnapshot: false,
    inventoryTransients: transients.map(({ project, vanishedEntries }) => ({ project, vanishedEntries })) };
}
async function checkpoint(completedCycles, elapsedMs, inspect = true) {
  let saveLive = false;
  if (inspect && elapsedMs - lastSourceCheck >= 60000) {
    report.sourceUnchanged = (await sourceIdentity(repo)).sourceHash === source.sourceHash;
    assert.equal(report.sourceUnchanged, true, 'Source changed; frozen workload cannot continue');
    await inspectOwnedData();
    lastSourceCheck = elapsedMs;
    saveLive = true;
  }
  const state = {
    schemaVersion: 2,
    status: report.status,
    mode: report.mode,
    qualification: 'NOT_QUALIFIED',
    sourceHash: source.sourceHash,
    startedAt: report.startedAt,
    durationMs: elapsedMs,
    completedCycles,
    requiredCycles: plan.cycles,
    requiredDurationMs: plan.durationMs,
    samples: report.samples.length,
    lastSampleMs: report.samples.at(-1)?.elapsedMs,
    ownedRoot,
    reportDir: runDir,
    workerPid: process.pid,
    fixtureData: report.fixtureData,
  };
  // Concurrent cycle and monitor checkpoints serialize; only one small progress file survives.
  progressQueue = progressQueue.then(async () => {
    if (saveLive) {
      const live = JSON.stringify({ ...report, durationMs: elapsedMs, lastCheckpointAt: new Date().toISOString() });
      if (Buffer.byteLength(live) > budgets.reportBytes) throw new Error('Live report exceeds frozen 16MiB quota');
      await writeFile(path.join(runDir, 'report.live.json.tmp'), live, { mode: 0o600 });
      await rename(path.join(runDir, 'report.live.json.tmp'), path.join(runDir, 'report.live.json'));
    }
    await writeFile(path.join(runDir, 'progress.json.tmp'), JSON.stringify(state), { mode: 0o600 });
    await rename(path.join(runDir, 'progress.json.tmp'), path.join(runDir, 'progress.json'));
  });
  await progressQueue;
}
let progressQueue = Promise.resolve();
await writeFile(path.join(runDir, 'source.json'), JSON.stringify(source, null, 2));
const godotVersion = (await exec(godot, ['--version'], { windowsHide: true, timeout: 10000 })).stdout.trim();
await writeFile(
  path.join(runDir, 'inputs.json'),
  JSON.stringify(
    {
      workerPid: process.pid,
      workerIdentityHash,
      sourceHash: source.sourceHash,
      plan,
      budgets,
      godot,
      godotVersion,
      godotSha256: sha256(await readFile(godot)),
      node: process.version,
      os: os.release(),
      approval: report.approval,
      command: process.argv.slice(2),
      responseConfiguration,
    },
    null,
    2,
  ),
);
try {
  for (const id of ['A', 'B']) {
    const scene = `[gd_scene format=3]\n[node name="Main" type="Node2D"]\n[node name="Marker" type="Node2D" parent="."]\nposition = Vector2(40, 0)\n[node name="Signal" type="Label" parent="Marker"]\ntext = "X"\noffset_top = 100.0\ntheme_override_font_sizes/font_size = 32\n[node name="Title" type="Label" parent="."]\ntext = "T31 local Codex soak ${id}"\noffset_left = 32.0\noffset_top = 32.0\ntheme_override_font_sizes/font_size = 32\n`;
    const fixture = await startEditorFixture(godot, { writeEnabled: true, scene });
    const p = {
      id,
      fixture,
      client: null,
      sessionId: '',
      runtimePid: 0,
      runtimeLauncherPid: 0,
      shadowSessionId: '',
      editorIdentity: null,
      runtimeIdentity: null,
      stderrBytes: 0,
      stderrTail: '',
      retiredShadowDirs: new Set(),
    };
    projects.push(p);
    p.editorIdentity = await readProcessIdentity(fixture.endpoint.editorPid);
    assert.ok(p.editorIdentity, 'Native editor OS identity must be available before any mutation');
    p.client = await wireEditor(fixture.root, {
      transport: 'stdio',
      onStderr: (chunk) => {
        p.stderrBytes += chunk.length;
        p.stderrTail = (p.stderrTail + chunk.toString('utf8')).slice(-16384);
        if (p.stderrBytes > budgets.diagnosticFileBytes) {
          cancelled.abort(new Error('MCP stderr diagnostic quota exhausted'));
          return;
        }
        diagnosticQueue = diagnosticQueue.then(() => appendFile(path.join(runDir, `${id}-mcp-stderr.log`), chunk));
        diagnosticQueue.catch((error) => cancelled.abort(error));
        if (/MaxListenersExceededWarning/.test(p.stderrTail))
          cancelled.abort(new Error('MCP transport listener warning must be investigated'));
      },
      approval: async (message) => {
        const normalized = message.replaceAll('\\', '/');
        const accepted =
          normalized.includes(fixture.root.replaceAll('\\', '/')) && /Plan SHA-256: [a-f0-9]{64}/.test(message);
        await record({ project: id, kind: 'MOCK exact fixture approval', accepted, messageSha256: sha256(message) });
        return { action: accepted ? 'accept' : 'decline', content: { confirm: accepted } };
      },
    });
    const open = await call(p, 'open_runtime_bridge', {
      godotPath: godot,
      bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
      headless: false,
      evidenceDir: path.join(fixture.root, '.harness', 'persistent-runtime'),
    });
    p.sessionId = open.session_id;
    p.runtimeLauncherPid = open.pid;
  }
  // Windows console executables may only supervise the engine. Bind telemetry to the actual native child.
  const nativeScript = `
$ErrorActionPreference='Stop'
$rows=@(foreach($taskPid in ($env:WHEEL_SOAK_PIDS -split ',')) {
 $root=Get-CimInstance Win32_Process -Filter ("ProcessId="+[int]$taskPid)
 if($null -eq $root) { throw 'Owned runtime launcher is missing' }
 $native=[int]$taskPid
 if($root.ExecutablePath -match '_console\\.exe$') {
  $expected=$root.ExecutablePath -replace '_console\\.exe$','.exe'
  $children=@(Get-CimInstance Win32_Process -Filter ("ParentProcessId="+[int]$taskPid) | Where-Object { $_.ExecutablePath -ieq $expected })
  if($children.Count -ne 1) { throw 'Cannot identify a unique native Godot child; never substitute launcher RSS' }
  $native=$children[0].ProcessId
 }
 [pscustomobject]@{ launcherPid=[int]$taskPid; nativePid=[int]$native }
})
ConvertTo-Json -InputObject $rows -Compress
`;
  const resolved = JSON.parse(
    (
      await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', nativeScript], {
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 8192,
        env: {
          SystemRoot: process.env.SystemRoot,
          PATH: process.env.PATH,
          WHEEL_SOAK_PIDS: projects.map((p) => p.runtimeLauncherPid).join(','),
        },
      })
    ).stdout,
  );
  for (const p of projects) {
    p.runtimePid = resolved.find((r) => r.launcherPid === p.runtimeLauncherPid)?.nativePid;
    assert.ok(Number.isSafeInteger(p.runtimePid) && p.runtimePid > 0);
    p.runtimeIdentity = await readProcessIdentity(p.runtimePid);
    assert.ok(p.runtimeIdentity, 'Native runtime OS identity must be available before any mutation');
  }
  report.actorBinding =
    'SDK transport PID, editor authenticated endpoint editorPid, runtime owned-launcher native-child lineage; no supervisor RSS substitution';
  workloadStart = performance.now();
  report.startedAt = new Date().toISOString();
  const scheduled = await scheduleSoak(
    plan,
    {
      cycle: async (index, signal) => {
        activeSignal = signal;
        const p = projects[index % 2];
        const cycle = Math.floor(index / 2);
        const startedMs = Math.floor(performance.now() - workloadStart);
        const latencyMs = {};
        const operations = [];
        async function measure(op, fn) {
          const start = performance.now();
          const result = await fn();
          latencyMs[op] = performance.now() - start;
          operations.push({
            operation: op,
            startedMs: Math.floor(start - workloadStart),
            finishedMs: Math.floor(performance.now() - workloadStart),
            durationMs: latencyMs[op],
          });
          return result;
        }
        const state = await measure('read', () => call(p, 'get_editor_state'));
        assert.ok(state.sceneTree.nodes.some((n) => n.path === 'Marker'));
        const expectedX = 100 + (cycle % 20) * 10 + (p.id === 'A' ? 1 : 2);
        const before = await readFile(path.join(p.fixture.root, 'main.tscn'));
        await measure('edit', () =>
          call(p, 'apply_editor_scene', {
            operationId: `soak-${p.id}-edit-${cycle}`,
            operations: [
              { kind: 'set', path: 'Marker', property: 'position', value: { type: 'Vector2', x: expectedX, y: 0 } },
            ],
          }),
        );
        const saved = await measure('validate', () =>
          call(p, 'save_editor_scene', { operationId: `soak-${p.id}-save-${cycle}` }),
        );
        assert.equal(saved.persisted, true);
        assert.equal(saved.validation, 'PASS');
        const after = await readFile(path.join(p.fixture.root, 'main.tscn'));
        assert.notEqual(sha256(before), sha256(after));
        await measure('reload', async () => {
          await call(p, 'reload_scene', { sessionId: p.sessionId, scenePath: 'res://main.tscn', responseMode: responseConfiguration.reload });
          const deadline = Date.now() + 5000;
          for (;;) {
            const result = await rpc(p, 'get_property', { nodePath: 'Marker', property: 'position' });
            if (result.value.x === expectedX) break;
            assert.ok(Date.now() < deadline, 'Reloaded native scene did not expose saved position');
            await new Promise((resolve) => setTimeout(resolve, 50)); // Read-only barrier; never retry a write.
          }
        });
        const images = path.join(p.fixture.root, '.harness', 'persistent-runtime', 'current-frame');
        await mkdir(images, { recursive: true });
        const png = path.join(images, 'visible.png');
        const archive = path.join(runDir, 'native-artifacts');
        await mkdir(archive, { recursive: true });
        await measure('screenshot', async () => {
          await rpc(p, 'capture_screenshot', { path: png });
          const decoded = await compareScreenshots(png, png, { threshold: 0 });
          assert.ok(decoded.width > 1 && decoded.height > 1);
          if (cycle === 0) {
            const hidden = path.join(images, 'hidden.png');
            await rpc(p, 'set_property', { nodePath: 'Title', property: 'visible', value: false });
            await rpc(p, 'capture_screenshot', { path: hidden });
            const delta = await compareScreenshots(png, hidden, { threshold: 0 });
            assert.ok(delta.differentPixels > 100, 'Real label pixels must be visible, not a blank frame');
            await copyFile(hidden, path.join(archive, `${p.id}-hidden.png`));
            await rpc(p, 'set_property', { nodePath: 'Title', property: 'visible', value: true });
          }
        });
        const archivedPng = path.join(archive, `${p.id}-latest.png`);
        await copyFile(png, archivedPng);
        await copyFile(path.join(p.fixture.root, 'main.tscn'), path.join(archive, `${p.id}-latest.tscn`));
        if (cycle === 0) {
          await copyFile(png, path.join(archive, `${p.id}-first.png`));
          await copyFile(path.join(p.fixture.root, 'main.tscn'), path.join(archive, `${p.id}-first.tscn`));
        }
        const shadow = await call(p, 'open_runtime_bridge', {
          godotPath: godot,
          bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
          headless: true,
          evidenceDir: path.join(p.fixture.root, '.harness', 'shadow', `cycle-${cycle}`),
        });
        p.shadowSessionId = shadow.session_id;
        const stopped = await measure('stop', () => call(p, 'stop_runtime_bridge', { sessionId: p.shadowSessionId }));
        p.shadowSessionId = '';
        assert.equal(stopped.forced, false);
        assert.equal(stopped.exitCode, 0);
        assert.equal(getProcessStatus(shadow.pid).running, false);
        const shadowLog = path.join(p.fixture.root, '.harness', 'shadow', `cycle-${cycle}`, 'godot.log');
        assert.doesNotMatch(await readFile(shadowLog, 'utf8'), nativeError);
        const shadowEvidence = await retainStoppedSoakShadow(
          {
            projectRoot: p.fixture.root,
            cycle,
            sessionId: shadow.session_id,
            pid: shadow.pid,
            forced: stopped.forced,
            exitCode: stopped.exitCode,
          },
          async (snapshot) => {
            for (const slot of cycle === 0 ? ['first', 'latest'] : ['latest']) {
              const target = path.join(runDir, 'native-shadow', `${p.id}-${slot}`);
              await mkdir(target, { recursive: true });
              for (const f of snapshot.files) await writeFile(path.join(target, f.name), f.bytes, { mode: 0o600 });
            }
            await record({
              project: p.id,
              cycle,
              kind: 'ARCHIVED_STOPPED_SHADOW',
              process: snapshot.process,
              files: snapshot.files.map((f) => ({ name: f.name, bytes: f.bytes.length, sha256: f.sha256 })),
            });
            // The retention helper has verified a normal, stopped native session and archived its hashes.
            // Its ensuing exact unlink/rmdir may overlap the independent quota sampler.
            p.retiredShadowDirs.add(path.join(p.fixture.root, '.harness', 'shadow', `cycle-${cycle}`));
          },
        );
        const other = projects.find((q) => q !== p);
        await call(p, 'get_project_info', { projectPath: other.fixture.root }, 'FORBIDDEN');
        report.completedCycles++;
        report.cycles.push({
          index,
          projectId: p.id,
          startedMs,
          finishedMs: Math.floor(performance.now() - workloadStart),
          operations,
          scheduledMs: Math.floor((Math.floor(index / 2) * 2 * plan.durationMs) / plan.cycles),
          queueDelayMs: Math.max(
            0,
            startedMs - Math.floor((Math.floor(index / 2) * 2 * plan.durationMs) / plan.cycles),
          ),
          project: p.id,
          cycle,
          expectedX,
          beforeSha256: sha256(before),
          afterSha256: sha256(after),
          screenshotSha256: sha256(await readFile(png)),
          screenshotArtifact: cycle === 0 ? path.relative(repo, path.join(archive, `${p.id}-first.png`)) : null,
          latestArtifactSlot: path.relative(repo, archivedPng),
          reloadScope: 'Native scene property readback; script/code freshness NOT_VERIFIED',
          validation: 'PASS',
          crossProject: 'FORBIDDEN',
          latencyMs,
          shadowEvidence,
        });
      },
      sample,
      checkpoint,
    },
    cancelled.signal,
  );
  activeSignal = undefined;
  report.durationMs = scheduled.durationMs;
  report.cycles.sort((a, b) => a.index - b.index);
  report.finishedAt = new Date().toISOString();
  report.sourceUnchanged = (await sourceIdentity(repo)).sourceHash === source.sourceHash;
  assert.equal(report.sourceUnchanged, true);
  await inspectOwnedData();
  report.status = 'COMPLETED';
} catch (error) {
  activeSignal = undefined;
  report.status = 'FAILED';
  report.failedCycles++;
  report.error = String(error).slice(0, 8192);
  report.errorStack = error instanceof Error ? error.stack?.slice(0, 8192) : undefined;
  process.exitCode = 1;
} finally {
  let cleaned = true;
  for (const p of projects) {
    try {
      if (p.shadowSessionId) await call(p, 'stop_runtime_bridge', { sessionId: p.shadowSessionId });
      if (p.sessionId) {
        const stopped = await call(p, 'stop_runtime_bridge', { sessionId: p.sessionId });
        assert.equal(stopped.forced, false);
        assert.equal(stopped.exitCode, 0);
        assert.equal(getProcessStatus(p.runtimePid).running, false);
        const log = await readFile(path.join(p.fixture.root, '.harness/persistent-runtime/godot.log'), 'utf8');
        assert.doesNotMatch(log, /SCRIPT ERROR|\bERROR:|ObjectDB instances leaked|resources still in use/);
      }
      if (p.client) {
        const serverPid = p.client.client.transport.pid;
        await p.client.close();
        assert.equal(getProcessStatus(serverPid).running, false);
      }
      await p.fixture.command('quit');
      await p.fixture.exited;
      assert.equal(getProcessStatus(p.fixture.pid).running, false);
      assert.equal(getProcessStatus(p.fixture.endpoint.editorPid).running, false);
      assert.doesNotMatch(p.fixture.output(), /SCRIPT ERROR|\bERROR:|ObjectDB instances leaked|resources still in use/);
    } catch (error) {
      cleaned = false;
      report.cleanupError = String(error).slice(0, 4096);
      await p.client?.close().catch(() => {});
      // Emergency cleanup may only target our previously captured OS birth identity, never a guessed/reused PID.
      for (const [pid, identity] of [
        [p.runtimePid, p.runtimeIdentity],
        [p.fixture.endpoint.editorPid, p.editorIdentity],
      ]) {
        if (identity && getProcessStatus(pid).running) {
          const result = await stopIdentifiedProcess(pid, identity).catch(() => 'UNSUPPORTED');
          if (result !== 'STOPPED' && result !== 'NOT_FOUND')
            report.cleanupError += `; verified emergency stop: ${result}`;
        }
      }
      await p.fixture.stop().catch(() => {});
    }
  }
  // Critical native diagnostics survive successful scratch cleanup; never copy tokens or editor configs.
  try {
    const archive = path.join(runDir, 'native-diagnostics');
    await mkdir(archive, { recursive: true });
    for (const p of projects) {
      const files = [
        ['editor', path.join(p.fixture.root, '.harness/editor.log')],
        ['runtime', path.join(p.fixture.root, '.harness/persistent-runtime/godot.log')],
      ];
      for (const [label, file] of files) {
        const info = await stat(file).catch(() => null);
        if (!info) continue;
        if (info.size > budgets.diagnosticFileBytes) throw new Error('Diagnostic archive exceeds file quota');
        await copyFile(file, path.join(archive, `${p.id}-${label}.log`));
      }
    }
  } catch (error) {
    cleaned = false;
    report.cleanupError = String(error);
  }
  if (cleaned && report.status === 'COMPLETED') {
    try {
      const exact = await realpath(ownedRoot);
      assert.equal(path.dirname(exact), tempParent);
      assert.match(path.basename(exact), /^wheel-soak-smoke-[A-Za-z0-9]+$/);
      assert.equal((await lstat(ownedRoot)).isSymbolicLink(), false);
      await rm(exact, { recursive: true, force: false });
      report.fixtureDiscarded = true;
    } catch (error) {
      cleaned = false;
      report.cleanupError = String(error);
    }
  }
  report.cleanup = cleaned;
  report.leakedOwnedProcesses = report.persistentActors.filter((a) => getProcessStatus(a.pid).running).length;
  if (report.leakedOwnedProcesses) cleaned = report.cleanup = false;
  if (!cleaned) {
    report.status = 'FAILED';
    process.exitCode = 1;
  }
  report.finishedAt ??= new Date().toISOString();
  report.durationMs ??= workloadStart ? Math.floor(performance.now() - workloadStart) : 0;
  await diagnosticQueue;
  if (report.warning || projects.some((p) => /MaxListenersExceededWarning/.test(p.stderrTail))) {
    report.status = 'FAILED';
    report.error ??= 'Transport warning during final cleanup; cannot pass';
    process.exitCode = 1;
  }
  const serialized = JSON.stringify(report, null, 2);
  assert.ok(Buffer.byteLength(serialized) <= budgets.reportBytes, 'Report exceeded frozen 16MiB budget');
  await writeFile(path.join(runDir, 'report.json'), serialized);
  const assessment = assessSoakReport(report, (await sourceIdentity(repo)).sourceHash);
  await writeFile(path.join(runDir, 'limits-assessment.json'), JSON.stringify(assessment, null, 2));
  if (longRun && assessment.status !== 'PASS_REPORTED_LIMITS_ONLY') process.exitCode = 1;
  await checkpoint(report.completedCycles, report.durationMs, false);
  const evidence = [];
  async function indexFiles(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Evidence index refuses symlinks');
      if (entry.isDirectory()) await indexFiles(file);
      else if (entry.isFile() && entry.name !== 'artifact-index.json') {
        const bytes = await readFile(file);
        evidence.push({ path: path.relative(runDir, file), bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  await indexFiles(runDir);
  await writeFile(
    path.join(runDir, 'artifact-index.json'),
    JSON.stringify(
      { sourceHash: source.sourceHash, status: report.status, qualification: 'NOT_QUALIFIED', evidence },
      null,
      2,
    ),
  );
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onInterrupt);
  process.off('warning', onWarning);
  console.log(
    JSON.stringify({
      status: report.status,
      result: report.status === 'COMPLETED' ? (longRun ? assessment.status : 'PASS_NATIVE_SMOKE_NOT_SOAK') : 'FAIL',
      qualification: report.qualification,
      completedCycles: report.completedCycles,
      cleanup: report.cleanup,
      error: report.error,
      reportDir: runDir,
    }),
  );
}

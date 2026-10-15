import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, readFile, writeFile, realpath, lstat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sourceIdentity, sha256 } from './lib/production-manifest.mjs';
import { startEditorFixture } from '../build/tests/helpers/editor-fixture.js';

// Installed Codex app-server protocol, not an SDK imitation or a model-quality test.
// No turn/start, login, credential reads, permanent config changes, or user project edits.
const root = process.cwd();
const value = (name) => process.argv[process.argv.indexOf(name) + 1];
const codex = process.argv.includes('--codex') ? value('--codex') : 'codex.exe';
const godot = process.env.GODOT_PATH;
if (!godot) throw new Error('GODOT_PATH is required for the native client fixture');
const source = await sourceIdentity(root);
const version = execFileSync(codex, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
const reportDir = path.resolve(
  'runs/production-roadmap/T30',
  'codex-probe-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid,
);
await mkdir(reportDir, { recursive: true });
const operations = [{ kind: 'create', parent: '.', name: 'T30Marker', type: 'Marker2D' }];
const report = {
  schemaVersion: 1,
  taskId: 'T30',
  status: 'FAIL',
  client: version,
  sourceHash: source.sourceHash,
  scope: 'Installed Codex CLI app-server stdio representative native fixture; NOT desktop/TUI human UX',
  approval: 'MOCK exact-plan fixture host',
  noModelTurn: true,
  permanentConfigWrites: false,
  checks: [],
  requests: [],
  approvalDecisions: [],
  cleanup: false,
  error: null,
};
let fixture, child, timer;
let counter = 0;
const pending = new Map();
const norm = (text) => text.replaceAll('\\', '/').toLowerCase();
async function request(method, params) {
  report.requests.push({ method, params });
  const id = ++counter;
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Codex request deadline: ' + method));
    }, 90000);
    pending.set(id, {
      resolve: (result) => {
        clearTimeout(deadline);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(deadline);
        reject(error);
      },
    });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
try {
  fixture = await startEditorFixture(godot, { writeEnabled: true });
  const serverName = 'wheel_t30_probe';
  const env = {
    MCP_STDIO_SCOPES: 'read,write,run',
    MCP_STDIO_PROJECT_ROOTS: fixture.root,
    MCP_STDIO_EVIDENCE_ROOTS: fixture.root,
    GODOT_PATH: godot,
    MCP_STDIO_APPROVED_GODOT_PATHS: godot,
    GODOT_HARNESS_RUN_REGISTRY_PATH: path.join(fixture.root, '.harness/probe-registry.json'),
  };
  const config =
    'mcp_servers = { ' +
    serverName +
    ' = { command = ' +
    JSON.stringify(process.execPath) +
    ', args = [' +
    JSON.stringify(path.join(root, 'build/src/mcp-server-sdk.js')) +
    '], cwd = ' +
    JSON.stringify(root) +
    ', env = { ' +
    Object.entries(env)
      .map(([key, item]) => key + ' = ' + JSON.stringify(item))
      .join(',') +
    ' }, startup_timeout_sec = 20, tool_timeout_sec = 90 } }';
  child = spawn(codex, ['-c', config, 'app-server'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  child.stderr.on('data', () => {});
  child.once('error', (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (message.method === 'mcpServer/elicitation/request' && message.id !== undefined) {
        const text = message.params?.message ?? '';
        const allowed =
          message.params?.serverName === serverName &&
          message.params?.mode === 'form' &&
          norm(text).includes(norm(fixture.root)) &&
          /Plan SHA-256: [a-f0-9]{64}/.test(text) &&
          (text.includes(JSON.stringify(operations, null, 2)) || text.includes('main.tscn'));
        report.approvalDecisions.push({ mode: message.params?.mode, messageHash: sha256(text), accepted: allowed });
        child.stdin.write(
          JSON.stringify({
            id: message.id,
            result: allowed ? { action: 'accept', content: { confirm: true } } : { action: 'decline' },
          }) + '\n',
        );
        return;
      }
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
      }
    } catch {
      /* Notifications with no pending request are not tool results. */
    }
  });
  timer = setTimeout(() => {
    child.kill();
    for (const waiter of pending.values()) waiter.reject(new Error('Bounded Codex fixture deadline'));
    pending.clear();
  }, 180000);
  await request('initialize', {
    clientInfo: { name: 'wheel_t30_probe', version: '1' },
    capabilities: { experimentalApi: true, mcpServerOpenaiFormElicitation: true },
  });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const started = await request('thread/start', {
    cwd: fixture.root,
    ephemeral: true,
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
  });
  const threadId = started.thread.id;
  const inventory = await request('mcpServerStatus/list', { threadId, serverName, detail: 'full', limit: 5 });
  const server = inventory.data.find((entry) => entry.name === serverName);
  assert.ok(server?.tools?.apply_editor_scene);
  report.checks.push({
    name: 'real client discovery',
    tools: Object.keys(server.tools).length,
    resources: server.resources?.length ?? 0,
  });
  const call = async (tool, args = {}) => {
    const result = await request('mcpServer/tool/call', {
      threadId,
      server: serverName,
      tool,
      arguments: { projectPath: fixture.root, ...args },
    });
    report.checks.push({
      name: tool,
      isError: result.isError ?? false,
      data: result.structuredContent,
      responseHash: sha256(JSON.stringify(result)),
    });
    return result;
  };
  assert.notEqual((await call('get_editor_state')).isError, true);
  const applied = await call('apply_editor_scene', { operations, operationId: 't30-native-client-apply' });
  assert.notEqual(applied.isError, true, JSON.stringify(applied.structuredContent));
  assert.equal(applied.structuredContent.persisted, false);
  const saved = await call('save_editor_scene', { operationId: 't30-native-client-save' });
  assert.notEqual(saved.isError, true, JSON.stringify(saved.structuredContent));
  assert.equal(saved.structuredContent.validation, 'PASS');
  assert.equal(saved.structuredContent.persisted, true);
  const bytes = await readFile(path.join(fixture.root, 'main.tscn'), 'utf8');
  assert.ok(bytes.includes('name="T30Marker" type="Marker2D"'));
  report.checks.push({ name: 'independent saved bytes readback', sha256: sha256(bytes) });
  assert.equal((await sourceIdentity(root)).sourceHash, source.sourceHash);
  report.status = 'PASS';
} catch (error) {
  report.error = String(error).slice(0, 8192);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  for (const waiter of pending.values()) waiter.reject(new Error('Probe closed'));
  pending.clear();
  child?.stdin.end();
  if (child) {
    await new Promise((resolve) => {
      const stop = setTimeout(() => {
        child.kill();
        resolve();
      }, 2000);
      child.once('close', () => {
        clearTimeout(stop);
        resolve();
      });
    });
  }
  if (fixture) {
    try {
      await fixture.command('quit');
      await fixture.exited;
      report.cleanup = true;
    } catch (error) {
      await fixture.stop();
      report.status = 'FAIL';
      report.error = String(error);
      process.exitCode = 1;
    }
  }
  // Only this freshly minted fixture, never historical roots blocked by host policy.
  if (fixture && report.status === 'PASS' && report.cleanup) {
    try {
      const exact = await realpath(fixture.root);
      const parent = await realpath(os.tmpdir());
      assert.equal(path.dirname(exact), parent);
      assert.match(path.basename(exact), /^wheel-editor-[A-Za-z0-9]+$/);
      assert.equal((await lstat(fixture.root)).isSymbolicLink(), false);
      await rm(exact, { recursive: true, force: false });
      report.fixtureDiscarded = true;
    } catch (error) {
      report.status = 'FAIL';
      report.error = 'Owned scratch cleanup: ' + String(error);
      process.exitCode = 1;
    }
  }
  await writeFile(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      status: report.status,
      client: version,
      approvals: report.approvalDecisions,
      error: report.error,
      reportDir: path.relative(root, reportDir),
      reportSha256: sha256(await readFile(path.join(reportDir, 'report.json'))),
    }),
  );
}

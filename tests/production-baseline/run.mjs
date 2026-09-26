import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { defectCatalog, classifyProbe, validateBaselineSummary } from './catalog.mjs';
import { enableFixtureApproval } from '../../build/tests/helpers/project-approval.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const godotPath = process.env.GODOT_PATH ?? '';
const bridgePath = path.join(root, 'godot-plugin/runtime_bridge.gd');
const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const runDir = path.join(root, 'runs/production-roadmap/T01', runId);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function unwrap(result) {
  const text = result.content?.find((item) => item.type === 'text')?.text;
  const body = text ? JSON.parse(text) : (result.structuredContent ?? {});
  return { isError: result.isError === true, body, data: body.response ?? body };
}

async function call(client, name, args) {
  return unwrap(await client.callTool({ name, arguments: args }));
}

function requireSuccess(result, label) {
  if (result.isError) throw new Error(`${label}: ${JSON.stringify(result.body)}`);
  return result.data;
}

async function makeProject() {
  const dir = path.join(runDir, 'project');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'project.godot'),
    '[application]\nconfig/name="Production defect baseline"\nrun/main_scene="res://main.tscn"\n',
  );
  await writeFile(
    path.join(dir, 'main.tscn'),
    '[gd_scene load_steps=2 format=3]\n' +
      '[ext_resource type="Script" path="res://state.gd" id="1"]\n' +
      '[node name="Main" type="Node2D"]\n' +
      'script = ExtResource("1")\n' +
      'position = Vector2(10, 20)\n',
  );
  await writeFile(path.join(dir, 'state.gd'), 'extends Node2D\nvar version = 1\n');
  await writeFile(
    path.join(dir, 'three_d.tscn'),
    '[gd_scene format=3]\n[node name="World" type="Node3D"]\n[node name="Camera" type="Camera3D" parent="."]\n',
  );
  await writeFile(
    path.join(dir, 'semantics.gd'),
    'extends Node\nenum Mode { IDLE, RUNNING }\nvar state: Mode = Mode.IDLE\nfunc advance():\n\tstate = Mode.RUNNING\n',
  );
  await writeFile(
    path.join(dir, 'validate_scene.gd'),
    'extends SceneTree\nfunc _initialize():\n\tvar scene = load("res://bad.tscn")\n\tif scene is PackedScene:\n\t\tprint("BASELINE_VALID_SCENE")\n\t\tquit(0)\n\telse:\n\t\tprint("BASELINE_INVALID_SCENE")\n\t\tquit(3)\n',
  );
  return dir;
}

async function open(client, projectPath, evidenceName, extra = {}) {
  const result = await call(client, 'open_runtime_bridge', {
    godotPath,
    projectPath,
    bridgePath,
    evidenceDir: path.join(runDir, evidenceName),
    headless: true,
    timeoutMs: 15000,
    ...extra,
  });
  const data = requireSuccess(result, 'open_runtime_bridge');
  const sessionId = data.session_id ?? data.sessionId;
  if (!sessionId) throw new Error(`open_runtime_bridge omitted session ID: ${JSON.stringify(result.body)}`);
  return { sessionId, evidenceDir: data.evidenceDir ?? path.join(runDir, evidenceName) };
}

async function stop(client, sessionId) {
  if (sessionId) await call(client, 'stop_runtime_bridge', { sessionId, timeoutMs: 6000 }).catch(() => undefined);
}

async function bridge(client, sessionId, method, params, operationId) {
  return call(client, 'call_runtime_bridge', { sessionId, method, params, operationId, timeoutMs: 10000 });
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  const startedAt = Date.now();
  if (!existsSync(godotPath))
    throw new Error('GODOT_PATH must name a real Godot executable; baseline cannot skip Godot');
  if (!existsSync(path.join(root, 'build/src/mcp-server-sdk.js')))
    throw new Error('build/src/mcp-server-sdk.js is missing; run npm run build first');
  await mkdir(runDir, { recursive: true });
  const projectPath = await makeProject();
  const source = await import('../../scripts/lib/production-manifest.mjs');
  const sourceIdentity = await source.sourceIdentity(root);
  const summary = {
    schemaVersion: 1,
    taskId: 'T01',
    gateId: 'G0',
    sourceHash: sourceIdentity.sourceHash,
    testDouble: 'MIXED',
    provenance: {
      engine: 'REAL',
      transport: 'REAL',
      projectWriteApproval: 'MOCK: isolated fixture form accept; not a human UI confirmation',
    },
    godotVersion: (await execFileAsync(godotPath, ['--version'], { timeout: 10000 })).stdout.trim(),
    environment: `${os.platform()} ${os.release()} ${os.arch()} / ${process.version}`,
    runDir: path.relative(root, runDir).replaceAll('\\', '/'),
    fixtureHash: digest(
      (
        await Promise.all(
          ['project.godot', 'main.tscn', 'state.gd', 'three_d.tscn', 'semantics.gd'].map((name) =>
            readFile(path.join(projectPath, name)),
          ),
        )
      )
        .map((item) => item.toString('utf8'))
        .join('\n'),
    ),
    controls: [],
    cases: [],
  };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, 'build/src/mcp-server-sdk.js')],
    stderr: 'pipe',
  });
  const client = new Client(
    { name: 'production-defect-baseline', version: '1.0.0' },
    { capabilities: { elicitation: { form: {} } } },
  );
  enableFixtureApproval(client);
  let sessionId = '';
  try {
    await client.connect(transport);
    const base = await open(client, projectPath, 'persistent');
    sessionId = base.sessionId;
    async function record(id, input, probe) {
      const item = defectCatalog.find((candidate) => candidate.id === id);
      let outcome;
      try {
        outcome = await probe();
      } catch (error) {
        outcome = { verified: false, correct: false, actual: { exception: String(error) } };
      }
      const entry = {
        ...item,
        status: classifyProbe(outcome),
        input,
        actual: outcome.actual,
        subchecks: outcome.subchecks,
        provenance: { execution: 'REAL', approval: ['D04', 'D07'].includes(id) ? 'MOCK' : 'NOT_RUN' },
        evidence: {
          runDir: path.relative(root, runDir).replaceAll('\\', '/'),
          actualSha256: digest(JSON.stringify(outcome.actual)),
        },
      };
      summary.cases.push(entry);
      console.log(`${id}: ${entry.status}`);
    }

    const scalar = requireSuccess(
      await bridge(client, sessionId, 'set_property', { nodePath: '.', property: 'rotation', value: 1.25 }),
      'scalar set',
    );
    const scalarRead = requireSuccess(
      await bridge(client, sessionId, 'get_property', { nodePath: '.', property: 'rotation' }),
      'scalar read',
    );
    const method = requireSuccess(
      await call(client, 'call_runtime_method', {
        sessionId,
        nodePath: '.',
        method: 'set_position',
        args: [{ type: 'Vector2', x: 11, y: 22 }],
      }),
      'Vector2 method',
    );
    const methodRead = requireSuccess(
      await bridge(client, sessionId, 'get_property', { nodePath: '.', property: 'position' }),
      'Vector2 method read',
    );
    summary.controls.push({
      id: 'C01',
      title: 'Real persistent scalar read/write and correctly decoded Vector2 method call',
      status:
        scalar.after === 1.25 &&
        scalarRead.value === 1.25 &&
        method.method === 'set_position' &&
        methodRead.value?.x === 11 &&
        methodRead.value?.y === 22
          ? 'PASS'
          : 'FAIL',
      actual: { scalar, scalarRead, methodRead },
    });
    console.log(`C01: ${summary.controls.at(-1).status}`);

    await record('D01', { taggedValue: { type: 'Vector2', x: 42, y: 17 }, nodeType: 'Node2D' }, async () => {
      const set = await bridge(client, sessionId, 'set_property', {
        nodePath: '.',
        property: 'position',
        value: { type: 'Vector2', x: 42, y: 17 },
      });
      const read = await bridge(client, sessionId, 'get_property', { nodePath: '.', property: 'position' });
      const created = await call(client, 'create_runtime_node', {
        sessionId,
        parentPath: '.',
        type: 'Node2D',
        name: 'TaggedChild',
        properties: { position: { type: 'Vector2', x: 25, y: 35 } },
      });
      const child = await bridge(client, sessionId, 'get_property', {
        nodePath: 'TaggedChild',
        property: 'position',
      });
      return {
        verified: !read.isError && !child.isError && !created.isError,
        correct:
          read.data.value?.x === 42 &&
          read.data.value?.y === 17 &&
          child.data.value?.x === 25 &&
          child.data.value?.y === 35,
        actual: { set: set.body, read: read.body, created: created.body, child: child.body },
      };
    });

    await record('D02', { tool: 'get_game_state', nodePath: 'MissingNode', properties: ['position'] }, async () => {
      const result = await call(client, 'get_game_state', {
        sessionId,
        nodePath: 'MissingNode',
        properties: ['position'],
      });
      return {
        verified: result.data.error === 'node not found' || result.isError,
        correct: result.isError && typeof result.body.code === 'string',
        actual: result,
      };
    });

    await record('D03', { tool: 'get_runtime_events', source: 'persistent notifications' }, async () => {
      await sleep(120);
      const eventText = await readFile(path.join(base.evidenceDir, 'events.jsonl'), 'utf8');
      const raw = eventText.trim().split(/\r?\n/).map(JSON.parse);
      const result = await call(client, 'get_runtime_events', { evidenceDir: base.evidenceDir, cursor: 0 });
      return {
        verified:
          !result.isError && raw.some((item) => item.method === 'runtime/event' || item.event === 'level_started'),
        correct:
          result.data.events?.some((item) => item.event === 'level_started') && result.data.invalid_lines?.length === 0,
        actual: { rawNotifications: raw, readResult: result.body },
      };
    });

    await record('D04', { script: 'state.gd', edit: 'version = 1 → 2', method: 'fresh dev_loop' }, async () => {
      const before = await bridge(client, sessionId, 'get_property', { nodePath: '.', property: 'version' });
      const edit = await call(client, 'write_project_file', {
        projectPath,
        filePath: 'state.gd',
        content: 'extends Node2D\nvar version = 2\n',
      });
      const reload = await call(client, 'reload_scene', { sessionId, scenePath: 'res://main.tscn' });
      const after = await bridge(client, sessionId, 'get_property', { nodePath: '.', property: 'version' });
      const fresh = await call(client, 'dev_loop', {
        projectPath,
        godotPath,
        bridgePath,
        evidenceDir: path.join(runDir, 'fresh-code'),
        checks: [
          {
            id: 'fresh_version',
            method: 'get_property',
            params: { nodePath: '.', property: 'version' },
            path: 'value',
            op: 'equals',
            expected: 2,
          },
        ],
        maxRetries: 0,
        timeoutMs: 20000,
      });
      return {
        verified: before.data.value === 1 && !edit.isError && !reload.isError && !after.isError && !fresh.isError,
        correct:
          reload.data.code_freshness === 'NOT_VERIFIED' &&
          fresh.body.status === 'PASS' &&
          fresh.body.attempts?.[0]?.checks?.some(
            (check) => check.id === 'fresh_version' && check.passed && check.actual?.value === 2,
          ),
        actual: { before: before.body, edit: edit.body, reload: reload.body, after: after.body, fresh: fresh.body },
      };
    });

    await record(
      'D05',
      { tool: 'get_game_state', properties: ['position', 'version'], responseMode: 'compact' },
      async () => {
        const normal = await call(client, 'get_game_state', {
          sessionId,
          nodePath: '.',
          properties: ['position', 'version'],
          responseMode: 'normal',
        });
        const compact = await call(client, 'get_game_state', {
          sessionId,
          nodePath: '.',
          properties: ['position', 'version'],
          responseMode: 'compact',
        });
        return {
          verified: !normal.isError && !compact.isError && typeof normal.data.properties?.version === 'number',
          correct: JSON.stringify(compact.data.properties) === JSON.stringify(normal.data.properties),
          actual: { normal: normal.body, compact: compact.body },
        };
      },
    );

    await record(
      'D06',
      { tools: ['set_runtime_property', 'get_runtime_property', 'inject_runtime_input', 'capture_runtime_screenshot'] },
      async () => {
        const write = await call(client, 'set_runtime_property', {
          godotPath,
          projectPath,
          bridgePath,
          evidenceDir: path.join(runDir, 'legacy-write'),
          nodePath: '.',
          property: 'rotation',
          value: 1.75,
        });
        const read = await call(client, 'get_runtime_property', {
          godotPath,
          projectPath,
          bridgePath,
          evidenceDir: path.join(runDir, 'legacy-read'),
          nodePath: '.',
          property: 'rotation',
        });
        const input = await call(client, 'inject_runtime_input', {
          godotPath,
          projectPath,
          bridgePath,
          evidenceDir: path.join(runDir, 'legacy-input'),
          keycode: 65,
        });
        const screenshot = await call(client, 'capture_runtime_screenshot', {
          godotPath,
          projectPath,
          bridgePath,
          evidenceDir: path.join(runDir, 'legacy-screenshot'),
          screenshotPath: path.join(runDir, 'legacy-screenshot', 'shot.png'),
        });
        const screenshotBytes = await readFile(path.join(runDir, 'legacy-screenshot', 'shot.png')).catch(() =>
          Buffer.alloc(0),
        );
        summary.controls.push({
          id: 'C03',
          title: 'Real Godot-rendered PNG screenshot',
          status:
            !screenshot.isError &&
            screenshotBytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
            screenshotBytes.length > 1000
              ? 'PASS'
              : 'FAIL',
          actual: { bytes: screenshotBytes.length, image: screenshot.body.image, response: screenshot.data },
        });
        console.log(`C03: ${summary.controls.at(-1).status}`);
        await writeFile(
          path.join(projectPath, 'state.gd'),
          'extends Node2D\nvar version = 2\nvar key_events = 0\nfunc _input(event):\n\tif event is InputEventKey and event.pressed:\n\t\tkey_events += 1\n',
        );
        const first = await open(client, projectPath, 'continuous-a', { headless: false });
        let second;
        let continuous;
        try {
          second = await open(client, projectPath, 'continuous-b');
          const aWrite = await bridge(
            client,
            first.sessionId,
            'set_property',
            {
              nodePath: '.',
              property: 'rotation',
              value: 1.75,
            },
            'd06-rotation-write',
          );
          const aWriteReplay = await bridge(
            client,
            first.sessionId,
            'set_property',
            {
              nodePath: '.',
              property: 'rotation',
              value: 1.75,
            },
            'd06-rotation-write',
          );
          const operationStatus = await call(client, 'get_runtime_operation_status', {
            sessionId: first.sessionId,
            operationId: 'd06-rotation-write',
          });
          const aInput = await bridge(client, first.sessionId, 'inject_input', { keycode: 65, pressed: true });
          await bridge(client, first.sessionId, 'wait_physics_frames', { frames: 2 });
          const aRead = await bridge(client, first.sessionId, 'get_property', {
            nodePath: '.',
            property: 'rotation',
          });
          const aEvents = await bridge(client, first.sessionId, 'get_property', {
            nodePath: '.',
            property: 'key_events',
          });
          const bRead = await bridge(client, second.sessionId, 'get_property', {
            nodePath: '.',
            property: 'rotation',
          });
          const bEvents = await bridge(client, second.sessionId, 'get_property', {
            nodePath: '.',
            property: 'key_events',
          });
          const continuousShotPath = path.join(first.evidenceDir, 'continuous-shot.png');
          const aScreenshot = await bridge(client, first.sessionId, 'capture_screenshot', {
            path: continuousShotPath,
          });
          const continuousPng = await readFile(continuousShotPath).catch(() => Buffer.alloc(0));
          continuous = {
            correct:
              !aWrite.isError &&
              !aWriteReplay.isError &&
              !operationStatus.isError &&
              !aInput.isError &&
              !aRead.isError &&
              !aEvents.isError &&
              !bRead.isError &&
              !bEvents.isError &&
              !aScreenshot.isError &&
              aRead.data.value === 1.75 &&
              aWriteReplay.data.before === 0 &&
              operationStatus.data.status === 'COMPLETED' &&
              operationStatus.data.result?.after === 1.75 &&
              aEvents.data.value >= 1 &&
              bRead.data.value === 0 &&
              bEvents.data.value === 0 &&
              continuousPng.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
            actual: {
              sessionA: first.sessionId,
              sessionB: second.sessionId,
              write: aWrite.body,
              writeReplay: aWriteReplay.body,
              operationStatus: operationStatus.body,
              input: aInput.body,
              rotationA: aRead.body,
              inputEventsA: aEvents.body,
              rotationB: bRead.body,
              inputEventsB: bEvents.body,
              screenshot: aScreenshot.body,
              screenshotBytes: continuousPng.length,
            },
          };
        } finally {
          if (second) await stop(client, second.sessionId);
          await stop(client, first.sessionId);
        }
        return {
          verified:
            !write.isError &&
            !read.isError &&
            !input.isError &&
            screenshot.body.process !== undefined &&
            new Set([
              write.body.evidenceDir,
              read.body.evidenceDir,
              input.body.evidenceDir,
              screenshot.body.evidenceDir,
            ]).size === 4,
          correct: continuous?.correct === true && read.data.response?.value !== 1.75,
          actual: {
            legacy: { write: write.body, read: read.body, input: input.body, screenshot: screenshot.body },
            continuous: continuous?.actual,
          },
        };
      },
    );

    await record(
      'D07',
      { tool: 'write_scene_file', scenePath: 'bad.tscn', content: '[gd_scene ... unterminated node]' },
      async () => {
        const bad = '[gd_scene format=3]\n[node name="Broken" type="Node2D"\n';
        const write = await call(client, 'write_scene_file', { projectPath, scenePath: 'bad.tscn', content: bad });
        let validation;
        try {
          const result = await execFileAsync(
            godotPath,
            ['--headless', '--path', projectPath, '--script', path.join(projectPath, 'validate_scene.gd')],
            { cwd: projectPath, timeout: 15000 },
          );
          validation = { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
        } catch (error) {
          validation = { exitCode: error.code, stdout: error.stdout, stderr: error.stderr };
        }
        return {
          verified: validation.stdout?.includes('BASELINE_INVALID_SCENE') === true,
          correct:
            write.isError &&
            write.body.code === 'VALIDATION_FAILED' &&
            write.body.details?.result?.status === 'FAIL' &&
            !existsSync(path.join(projectPath, 'bad.tscn')),
          actual: { write: write.body, engineValidation: validation },
        };
      },
    );

    await record('D08', { tool: 'read_scene_file', scenePath: 'res://main.tscn' }, async () => {
      const relative = await call(client, 'read_scene_file', { projectPath, scenePath: 'main.tscn' });
      const virtual = await call(client, 'read_scene_file', { projectPath, scenePath: 'res://main.tscn' });
      return {
        verified:
          !relative.isError &&
          relative.data.content?.includes('[gd_scene') &&
          (virtual.isError || typeof virtual.data.content === 'string'),
        correct: !virtual.isError && virtual.data.content === relative.data.content,
        actual: { relative: relative.body, virtual: virtual.body },
      };
    });

    await record(
      'D09',
      { scenePath: 'res://three_d.tscn', nodePath: 'Camera', semanticScript: 'semantics.gd' },
      async () => {
        const second = await open(client, projectPath, 'three-d', { scenePath: 'res://three_d.tscn' });
        let specialized;
        try {
          specialized = await call(client, 'get_specialized_state', {
            sessionId: second.sessionId,
            nodePath: 'Camera',
          });
        } finally {
          await stop(client, second.sessionId);
        }
        const semantics = await call(client, 'analyze_script_semantics', { projectPath, scriptPath: 'semantics.gd' });
        const unsupported = specialized.isError && specialized.body.code === 'UNSUPPORTED';
        const qualified = semantics.data.stateMachine?.transitions?.some((item) => item.to === 'RUNNING');
        return {
          verified: !semantics.isError && (specialized.data.state !== undefined || specialized.isError),
          correct: unsupported && qualified,
          subchecks: [
            { id: 'D09-3D', ownerTask: 'T18', status: unsupported ? 'PASS' : 'EXPECTED_DEFECT' },
            { id: 'D09-SEMANTICS', ownerTask: 'T22', status: qualified ? 'PASS' : 'EXPECTED_DEFECT' },
          ],
          actual: {
            specialized: {
              isError: specialized.isError,
              code: specialized.body.code,
              camera: specialized.data.state?.camera,
              capability: specialized.data.capability,
            },
            semantics: {
              states: semantics.data.stateMachine?.states,
              transitions: semantics.data.stateMachine?.transitions,
            },
          },
        };
      },
    );

    await record(
      'D10',
      { transport: 'Streamable HTTP', scopes: ['read', 'run'], rawMethod: 'set_property' },
      async () => {
        const { createMcpServer } = await import('../../build/src/mcp-server-sdk.js');
        const { startStreamableHttpServer } = await import('../../build/src/transports/streamable-http.js');
        const port = await availablePort();
        const origin = `http://127.0.0.1:${port}`;
        const server = await startStreamableHttpServer(
          {
            host: '127.0.0.1',
            port,
            path: '/mcp',
            allowedOrigins: [origin],
            allowedHosts: [`127.0.0.1:${port}`],
            requestTimeoutMs: 20000,
            auditLog: path.join(runDir, 'http-audit.jsonl'),
            clients: [
              {
                token: 'local-baseline-token',
                clientId: 'run-only',
                scopes: ['read', 'run'],
                projectRoots: [projectPath, root],
                evidenceRoots: [runDir],
                approvedGodotPaths: [godotPath],
                approvedBridgePaths: [bridgePath],
              },
            ],
          },
          createMcpServer,
        );
        const httpTransport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
          requestInit: { headers: { Authorization: 'Bearer local-baseline-token', Origin: origin } },
        });
        const httpClient = new Client({ name: 'baseline-run-only', version: '1.0.0' });
        let httpSession = '';
        try {
          await httpClient.connect(httpTransport);
          const opened = await open(httpClient, projectPath, 'http-run-only');
          httpSession = opened.sessionId;
          const before = await bridge(httpClient, httpSession, 'get_property', { nodePath: '.', property: 'rotation' });
          const direct = await call(httpClient, 'set_runtime_property', {
            godotPath,
            projectPath,
            bridgePath,
            nodePath: '.',
            property: 'rotation',
            value: 2.5,
          });
          const mutation = await bridge(httpClient, httpSession, 'set_property', {
            nodePath: '.',
            property: 'rotation',
            value: 2.5,
          });
          const after = await bridge(httpClient, httpSession, 'get_property', { nodePath: '.', property: 'rotation' });
          return {
            verified:
              direct.isError &&
              direct.body.code === 'FORBIDDEN' &&
              !before.isError &&
              !after.isError &&
              (mutation.isError
                ? mutation.body.code === 'FORBIDDEN'
                : after.data.value !== before.data.value && after.data.value === 2.5),
            correct: mutation.isError && mutation.body.code === 'FORBIDDEN' && before.data.value === after.data.value,
            actual: {
              direct: direct.body,
              before: before.body,
              mutation: mutation.body,
              mutationIsError: mutation.isError,
              after: after.body,
            },
          };
        } finally {
          await stop(httpClient, httpSession);
          await httpClient.close().catch(() => undefined);
          await server.close();
        }
      },
    );

    const debug = await call(client, 'get_debug_output', { evidenceDir: base.evidenceDir });
    summary.controls.push({
      id: 'C02',
      title: 'Real persistent runtime diagnostic evidence is readable',
      status: !debug.isError && debug.data ? 'PASS' : 'FAIL',
      actual: debug.body,
    });
    console.log(`C02: ${summary.controls.at(-1).status}`);
  } finally {
    await stop(client, sessionId);
    await client.close().catch(() => undefined);
  }
  summary.errors = validateBaselineSummary(summary);
  const reportPath = path.join(runDir, 'summary.json');
  await writeFile(reportPath, JSON.stringify(summary, null, 2) + '\n');
  const evidence = [{ path: 'summary.json', sha256: digest(await readFile(reportPath)) }];
  for (const name of [
    'persistent/events.jsonl',
    'legacy-screenshot/shot.png',
    'http-run-only/events.jsonl',
    'http-audit.jsonl',
  ]) {
    const file = path.join(runDir, name);
    if (existsSync(file)) evidence.push({ path: name, sha256: digest(await readFile(file)) });
  }
  const manifest = {
    schemaVersion: 1,
    caseId: 'T01-D01-D10',
    taskId: 'T01',
    gateId: 'G0',
    source: sourceIdentity,
    environment: {
      node: process.version,
      os: `${os.platform()} ${os.release()} ${os.arch()}`,
      godot: summary.godotVersion,
      renderer: summary.controls.some((item) => item.id === 'C03' && item.status === 'PASS')
        ? 'real Vulkan PNG'
        : 'NOT_RUN',
      project: projectPath,
    },
    commands: [
      {
        name: 'official-sdk-stdio-godot-and-http-defect-baseline',
        argv: [process.execPath, 'tests/production-baseline/run.mjs'],
        required: true,
        status: summary.errors.length ? 'FAIL' : 'PASS',
        exitCode: summary.errors.length ? 1 : 0,
        signal: null,
        durationMs: Date.now() - startedAt,
        outputHash: evidence[0].sha256,
      },
    ],
    inputSnapshotHash: summary.fixtureHash,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    testDouble: 'MIXED',
    evidence,
  };
  const manifestErrors = source.validateRunManifest(manifest);
  await writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  summary.errors.push(...manifestErrors.map((item) => `manifest: ${item}`));
  if (process.env.WHEEL_BASELINE_SUMMARY_PATH)
    await writeFile(process.env.WHEEL_BASELINE_SUMMARY_PATH, JSON.stringify(summary, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        status: summary.errors.length ? 'FAIL' : 'PASS',
        report: path.relative(root, reportPath),
        counts: Object.fromEntries(
          ['PASS', 'EXPECTED_DEFECT', 'INVALID_REPRO'].map((status) => [
            status,
            summary.cases.filter((item) => item.status === status).length,
          ]),
        ),
        errors: summary.errors,
      },
      null,
      2,
    ),
  );
  if (summary.errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

#!/usr/bin/env node
import readline from 'node:readline';
import { getGodotVersion, getProcessStatus, getProjectInfo, getSceneTree, launchProject, listProjects, readEvidence, resolveGodotPath, stopProcess } from './godot-runtime.mjs';
import { createEvidenceEnvelope } from './evidence.mjs';
import { gitCheckpoint, gitRecovery } from './git-recovery.mjs';
import { classifyError } from './error-schema.mjs';

const launches = new Map();
const tools = [
  {
    name: 'git_checkpoint',
    description: 'Capture Git HEAD, status, and a binary diff into an evidence directory.',
    inputSchema: { type: 'object', required: ['projectPath'], properties: { projectPath: { type: 'string' }, evidenceDir: { type: 'string' } } }
  },
  {
    name: 'git_recovery',
    description: 'Apply the reverse of an explicitly provided Git diff patch.',
    inputSchema: { type: 'object', required: ['projectPath', 'patchPath'], properties: { projectPath: { type: 'string' }, patchPath: { type: 'string' } } }
  },
  {
    name: 'list_projects',
    description: 'Find Godot projects below a bounded directory.',
    inputSchema: { type: 'object', required: ['directory'], properties: { directory: { type: 'string' }, recursive: { type: 'boolean' } } }
  },
  {
    name: 'get_project_info',
    description: 'Read project.godot metadata and a relative project file list.',
    inputSchema: { type: 'object', required: ['projectPath'], properties: { projectPath: { type: 'string' } } }
  },
  {
    name: 'get_scene_tree',
    description: 'Read nodes from a real Godot .tscn file (static editor-plane capability; not runtime state).',
    inputSchema: { type: 'object', required: ['projectPath'], properties: { projectPath: { type: 'string' }, scenePath: { type: 'string' } } }
  },
  {
    name: 'get_godot_version',
    description: 'Read the version from the configured Godot executable.',
    inputSchema: { type: 'object', properties: { godotPath: { type: 'string' } } }
  },
  {
    name: 'launch_project',
    description: 'Launch a Godot project and return process/evidence metadata.',
    inputSchema: { type: 'object', required: ['projectPath'], properties: { godotPath: { type: 'string' }, projectPath: { type: 'string' }, evidenceDir: { type: 'string' }, headless: { type: 'boolean' }, extraArgs: { type: 'array', items: { type: 'string' } } } }
  },
  {
    name: 'get_debug_output',
    description: 'Read captured stdout/stderr and process metadata from an evidence directory.',
    inputSchema: { type: 'object', required: ['evidenceDir'], properties: { evidenceDir: { type: 'string' } } }
  },
  {
    name: 'stop_project',
    description: 'Stop a running process by PID and report its state.',
    inputSchema: { type: 'object', required: ['pid'], properties: { pid: { type: 'integer' }, timeoutMs: { type: 'integer', minimum: 0, default: 5000 } } }
  }
  ,{
    name: 'get_process_status',
    description: 'Report whether an OS process is currently running without stopping it.',
    inputSchema: { type: 'object', required: ['pid'], properties: { pid: { type: 'integer' } } }
  }
];

const serverInfo = { name: 'godot-game-harness-mcp', version: '0.1.0' };
const evidence = await createEvidenceEnvelope(process.env.MCP_EVIDENCE_DIR, { server: serverInfo });
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async line => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch { return writeError(null, -32700, 'Parse error'); }
  await evidence?.request(request);
  if (request.method === 'notifications/initialized') return;
  if (request.method === 'initialize') return writeResult(request.id, {
    protocolVersion: request.params?.protocolVersion || '2024-11-05', serverInfo,
    capabilities: { tools: {} }
  });
  if (request.method === 'tools/list') return writeResult(request.id, { tools });
  if (request.method === 'tools/call') return handleTool(request);
  if (request.id !== undefined) writeError(request.id, -32601, `Method not found: ${request.method}`);
});

async function handleTool(request) {
  try {
    const args = request.params?.arguments || {};
    let value;
    switch (request.params?.name) {
      case 'git_checkpoint': value = await gitCheckpoint(args.projectPath, args.evidenceDir); break;
      case 'git_recovery': value = await gitRecovery(args.projectPath, args.patchPath); break;
      case 'list_projects': value = await listProjects(args.directory, args.recursive === true); break;
      case 'get_project_info': value = await getProjectInfo(args.projectPath); break;
      case 'get_scene_tree': value = await getSceneTree(args.projectPath, args.scenePath); break;
      case 'get_godot_version': value = { version: await getGodotVersion(resolveGodotPath(args.godotPath)) }; break;
      case 'launch_project': {
        const launch = await launchProject({ ...args, godotPath: args.godotPath || process.env.GODOT_PATH });
        launches.set(launch.metadata.pid, launch);
        value = launch.metadata;
        break;
      }
      case 'get_debug_output': value = await readEvidence(args.evidenceDir); break;
      case 'stop_project': value = await stopProcess(args.pid, args.timeoutMs ?? 5000); break;
      case 'get_process_status': value = getProcessStatus(args.pid); break;
      default: return writeError(request.id, -32602, `Unknown tool: ${request.params?.name}`);
    }
    writeResult(request.id, { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
  } catch (error) {
    writeResult(request.id, { isError: true, content: [{ type: 'text', text: JSON.stringify(classifyError(error)) }], structuredContent: classifyError(error) });
  }
}

function writeResult(id, result) { const response = { jsonrpc: '2.0', id, result }; process.stdout.write(`${JSON.stringify(response)}\n`); evidence?.response(response); }
function writeError(id, code, message) { const response = { jsonrpc: '2.0', id, error: { code, message } }; process.stdout.write(`${JSON.stringify(response)}\n`); evidence?.response(response); }

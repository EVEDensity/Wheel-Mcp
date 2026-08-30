#!/usr/bin/env node
import readline from 'node:readline';
import { getGodotVersion, getProjectInfo, launchProject, listProjects, readEvidence, resolveGodotPath, stopProcess } from './godot-runtime.mjs';

const launches = new Map();
const tools = [
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
    inputSchema: { type: 'object', required: ['pid'], properties: { pid: { type: 'integer' } } }
  }
];

const serverInfo = { name: 'godot-game-harness-mcp', version: '0.1.0' };
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async line => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch { return writeError(null, -32700, 'Parse error'); }
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
      case 'list_projects': value = await listProjects(args.directory, args.recursive === true); break;
      case 'get_project_info': value = await getProjectInfo(args.projectPath); break;
      case 'get_godot_version': value = { version: await getGodotVersion(resolveGodotPath(args.godotPath)) }; break;
      case 'launch_project': {
        const launch = await launchProject({ ...args, godotPath: args.godotPath || process.env.GODOT_PATH });
        launches.set(launch.metadata.pid, launch);
        value = launch.metadata;
        break;
      }
      case 'get_debug_output': value = await readEvidence(args.evidenceDir); break;
      case 'stop_project': value = await stopProcess(args.pid); break;
      default: return writeError(request.id, -32602, `Unknown tool: ${request.params?.name}`);
    }
    writeResult(request.id, { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
  } catch (error) {
    writeResult(request.id, { isError: true, content: [{ type: 'text', text: JSON.stringify({ source: 'REAL', status: 'FAIL', error: error.message }) }] });
  }
}

function writeResult(id, result) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`); }
function writeError(id, code, message) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`); }

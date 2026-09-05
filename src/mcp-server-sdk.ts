#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { captureRuntimeScreenshot, getGodotVersion, getProcessStatus, getProjectInfo, getSceneTree, injectRuntimeInput, launchProject, listProjects, mutateRuntimeProperty, queryRuntimeProperty, queryRuntimeSceneTree, readEvidence, resolveGodotPath, stopProcess, cancelProcess } from './godot-runtime.js';
import { buildContextPack } from './context-pack.js';
import { gitCheckpoint, gitRecovery } from './git-recovery.js';

const info = { name: 'godot-game-harness-mcp', version: '0.1.0' };
const server = new McpServer(info, { capabilities: { tools: {} } });
const projectPath = z.string();
const godotPath = z.string().optional();
const bridgePath = z.string();
const evidenceDir = z.string().optional();
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

server.tool('get_godot_version', 'Read the configured Godot version.', { godotPath }, async ({ godotPath }) => result({ version: await getGodotVersion(resolveGodotPath(godotPath)) }));
server.tool('list_projects', 'Find Godot projects below a directory.', { directory: z.string(), recursive: z.boolean().optional() }, async ({ directory, recursive }) => result(await listProjects(directory, recursive === true)));
server.tool('get_project_info', 'Read project metadata and files.', { projectPath }, async ({ projectPath }) => result(await getProjectInfo(projectPath)));
server.tool('get_scene_tree', 'Read a static Godot scene tree.', { projectPath, scenePath: z.string().optional() }, async ({ projectPath, scenePath }) => result(await getSceneTree(projectPath, scenePath)));
server.tool('launch_project', 'Launch a Godot project.', { godotPath, projectPath, evidenceDir, headless: z.boolean().optional(), extraArgs: z.array(z.string()).optional() }, async args => result((await launchProject({ ...args, projectPath: args.projectPath as string, godotPath: args.godotPath || process.env.GODOT_PATH } as any)).metadata));
server.tool('get_debug_output', 'Read process evidence.', { evidenceDir: z.string() }, async ({ evidenceDir }) => result(await readEvidence(evidenceDir)));
server.tool('stop_project', 'Stop a process.', { pid: z.number().int(), timeoutMs: z.number().int().nonnegative().optional() }, async ({ pid, timeoutMs }) => result(await stopProcess(pid, timeoutMs ?? 5000)));
server.tool('cancel_project', 'Cancel a process.', { pid: z.number().int(), timeoutMs: z.number().int().nonnegative().optional() }, async ({ pid, timeoutMs }) => result(await cancelProcess(pid, timeoutMs ?? 5000)));
server.tool('get_process_status', 'Inspect process state.', { pid: z.number().int() }, async ({ pid }) => result(getProcessStatus(pid)));
server.tool('get_runtime_scene_tree', 'Query runtime scene tree.', { godotPath, projectPath, bridgePath, evidenceDir }, async args => result(await queryRuntimeSceneTree({ ...args, projectPath: args.projectPath as string, bridgePath: args.bridgePath as string, godotPath: args.godotPath || process.env.GODOT_PATH } as any)));
server.tool('get_runtime_property', 'Read a runtime property.', { godotPath, projectPath, bridgePath, evidenceDir, nodePath: z.string().optional(), property: z.string() }, async args => result(await queryRuntimeProperty({ ...args, projectPath: args.projectPath as string, bridgePath: args.bridgePath as string, property: args.property as string, godotPath: args.godotPath || process.env.GODOT_PATH } as any)));
server.tool('set_runtime_property', 'Write and read back a runtime property.', { godotPath, projectPath, bridgePath, evidenceDir, nodePath: z.string().optional(), property: z.string(), value: z.unknown() }, async args => result(await mutateRuntimeProperty({ ...args, projectPath: args.projectPath as string, bridgePath: args.bridgePath as string, property: args.property as string, value: args.value, godotPath: args.godotPath || process.env.GODOT_PATH } as any)));
server.tool('inject_runtime_input', 'Inject a runtime key event.', { godotPath, projectPath, bridgePath, evidenceDir, keycode: z.number().int(), pressed: z.boolean().optional() }, async args => result(await injectRuntimeInput({ ...args, projectPath: args.projectPath as string, bridgePath: args.bridgePath as string, keycode: args.keycode as number, godotPath: args.godotPath || process.env.GODOT_PATH } as any)));
server.tool('capture_runtime_screenshot', 'Capture a runtime PNG.', { godotPath, projectPath, bridgePath, evidenceDir, screenshotPath: z.string().optional() }, async args => result(await captureRuntimeScreenshot({ ...args, projectPath: args.projectPath as string, bridgePath: args.bridgePath as string, godotPath: args.godotPath || process.env.GODOT_PATH } as any)));
server.tool('get_context_pack', 'Build a read-only context pack.', { godotPath, projectPath, evidenceDir, scenePath: z.string().optional() }, async args => result(await buildContextPack({ ...args, projectPath: args.projectPath as string, godotPath: args.godotPath || process.env.GODOT_PATH } as any)));
server.tool('git_checkpoint', 'Capture Git checkpoint evidence.', { projectPath, evidenceDir }, async ({ projectPath, evidenceDir }) => result(await gitCheckpoint(projectPath, evidenceDir)));
server.tool('git_recovery', 'Reverse an explicit patch.', { projectPath, patchPath: z.string() }, async ({ projectPath, patchPath }) => result(await gitRecovery(projectPath, patchPath)));

await server.connect(new StdioServerTransport());

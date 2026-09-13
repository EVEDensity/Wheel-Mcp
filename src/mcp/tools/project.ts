import { z } from 'zod';
import { getGodotVersion, getProjectInfo, getSceneTree, listProjects, resolveGodotPath } from '../../godot-runtime.js';
import { buildContextPack } from '../../context-pack.js';
import { gitCheckpoint, gitRecovery } from '../../git-recovery.js';
import {
  readSceneFile,
  writeSceneFile,
  readProjectFile,
  writeProjectFile,
  searchProject,
  analyzeCollisions,
  getNodeSemantics,
} from '../../godot-development.js';
import type { ToolRegistrationContext } from '../tool-context.js';
export function registerProjectTools(context: ToolRegistrationContext): void {
  const { server, invoke, schemas } = context;
  const { projectPath, godotPath, evidenceDir, timeoutMs, responseMode } = schemas;
  server.tool(
    'get_godot_version',
    'Read the configured Godot version.',
    { godotPath, timeoutMs },
    async ({ godotPath, timeoutMs }, extra) =>
      invoke(
        async (context) => ({ version: await getGodotVersion(resolveGodotPath(godotPath), context) }),
        timeoutMs,
        extra.signal,
      ),
  );

  server.tool(
    'list_projects',
    'Find Godot projects below a directory.',
    { directory: z.string(), recursive: z.boolean().optional(), timeoutMs },
    async ({ directory, recursive, timeoutMs }, extra) =>
      invoke((context) => listProjects(directory, recursive === true, context), timeoutMs, extra.signal),
  );

  server.tool(
    'get_project_info',
    'Read project metadata and files.',
    { projectPath, timeoutMs },
    async ({ projectPath, timeoutMs }, extra) =>
      invoke((context) => getProjectInfo(projectPath, context), timeoutMs, extra.signal),
  );

  server.tool(
    'get_scene_tree',
    'Read a static Godot scene tree.',
    { projectPath, scenePath: z.string().optional(), timeoutMs },
    async ({ projectPath, scenePath, timeoutMs }, extra) =>
      invoke((context) => getSceneTree(projectPath, scenePath ?? null, context), timeoutMs, extra.signal),
  );

  server.tool(
    'read_project_file',
    'Read a text file inside a Godot project.',
    { projectPath, filePath: z.string(), timeoutMs },
    async ({ projectPath, filePath, timeoutMs }, extra) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return readProjectFile(projectPath, filePath);
        },
        timeoutMs,
        extra.signal,
      ),
  );

  server.tool(
    'write_project_file',
    'Write a text file inside a Godot project.',
    { projectPath, filePath: z.string(), content: z.string(), timeoutMs },
    async ({ projectPath, filePath, content, timeoutMs }, extra) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return writeProjectFile(projectPath, filePath, content);
        },
        timeoutMs,
        extra.signal,
      ),
  );

  server.tool(
    'search_project',
    'Search project text files and return compact matching lines.',
    {
      projectPath,
      query: z.string().min(1),
      glob: z.string().optional(),
      maxResults: z.number().int().positive().max(1000).optional(),
      timeoutMs,
    },
    async ({ projectPath, query, glob, maxResults, timeoutMs }, extra) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return searchProject(projectPath, query, { glob, maxResults });
        },
        timeoutMs,
        extra.signal,
      ),
  );

  server.tool(
    'read_scene_file',
    'Read a Godot .tscn scene file.',
    { projectPath, scenePath: z.string(), timeoutMs },
    async ({ projectPath, scenePath, timeoutMs }, extra) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return readSceneFile(projectPath, scenePath);
        },
        timeoutMs,
        extra.signal,
      ),
  );

  server.tool(
    'write_scene_file',
    'Save a Godot .tscn scene file after explicit content edits.',
    { projectPath, scenePath: z.string(), content: z.string(), timeoutMs },
    async ({ projectPath, scenePath, content, timeoutMs }, extra) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return writeSceneFile(projectPath, scenePath, content);
        },
        timeoutMs,
        extra.signal,
      ),
  );

  server.tool(
    'get_context_pack',
    'Build a read-only context pack.',
    { godotPath, projectPath, evidenceDir, scenePath: z.string().optional(), timeoutMs },
    async (args, extra) =>
      invoke(
        (context) =>
          buildContextPack({
            ...args,
            timeout: context,
            projectPath: args.projectPath,
            godotPath: args.godotPath || process.env.GODOT_PATH,
          }),
        args.timeoutMs,
        extra.signal,
      ),
  );

  server.tool(
    'git_checkpoint',
    'Capture Git checkpoint evidence.',
    { projectPath, evidenceDir, timeoutMs },
    async ({ projectPath, evidenceDir, timeoutMs }, extra) =>
      invoke(
        async (context) => {
          context.throwIfCancelled();
          return gitCheckpoint(projectPath, evidenceDir, context);
        },
        timeoutMs,
        extra.signal,
      ),
  );

  server.tool(
    'git_recovery',
    'Reverse an explicit patch.',
    { projectPath, patchPath: z.string(), timeoutMs },
    async ({ projectPath, patchPath, timeoutMs }, extra) =>
      invoke(
        async (context) => {
          context.throwIfCancelled();
          return gitRecovery(projectPath, patchPath, context);
        },
        timeoutMs,
        extra.signal,
      ),
  );

  server.tool(
    'analyze_collisions',
    'Analyze static collision layers, masks and shapes in a Godot project.',
    {
      projectPath: projectPath,
      scenePath: z.string().optional(),
      responseMode: responseMode,
      timeoutMs: timeoutMs,
    },
    async (a: any, e: any) =>
      invoke(() => analyzeCollisions(a.projectPath, a.scenePath), a.timeoutMs, e.signal, a.responseMode),
  );

  server.tool(
    'get_node_semantics',
    'Read semantic labels and recognized components from a Godot scene.',
    {
      projectPath: projectPath,
      scenePath: z.string().optional(),
      responseMode: responseMode,
      timeoutMs: timeoutMs,
    },
    async (a: any, e: any) =>
      invoke(() => getNodeSemantics(a.projectPath, a.scenePath), a.timeoutMs, e.signal, a.responseMode),
  );
}

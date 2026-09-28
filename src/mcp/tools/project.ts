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
import { readEditorState } from '../../editor/editor-bridge.js';
import { saveEditorScene } from '../../editor/scene-save.js';
import { writeValidatedProjectFiles } from '../../project/validated-write.js';
import { moveProjectScene } from '../../project/scene-move.js';
import { importProjectPng } from '../../project/asset-import.js';
import {
  manageEditorResource,
  resourceRequestSchema,
  resourceRefSchema,
  saveEditorResource,
} from '../../editor/resource-service.js';
import {
  applyEditorScene,
  getEditorSceneOperation,
  createSceneApproval,
  sceneOperationsSchema,
} from '../../editor/scene-service.js';
export function registerProjectTools(context: ToolRegistrationContext): void {
  const { server, invoke, schemas, approveProjectTransaction, transactionOwnerId } = context;
  const { projectPath, godotPath, evidenceDir, timeoutMs, responseMode, sceneTreeQuery } = schemas;
  server.tool(
    'import_project_png',
    'Import a bounded PNG source texture. Strict base64, project-local path, exact SHA-256 precondition, host approval, native isolated Godot import/load before disk commit. Other importers are unsupported.',
    {
      projectPath,
      godotPath,
      path: z.string().min(1).max(512),
      dataBase64: z.string().min(1).max(2_796_208),
      expectedSha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable(),
      operationId: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,80}$/)
        .optional(),
      timeoutMs,
      responseMode,
    },
    async (args, extra) =>
      invoke(
        (request) =>
          importProjectPng(args.projectPath, args.path, args.dataBase64, args.expectedSha256, {
            ...args,
            ownerId: transactionOwnerId,
            verifyApproval: approveProjectTransaction,
            timeoutMs: Math.min(120000, request.remaining()),
            signal: request.signal,
          }),
        args.timeoutMs,
        extra.signal,
        args.responseMode,
      ),
  );
  server.tool(
    'move_project_scene',
    'Move a .tscn with exact approved reference-impact transaction. Supports PackedScene ext_resource/main_scene references only; dynamic/UID-only/ambiguous references conflict. Editor must be closed. Validate isolated candidate with old source removed before commit, preserve UID, reopen explicitly.',
    {
      projectPath,
      godotPath,
      from: z.string().min(1).max(512),
      to: z.string().min(1).max(512),
      operationId: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,80}$/)
        .optional(),
      timeoutMs,
      responseMode,
    },
    async (args, extra) =>
      invoke(
        (request) =>
          moveProjectScene(args.projectPath, args.from, args.to, {
            ...args,
            ownerId: transactionOwnerId,
            verifyApproval: approveProjectTransaction,
            timeoutMs: Math.min(120000, request.remaining()),
            signal: request.signal,
          }),
        args.timeoutMs,
        extra.signal,
        args.responseMode,
      ),
  );
  server.tool(
    'save_editor_scene',
    'Export actual owned live editor document through native PackedScene/ResourceSaver, request exact approval, validate isolated project before disk commit. Retains dirty marker/history; awaits observable filesystem completion; committed disk state never misreported as rollback.',
    {
      projectPath,
      godotPath,
      operationId: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,80}$/)
        .optional(),
      timeoutMs,
      responseMode,
    },
    async (args, extra) =>
      invoke(
        (request) =>
          saveEditorScene({
            ...args,
            ownerId: transactionOwnerId,
            verifyApproval: approveProjectTransaction,
            timeoutMs: Math.min(120000, request.remaining()),
            signal: request.signal,
          }),
        args.timeoutMs,
        extra.signal,
        args.responseMode,
      ),
  );
  server.tool(
    'write_validated_project_files',
    'Exact host-approved multi-file .tscn/.tres/.gd candidates. Stage/import/load in isolated correct project context BEFORE touching originals; dirty scene and dependency CAS conflicts reject; transactional recovery.',
    {
      projectPath,
      godotPath,
      files: z
        .array(
          z
            .object({
              path: z.string().min(1).max(512),
              content: z.string().max(8 * 1024 * 1024),
              expectedSha256: z
                .string()
                .regex(/^[a-f0-9]{64}$/)
                .nullable(),
            })
            .strict(),
        )
        .min(1)
        .max(16),
      operationId: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,80}$/)
        .optional(),
      timeoutMs,
      responseMode,
    },
    async (args, extra) =>
      invoke(
        (request) =>
          writeValidatedProjectFiles(args.projectPath, args.files, {
            ...args,
            ownerId: transactionOwnerId,
            verifyApproval: approveProjectTransaction,
            timeoutMs: Math.min(120000, request.remaining()),
            signal: request.signal,
          }),
        args.timeoutMs,
        extra.signal,
        args.responseMode,
      ),
  );
  server.tool(
    'manage_editor_resource',
    'Create/reference/read/duplicate/release a bounded editor resource handle. Session/project/owner scoped; does not edit documents. export/adopt only native exact bytes; node assignments require apply_editor_scene approval.',
    { projectPath, request: resourceRequestSchema, timeoutMs, responseMode },
    async (args, extra) =>
      invoke(
        (request) =>
          manageEditorResource({
            ...args,
            ownerId: transactionOwnerId,
            timeoutMs: Math.min(120000, request.remaining()),
            signal: request.signal,
          }),
        args.timeoutMs,
        extra.signal,
        args.responseMode,
      ),
  );
  server.tool(
    'save_editor_resource',
    'Stage through native ResourceSaver, request exact host approval, then transactionally save .tres. Returns fresh external reference if adoption succeeds; never pretends a committed write rolled back.',
    {
      projectPath,
      ref: resourceRefSchema,
      filePath: z.string(),
      operationId: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,80}$/)
        .optional(),
      expectedSha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable()
        .optional(),
      timeoutMs,
      responseMode,
    },
    async (args, extra) =>
      invoke(
        (request) =>
          saveEditorResource({
            ...args,
            ownerId: transactionOwnerId,
            verifyApproval: approveProjectTransaction,
            timeoutMs: Math.min(120000, request.remaining()),
            signal: request.signal,
          }),
        args.timeoutMs,
        extra.signal,
        args.responseMode,
      ),
  );
  server.tool(
    'apply_editor_scene',
    'Preview and request human approval of an exact unsaved native editor batch. Independent write opt-in; one Undo action; never saves files. Query status after UNKNOWN, never blindly retry.',
    {
      projectPath,
      operations: sceneOperationsSchema,
      operationId: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,80}$/)
        .optional(),
      timeoutMs,
      responseMode,
    },
    async (args, extra) =>
      invoke(
        (request) =>
          applyEditorScene({
            ...args,
            ownerId: transactionOwnerId,
            approve: createSceneApproval(server, transactionOwnerId),
            timeoutMs: Math.min(120000, request.remaining()),
            signal: request.signal,
          }),
        args.timeoutMs,
        extra.signal,
        args.responseMode,
      ),
  );
  server.tool(
    'get_editor_scene_operation',
    "Query this owner's native editor commit result for an exact editor session. An unavailable or restarted editor returns UNKNOWN, not a fabricated rollback.",
    {
      projectPath,
      operationId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
      sessionId: z.string().regex(/^[a-f0-9]{32}$/),
      timeoutMs,
      responseMode,
    },
    async (args, extra) =>
      invoke(
        (request) =>
          getEditorSceneOperation({
            ...args,
            ownerId: transactionOwnerId,
            timeoutMs: Math.min(120000, request.remaining()),
            signal: request.signal,
          }),
        args.timeoutMs,
        extra.signal,
        args.responseMode,
      ),
  );
  server.tool(
    'get_editor_state',
    'Read the already-enabled authenticated editor plane: scene, dirty documents, selection and filesystem. Never installs a plugin or launches a runtime substitute.',
    { projectPath, limit: z.number().int().min(1).max(100).optional(), timeoutMs, responseMode },
    async ({ projectPath, limit, timeoutMs, responseMode }, extra) =>
      invoke(
        (request) =>
          readEditorState(projectPath, context.policy?.clientId ?? 'local-client', {
            limit,
            timeoutMs: Math.min(120000, request.remaining()),
            signal: request.signal,
          }),
        timeoutMs,
        extra.signal,
        responseMode,
      ),
  );
  const writePreconditions = {
    validationMode: z.enum(['engine', 'raw']).optional(),
    godotPath,
    operationId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,80}$/)
      .optional(),
    expectedSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .optional(),
  };
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
    { projectPath, scenePath: z.string().optional(), ...sceneTreeQuery, timeoutMs },
    async ({ projectPath, scenePath, subtree, depth, fields, limit, cursor, timeoutMs }, extra) =>
      invoke(
        (context) => getSceneTree(projectPath, scenePath ?? null, context, { subtree, depth, fields, limit, cursor }),
        timeoutMs,
        extra.signal,
      ),
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
    'Exact approved .tscn/.tres/.gd candidate validated in isolated correct-res:// project before replacing originals. Explicit raw mode is NOT_RUN with risk approval. Dirty editor scenes conflict.',
    { projectPath, filePath: z.string(), content: z.string(), ...writePreconditions, timeoutMs },
    async (
      { projectPath, filePath, content, operationId, expectedSha256, timeoutMs, validationMode, godotPath },
      extra,
    ) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return writeProjectFile(projectPath, filePath, content, {
            validationMode,
            godotPath,
            timeoutMs: context.remaining(),
            ownerId: transactionOwnerId,
            operationId,
            expectedSha256,
            verifyApproval: approveProjectTransaction,
            signal: context.signal,
          });
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
    'Exact host-approved .tscn candidate, engine import/load in isolated project before originals are touched. Explicit raw mode is NOT_RUN; cannot overwrite an unsaved editor scene.',
    { projectPath, scenePath: z.string(), content: z.string(), ...writePreconditions, timeoutMs },
    async (
      { projectPath, scenePath, content, operationId, expectedSha256, timeoutMs, validationMode, godotPath },
      extra,
    ) =>
      invoke(
        (context) => {
          context.throwIfCancelled();
          return writeSceneFile(projectPath, scenePath, content, {
            validationMode,
            godotPath,
            timeoutMs: context.remaining(),
            ownerId: transactionOwnerId,
            operationId,
            expectedSha256,
            verifyApproval: approveProjectTransaction,
            signal: context.signal,
          });
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
    'Preview a bounded regular-text reverse patch, request host approval, then apply it transactionally. Binary/link/mode/rename patches are unsupported; engine validation is NOT_RUN.',
    { projectPath, patchPath: z.string(), timeoutMs },
    async ({ projectPath, patchPath, timeoutMs }, extra) =>
      invoke(
        async (context) => {
          context.throwIfCancelled();
          return gitRecovery(projectPath, patchPath, context, approveProjectTransaction, transactionOwnerId);
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

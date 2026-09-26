import path from 'node:path';
import { realpathSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getEventSubscriptionOwner } from '../runtime-events.js';
import { projectRelativePath, resolveProjectPath } from '../project/paths.js';

export type McpPermission = 'read' | 'run' | 'write' | 'admin';

export type McpClientPolicy = {
  clientId: string;
  scopes: ReadonlySet<McpPermission>;
  projectRoots: readonly string[];
  evidenceRoots: readonly string[];
  approvedGodotPaths: readonly string[];
  approvedBridgePaths: readonly string[];
  approvedBridgeHashes: readonly string[];
  ownedPids: Set<number>;
  ownedRunIds: Set<string>;
  ownedBridgeSessions: Set<string>;
  bridgeEvidenceDirs: Map<string, string>;
  ownedSubscriptions: Set<string>;
};

export class McpAccessError extends Error {
  readonly code = 'FORBIDDEN';

  constructor(message: string) {
    super(message);
    this.name = 'McpAccessError';
  }
}

export const toolPermissions: Readonly<Record<string, McpPermission>> = {
  get_godot_version: 'read',
  list_projects: 'read',
  get_project_info: 'read',
  get_editor_state: 'read',
  apply_editor_scene: 'write',
  manage_editor_resource: 'write',
  save_editor_resource: 'write',
  save_editor_scene: 'write',
  write_validated_project_files: 'write',
  get_editor_scene_operation: 'read',
  read_project_file: 'read',
  write_project_file: 'write',
  search_project: 'read',
  read_scene_file: 'read',
  write_scene_file: 'write',
  get_scene_tree: 'read',
  analyze_collisions: 'read',
  get_node_semantics: 'read',
  get_debug_output: 'read',
  analyze_script_semantics: 'read',
  get_response_page: 'read',
  get_recent_evidence: 'read',
  compare_screenshots: 'write',
  get_process_status: 'read',
  get_runtime_events: 'read',
  subscribe_runtime_events: 'read',
  poll_event_subscription: 'read',
  list_event_subscriptions: 'read',
  list_active_runs: 'read',
  list_runs: 'read',
  get_runtime_scene_tree: 'read',
  get_runtime_property: 'read',
  capture_runtime_screenshot: 'run',
  get_context_pack: 'read',
  launch_project: 'run',
  stop_project: 'run',
  cancel_project: 'run',
  create_event_subscription: 'run',
  cancel_event_subscription: 'run',
  ack_event_subscription: 'run',
  pause_event_subscription: 'run',
  close_event_subscription: 'run',
  stop_run: 'run',
  cancel_run: 'run',
  open_runtime_bridge: 'run',
  call_runtime_bridge: 'read',
  get_runtime_operation_status: 'read',
  stop_runtime_bridge: 'run',
  get_game_state: 'read',
  get_specialized_state: 'read',
  query_runtime_collisions: 'read',
  set_runtime_property: 'write',
  create_runtime_node: 'write',
  delete_runtime_node: 'write',
  call_runtime_method: 'write',
  inject_runtime_input: 'write',
  reload_scene: 'write',
  execute_scenario: 'write',
  wait_for_event: 'run',
  dev_loop: 'write',
  begin_client_repair: 'write',
  submit_repair_candidate: 'write',
  run_test_scene: 'write',
  git_checkpoint: 'write',
  git_recovery: 'admin',
  reclaim_orphan_runs: 'admin',
};

const readBridgeMethods = new Set([
  'get_scene_tree',
  'get_property',
  'get_game_state',
  'get_specialized_state',
  'query_collisions',
]);
const runBridgeMethods = new Set(['subscribe_events', 'stop']);
const writeBridgeMethods = new Set([
  'set_property',
  'create_node',
  'delete_node',
  'call_method',
  'reload_scene',
  'inject_input',
  'capture_screenshot',
  'wait_physics_frames',
]);

const projectPathKeys = new Set(['projectPath', 'directory', 'scenarioPath', 'patchPath']);
const godotExecutingTools = new Set([
  'get_godot_version',
  'get_context_pack',
  'launch_project',
  'get_runtime_scene_tree',
  'get_runtime_property',
  'set_runtime_property',
  'inject_runtime_input',
  'capture_runtime_screenshot',
  'open_runtime_bridge',
  'run_test_scene',
  'execute_scenario',
  'dev_loop',
  'begin_client_repair',
]);
const evidencePathKeys = new Set([
  'evidenceDir',
  'baselinePath',
  'screenshotPath',
  'firstPath',
  'secondPath',
  'diffPath',
]);

export function createClientPolicy(input: {
  clientId: string;
  scopes: Iterable<McpPermission>;
  projectRoots: readonly string[];
  evidenceRoots: readonly string[];
  approvedGodotPaths?: readonly string[];
  approvedBridgePaths?: readonly string[];
  approvedBridgeHashes?: readonly string[];
}): McpClientPolicy {
  return {
    clientId: input.clientId,
    scopes: new Set(input.scopes),
    projectRoots: input.projectRoots.map((root) => path.resolve(root)),
    evidenceRoots: input.evidenceRoots.map((root) => path.resolve(root)),
    approvedGodotPaths: (input.approvedGodotPaths ?? []).map((candidate) => path.resolve(candidate)),
    approvedBridgePaths: (input.approvedBridgePaths ?? []).map((candidate) => path.resolve(candidate)),
    approvedBridgeHashes: input.approvedBridgeHashes ?? [],
    ownedPids: new Set(),
    ownedRunIds: new Set(),
    ownedBridgeSessions: new Set(),
    bridgeEvidenceDirs: new Map(),
    ownedSubscriptions: new Set(),
  };
}

export async function authorizeToolCall(
  policy: McpClientPolicy,
  toolName: string,
  args: Record<string, unknown>,
): Promise<void> {
  const required = toolPermissions[toolName];
  if (!required) throw new McpAccessError(`tool ${toolName} has no explicit permission classification`);
  if (!policy.scopes.has(required) && !policy.scopes.has('admin')) {
    throw new McpAccessError(`client ${policy.clientId} lacks ${required} permission for ${toolName}`);
  }
  if (['get_runtime_scene_tree', 'get_runtime_property'].includes(toolName)) requireScope(policy, 'run', toolName);
  if (toolName === 'subscribe_runtime_events' && args.continuous === true) requireScope(policy, 'run', toolName);
  if (toolName === 'call_runtime_bridge') {
    const method = args.method;
    if (typeof method !== 'string') throw new McpAccessError('bridge method is required');
    if (runBridgeMethods.has(method)) requireScope(policy, 'run', `bridge method ${method}`);
    else if (writeBridgeMethods.has(method)) {
      requireScope(policy, 'run', `bridge method ${method}`);
      requireScope(policy, 'write', `bridge method ${method}`);
    } else if (!readBridgeMethods.has(method))
      throw new McpAccessError(`bridge method ${method} has no explicit permission classification`);
    if (method === 'capture_screenshot') {
      const params = args.params;
      const output =
        params && typeof params === 'object' && !Array.isArray(params)
          ? (params as Record<string, unknown>).path
          : undefined;
      const sessionId = args.sessionId;
      if (typeof output !== 'string' || typeof sessionId !== 'string')
        throw new McpAccessError('capture_screenshot requires an authorized output path');
      const sessionEvidence = policy.bridgeEvidenceDirs.get(sessionId);
      if (!sessionEvidence) throw new McpAccessError('bridge session has no authorized evidence directory');
      assertContained(output, policy.evidenceRoots, 'capture_screenshot path');
      assertContained(output, [sessionEvidence], 'capture_screenshot path');
    }
    if (method === 'reload_scene') {
      const params = args.params;
      const scene =
        params && typeof params === 'object' && !Array.isArray(params)
          ? (params as Record<string, unknown>).scenePath
          : undefined;
      if (scene !== undefined) assertResourcePath(scene, 'reload_scene scenePath');
    }
  }
  if (
    [
      'call_runtime_method',
      'create_runtime_node',
      'delete_runtime_node',
      'set_runtime_property',
      'inject_runtime_input',
      'reload_scene',
      'run_test_scene',
      'execute_scenario',
    ].includes(toolName)
  )
    requireScope(policy, 'run', toolName);
  authorizeNestedPaths(policy, toolName, args);
  if (
    ['dev_loop', 'begin_client_repair', 'submit_repair_candidate'].includes(toolName) &&
    !policy.scopes.has('run') &&
    !policy.scopes.has('admin')
  )
    throw new McpAccessError('dev_loop requires run and write permissions');
  if (godotExecutingTools.has(toolName)) {
    assertApprovedPath(args.godotPath ?? process.env.GODOT_PATH, policy.approvedGodotPaths, 'godotPath');
  }
  if (args.bridgePath !== undefined) assertApprovedBridge(args.bridgePath, policy);
  if (Array.isArray(args.extraArgs) && args.extraArgs.length > 0)
    throw new McpAccessError('extraArgs are disabled for client-selected launches');
  for (const [key, value] of Object.entries(args)) {
    if (key === 'scenePath' && value !== undefined) {
      if (
        ['open_runtime_bridge', 'dev_loop', 'begin_client_repair', 'reload_scene'].includes(toolName) ||
        (typeof value === 'string' && value.startsWith('res://'))
      )
        assertResourcePath(value, 'scenePath');
      else if (toolName === 'read_scene_file' && typeof value === 'string' && value.startsWith('uid://')) {
        // UID mapping is checked by the shared resolver below.
      } else if (
        !['read_scene_file', 'write_scene_file', 'get_scene_tree', 'analyze_collisions', 'get_node_semantics'].includes(
          toolName,
        ) ||
        typeof value !== 'string' ||
        (!path.isAbsolute(value) && !path.win32.isAbsolute(value))
      )
        assertProjectRelative(value, 'scenePath', required === 'write' ? 'write' : 'read');
      continue;
    }
    if (typeof value !== 'string' || value.length === 0) continue;
    if (projectPathKeys.has(key)) assertContained(value, policy.projectRoots, key);
    if (evidencePathKeys.has(key)) assertContained(value, policy.evidenceRoots, key);
  }
  const projectRoot = args.projectPath;
  if (typeof projectRoot === 'string') {
    const fileInput = ['read_project_file', 'write_project_file'].includes(toolName)
      ? args.filePath
      : toolName === 'analyze_script_semantics'
        ? args.scriptPath
        : [
              'read_scene_file',
              'write_scene_file',
              'get_scene_tree',
              'analyze_collisions',
              'get_node_semantics',
            ].includes(toolName)
          ? args.scenePath
          : undefined;
    if (typeof fileInput === 'string') {
      try {
        await resolveProjectPath(projectRoot, fileInput, {
          mode: required === 'write' ? 'write' : 'read',
          allowAbsolute: true,
          allowUid: required === 'read',
        });
      } catch (error) {
        throw new McpAccessError(`unsafe project file path: ${(error as Error).message}`);
      }
    }
  }
  const pid = args.pid;
  if (
    ['write_project_file', 'write_scene_file', 'write_validated_project_files', 'save_editor_scene'].includes(
      toolName,
    ) &&
    args.validationMode !== 'raw'
  ) {
    requireScope(policy, 'run', toolName);
    assertApprovedPath(args.godotPath ?? process.env.GODOT_PATH, policy.approvedGodotPaths, 'godotPath');
  }
  if (typeof pid === 'number' && ['stop_project', 'cancel_project', 'get_process_status'].includes(toolName)) {
    if (!policy.ownedPids.has(pid) && !policy.scopes.has('admin')) {
      throw new McpAccessError(`client ${policy.clientId} does not own process ${pid}`);
    }
  }
  const sessionId = args.sessionId;
  if (typeof sessionId === 'string' && !['open_runtime_bridge', 'get_editor_scene_operation'].includes(toolName)) {
    if (!policy.ownedBridgeSessions.has(sessionId) && !policy.scopes.has('admin')) {
      throw new McpAccessError(`client ${policy.clientId} does not own bridge session ${sessionId}`);
    }
  }
  const runId = args.runId;
  if (typeof runId === 'string' && !policy.ownedRunIds.has(runId) && !policy.scopes.has('admin')) {
    throw new McpAccessError(`client ${policy.clientId} does not own run ${runId}`);
  }
  const subscriptionId = args.subscriptionId;
  if (typeof subscriptionId === 'string' && !policy.scopes.has('admin')) {
    const evidenceDir = args.evidenceDir;
    if (typeof evidenceDir !== 'string')
      throw new McpAccessError(`client ${policy.clientId} does not own subscription ${subscriptionId}`);
    const known = policy.ownedSubscriptions.has(subscriptionKey(evidenceDir, subscriptionId));
    const persistedOwner = known ? policy.clientId : await getEventSubscriptionOwner(evidenceDir, subscriptionId);
    if (persistedOwner !== policy.clientId) {
      throw new McpAccessError(`client ${policy.clientId} does not own subscription ${subscriptionId}`);
    }
    policy.ownedSubscriptions.add(subscriptionKey(evidenceDir, subscriptionId));
  }
}

function authorizeNestedPaths(policy: McpClientPolicy, toolName: string, args: Record<string, unknown>): void {
  if (toolName === 'run_test_scene' || toolName === 'execute_scenario') {
    const scenario = asRecord(args.scenario);
    if (!scenario || !Array.isArray(scenario.steps)) throw new McpAccessError('scenario must contain steps');
    if (scenario.project !== undefined) {
      if (typeof scenario.project !== 'string') throw new McpAccessError('scenario project must be a path');
      assertContained(scenario.project, policy.projectRoots, 'scenario project');
    }
    for (const step of scenario.steps) {
      const entry = asRecord(step);
      if (!entry) throw new McpAccessError('scenario step must be an object');
      for (const [kind, options] of Object.entries(entry)) {
        const detail = asRecord(options);
        if (!detail) continue;
        if (detail.project !== undefined) {
          if (typeof detail.project !== 'string') throw new McpAccessError('scenario step project must be a path');
          assertContained(detail.project, policy.projectRoots, 'scenario step project');
        }
        if (
          kind === 'screenshot' &&
          detail.name !== undefined &&
          (typeof detail.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(detail.name))
        )
          throw new McpAccessError('scenario step name must be a safe basename');
      }
    }
  }
  if (toolName === 'dev_loop') {
    assertRelativeEdits(args.edits, 'dev_loop edits');
    if (Array.isArray(args.repairs)) {
      for (const repair of args.repairs) assertRelativeEdits(asRecord(repair)?.edits, 'dev_loop repair edits');
    }
  }
  if (toolName === 'begin_client_repair' && Array.isArray(args.allowedRepairFiles)) {
    for (const value of args.allowedRepairFiles) assertProjectRelative(value, 'allowedRepairFiles');
  }
  if (toolName === 'submit_repair_candidate') {
    assertRelativeEdits(asRecord(args.proposal)?.edits, 'repair candidate edits');
  }
}

function assertRelativeEdits(value: unknown, label: string): void {
  if (!Array.isArray(value)) return;
  for (const edit of value) assertProjectRelative(asRecord(edit)?.path, label);
}

function assertProjectRelative(value: unknown, label: string, mode: 'read' | 'write' = 'write'): void {
  try {
    if (typeof value !== 'string' || value.startsWith('res://')) throw new Error('relative only');
    projectRelativePath(value, mode);
  } catch {
    throw new McpAccessError(`${label} must be a contained project-relative path`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function assertResourcePath(value: unknown, label: string): void {
  try {
    if (typeof value !== 'string' || !value.startsWith('res://')) throw new Error('resource only');
    projectRelativePath(value, 'read');
  } catch {
    throw new McpAccessError(`${label} must be a contained res:// path`);
  }
}

export function subscriptionKey(evidenceDir: string, subscriptionId: string): string {
  return JSON.stringify([path.resolve(evidenceDir), subscriptionId]);
}

function requireScope(policy: McpClientPolicy, permission: McpPermission, operation: string): void {
  if (!policy.scopes.has(permission) && !policy.scopes.has('admin'))
    throw new McpAccessError(`client ${policy.clientId} lacks ${permission} permission for ${operation}`);
}

export function recordToolOwnership(policy: McpClientPolicy, toolName: string, response: unknown): void {
  if (!response || typeof response !== 'object') return;
  if ((response as { isError?: unknown }).isError === true) return;
  const content = (response as { content?: Array<{ text?: unknown }> }).content;
  const text = content?.[0]?.text;
  if (typeof text !== 'string') return;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (toolName === 'launch_project' && typeof value.pid === 'number') policy.ownedPids.add(value.pid);
    if (toolName === 'launch_project' && typeof value.run_id === 'string') policy.ownedRunIds.add(value.run_id);
    if (toolName === 'open_runtime_bridge' && typeof value.session_id === 'string') {
      policy.ownedBridgeSessions.add(value.session_id);
      policy.ownedRunIds.add(value.session_id);
      if (typeof value.evidenceDir === 'string')
        policy.bridgeEvidenceDirs.set(value.session_id, path.resolve(value.evidenceDir));
    }
    if (
      ['create_event_subscription', 'subscribe_runtime_events'].includes(toolName) &&
      typeof value.subscription_id === 'string' &&
      (typeof value.evidence_dir === 'string' || typeof value.evidenceDir === 'string')
    ) {
      policy.ownedSubscriptions.add(
        subscriptionKey(String(value.evidence_dir ?? value.evidenceDir), value.subscription_id),
      );
    }
  } catch {
    // Tool result text is not an ownership record.
  }
}

function assertContained(candidate: string, roots: readonly string[], label: string): void {
  if (roots.length === 0) throw new McpAccessError(`${label} is disabled for this client`);
  const resolved = path.resolve(candidate);
  const allowed = roots.some((root) => {
    if (!isWithin(resolved, root)) return false;
    try {
      return isWithin(realLocation(resolved), realLocation(root));
    } catch {
      return false;
    }
  });
  if (!allowed) throw new McpAccessError(`${label} must be inside an authorized root`);
}

function assertApprovedPath(candidate: unknown, approved: readonly string[], label: string): void {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || approved.length === 0)
    throw new McpAccessError(`${label} must be explicitly approved by server configuration`);
  let actual: string;
  try {
    actual = realpathSync.native(candidate);
  } catch {
    throw new McpAccessError(`${label} must reference an existing approved file`);
  }
  if (
    !approved.some((allowed) => {
      try {
        return actual === realpathSync.native(allowed);
      } catch {
        return false;
      }
    })
  )
    throw new McpAccessError(`${label} must be explicitly approved by server configuration`);
}

function assertApprovedBridge(candidate: unknown, policy: McpClientPolicy): void {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate))
    throw new McpAccessError('bridgePath must be explicitly approved by server configuration');
  try {
    assertApprovedPath(candidate, policy.approvedBridgePaths, 'bridgePath');
    return;
  } catch (error) {
    if (policy.approvedBridgeHashes.length === 0) throw error;
  }
  try {
    const canonical = realpathSync.native(candidate);
    const metadata = statSync(canonical);
    if (!metadata.isFile() || metadata.size > 2 * 1024 * 1024) throw new Error('bridge script exceeds digest budget');
    const bytes = readFileSync(canonical);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (policy.approvedBridgeHashes.includes(digest)) return;
  } catch {
    // Missing or unreadable scripts cannot be approved by digest.
  }
  throw new McpAccessError('bridgePath must be explicitly approved by server configuration');
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function realLocation(candidate: string): string {
  let existing = candidate;
  const missing: string[] = [];
  while (true) {
    try {
      return path.resolve(realpathSync.native(existing), ...missing.reverse());
    } catch (error) {
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      missing.push(path.basename(existing));
      existing = parent;
    }
  }
}

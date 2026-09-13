import path from 'node:path';

export type McpPermission = 'read' | 'run' | 'write' | 'admin';

export type McpClientPolicy = {
  clientId: string;
  scopes: ReadonlySet<McpPermission>;
  projectRoots: readonly string[];
  evidenceRoots: readonly string[];
  ownedPids: Set<number>;
  ownedBridgeSessions: Set<string>;
};

export class McpAccessError extends Error {
  readonly code = 'FORBIDDEN';

  constructor(message: string) {
    super(message);
    this.name = 'McpAccessError';
  }
}

const toolPermissions: Record<string, McpPermission> = {
  get_godot_version: 'read',
  list_projects: 'read',
  get_project_info: 'read',
  get_scene_tree: 'read',
  get_debug_output: 'read',
  get_process_status: 'read',
  get_runtime_events: 'read',
  subscribe_runtime_events: 'read',
  poll_event_subscription: 'read',
  list_event_subscriptions: 'read',
  list_active_runs: 'read',
  list_runs: 'read',
  get_runtime_scene_tree: 'read',
  get_runtime_property: 'read',
  capture_runtime_screenshot: 'read',
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
  call_runtime_bridge: 'run',
  stop_runtime_bridge: 'run',
  set_runtime_property: 'write',
  inject_runtime_input: 'write',
  execute_scenario: 'write',
  dev_loop: 'write',
  run_test_scene: 'write',
  git_checkpoint: 'write',
  git_recovery: 'admin',
  reclaim_orphan_runs: 'admin',
};

const projectPathKeys = new Set(['projectPath', 'directory', 'scenePath', 'scenarioPath', 'bridgePath', 'patchPath']);
const evidencePathKeys = new Set(['evidenceDir', 'baselinePath']);

export function createClientPolicy(input: {
  clientId: string;
  scopes: Iterable<McpPermission>;
  projectRoots: readonly string[];
  evidenceRoots: readonly string[];
}): McpClientPolicy {
  return {
    clientId: input.clientId,
    scopes: new Set(input.scopes),
    projectRoots: input.projectRoots.map((root) => path.resolve(root)),
    evidenceRoots: input.evidenceRoots.map((root) => path.resolve(root)),
    ownedPids: new Set(),
    ownedBridgeSessions: new Set(),
  };
}

export function authorizeToolCall(policy: McpClientPolicy, toolName: string, args: Record<string, unknown>): void {
  const required = toolPermissions[toolName] ?? 'admin';
  if (!policy.scopes.has(required) && !policy.scopes.has('admin')) {
    throw new McpAccessError(`client ${policy.clientId} lacks ${required} permission for ${toolName}`);
  }
  if (toolName === 'dev_loop' && !policy.scopes.has('run') && !policy.scopes.has('admin'))
    throw new McpAccessError('dev_loop requires run and write permissions');
  if (
    ['dev_loop', 'open_runtime_bridge'].includes(toolName) &&
    args.scenePath &&
    (typeof args.scenePath !== 'string' ||
      !args.scenePath.startsWith('res://') ||
      args.scenePath.slice(6).split(/[\\/]/).includes('..'))
  )
    throw new McpAccessError('dev_loop scenePath must be a contained res:// path');
  for (const [key, value] of Object.entries(args)) {
    if (['dev_loop', 'open_runtime_bridge'].includes(toolName) && key === 'scenePath') continue;
    if (typeof value !== 'string' || value.length === 0) continue;
    if (projectPathKeys.has(key)) assertContained(value, policy.projectRoots, key);
    if (evidencePathKeys.has(key)) assertContained(value, policy.evidenceRoots, key);
  }
  const pid = args.pid;
  if (typeof pid === 'number' && ['stop_project', 'cancel_project', 'get_process_status'].includes(toolName)) {
    if (!policy.ownedPids.has(pid) && !policy.scopes.has('admin')) {
      throw new McpAccessError(`client ${policy.clientId} does not own process ${pid}`);
    }
  }
  const sessionId = args.sessionId;
  if (typeof sessionId === 'string' && ['call_runtime_bridge', 'stop_runtime_bridge'].includes(toolName)) {
    if (!policy.ownedBridgeSessions.has(sessionId) && !policy.scopes.has('admin')) {
      throw new McpAccessError(`client ${policy.clientId} does not own bridge session ${sessionId}`);
    }
  }
}

export function recordToolOwnership(policy: McpClientPolicy, toolName: string, response: unknown): void {
  if (!response || typeof response !== 'object') return;
  const content = (response as { content?: Array<{ text?: unknown }> }).content;
  const text = content?.[0]?.text;
  if (typeof text !== 'string') return;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (toolName === 'launch_project' && typeof value.pid === 'number') policy.ownedPids.add(value.pid);
    if (toolName === 'open_runtime_bridge' && typeof value.session_id === 'string') {
      policy.ownedBridgeSessions.add(value.session_id);
    }
  } catch {
    // Tool result text is not an ownership record.
  }
}

function assertContained(candidate: string, roots: readonly string[], label: string): void {
  if (roots.length === 0) throw new McpAccessError(`${label} is disabled for this client`);
  const resolved = path.resolve(candidate);
  const allowed = roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
  if (!allowed) throw new McpAccessError(`${label} must be inside an authorized root`);
}

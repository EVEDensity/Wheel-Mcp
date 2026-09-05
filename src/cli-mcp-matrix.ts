export type ConsistencyStatus = 'VERIFIED' | 'PARTIAL' | 'UNAVAILABLE';

export type ToolConsistencyContract = {
  cliCommand: string;
  mcpTool: string;
  parameterMap: Record<string, string>;
  resultFields: string[];
  errorCodes: string[];
  timeoutCancellation: 'SHARED_CONTEXT' | 'PARTIAL' | 'UNAVAILABLE';
  evidence: 'PROJECT' | 'RUN' | 'EVIDENCE_DIR' | 'NONE';
  status: ConsistencyStatus;
};

export const cliMcpContracts: readonly ToolConsistencyContract[] = [
  {
    cliCommand: 'doctor',
    mcpTool: 'get_godot_version',
    parameterMap: { '--godot': 'godotPath', '--timeout': 'timeoutMs' },
    resultFields: ['schema_version', 'source', 'version'],
    errorCodes: ['TIMEOUT', 'FAILED'],
    timeoutCancellation: 'SHARED_CONTEXT',
    evidence: 'NONE',
    status: 'VERIFIED',
  },
  {
    cliCommand: 'scene-tree',
    mcpTool: 'get_scene_tree',
    parameterMap: { '--project': 'projectPath', '--scene': 'scenePath', '--timeout': 'timeoutMs' },
    resultFields: ['schema_version', 'source', 'capability', 'runtime', 'projectPath', 'scenePath', 'nodes'],
    errorCodes: ['TIMEOUT', 'FAILED'],
    timeoutCancellation: 'SHARED_CONTEXT',
    evidence: 'PROJECT',
    status: 'VERIFIED',
  },
  {
    cliCommand: 'launch',
    mcpTool: 'launch_project',
    parameterMap: {
      '--godot': 'godotPath',
      '--project': 'projectPath',
      '--evidence': 'evidenceDir',
      '--headless': 'headless',
      '--timeout': 'timeoutMs',
    },
    resultFields: ['schema_version', 'source', 'pid', 'project_path', 'stdout', 'stderr', 'lifecycle'],
    errorCodes: ['TIMEOUT', 'CANCELLED', 'FAILED'],
    timeoutCancellation: 'SHARED_CONTEXT',
    evidence: 'RUN',
    status: 'VERIFIED',
  },
  {
    cliCommand: 'logs',
    mcpTool: 'get_debug_output',
    parameterMap: { '--evidence': 'evidenceDir', '--timeout': 'timeoutMs' },
    resultFields: ['metadata', 'stdout', 'stderr'],
    errorCodes: ['TIMEOUT', 'FAILED'],
    timeoutCancellation: 'SHARED_CONTEXT',
    evidence: 'EVIDENCE_DIR',
    status: 'VERIFIED',
  },
  {
    cliCommand: 'stop',
    mcpTool: 'stop_project',
    parameterMap: { '--pid': 'pid', '--timeout': 'timeoutMs' },
    resultFields: ['stopped', 'pid', 'timed_out'],
    errorCodes: ['TIMEOUT', 'FAILED'],
    timeoutCancellation: 'SHARED_CONTEXT',
    evidence: 'RUN',
    status: 'PARTIAL',
  },
  {
    cliCommand: 'context-pack',
    mcpTool: 'get_context_pack',
    parameterMap: {
      '--project': 'projectPath',
      '--godot': 'godotPath',
      '--evidence': 'evidenceDir',
      '--scene': 'scenePath',
      '--timeout': 'timeoutMs',
    },
    resultFields: ['project', 'godot', 'main_scene', 'scene_tree', 'recent_errors', 'git', 'active_run'],
    errorCodes: ['TIMEOUT', 'FAILED'],
    timeoutCancellation: 'SHARED_CONTEXT',
    evidence: 'PROJECT',
    status: 'VERIFIED',
  },
  {
    cliCommand: 'scenario',
    mcpTool: 'scenario_executor',
    parameterMap: {
      '--file': 'scenarioPath',
      '--project': 'projectPath',
      '--godot': 'godotPath',
      '--bridge': 'bridgePath',
      '--evidence': 'evidenceDir',
      '--timeout': 'timeoutMs',
    },
    resultFields: ['schema_version', 'source', 'status', 'steps', 'evidenceDir'],
    errorCodes: ['TIMEOUT', 'CANCELLED', 'FAILED'],
    timeoutCancellation: 'SHARED_CONTEXT',
    evidence: 'RUN',
    status: 'UNAVAILABLE',
  },
] as const;

export const mcpOnlyTools = [
  'list_projects',
  'get_project_info',
  'cancel_project',
  'get_process_status',
  'get_runtime_events',
  'subscribe_runtime_events',
  'list_runs',
  'list_active_runs',
  'stop_run',
  'cancel_run',
  'reclaim_orphan_runs',
  'get_runtime_scene_tree',
  'get_runtime_property',
  'set_runtime_property',
  'inject_runtime_input',
  'capture_runtime_screenshot',
  'git_checkpoint',
  'git_recovery',
] as const;

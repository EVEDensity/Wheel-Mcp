export type CliOptions = Record<string, string>;

export type LifecycleState =
  | 'STARTING'
  | 'RUNNING'
  | 'STOPPING'
  | 'CANCELLING'
  | 'EXITED'
  | 'STOPPED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'FAILED'
  | 'ORPHANED';

const terminalLifecycleStates = new Set<LifecycleState>(['EXITED', 'STOPPED', 'CANCELLED', 'TIMEOUT', 'FAILED']);

export function transitionLifecycle(current: LifecycleState, next: LifecycleState): LifecycleState {
  if (terminalLifecycleStates.has(current) && current !== next)
    throw new Error(`terminal lifecycle ${current} cannot transition to ${next}`);
  return next;
}

export type ScenarioDefinition = {
  steps: unknown[];
  name?: string;
  project?: string;
  replay?: {
    seed?: number;
    expected?: {
      godotVersion?: string;
      renderer?: string;
      displayServer?: string;
      physicsTicksPerSecond?: number;
      viewport?: { width: number; height: number };
    };
  };
};

export type ScenarioStepOptions = {
  project?: string;
  mode?: string;
  event?: string;
  name?: string;
  keycode?: number;
  pressed?: boolean;
  /** Input step: inject a press and then an explicit release of the same key. */
  release?: boolean;
  timeoutMs?: number;
  retries?: number;
  /** physics_frames step: engine-confirmed physics frame barrier, 1..120. */
  frames?: number;
  /** switch_scene step: res:// path reloaded in the same bridge process; code freshness NOT_VERIFIED. */
  scenePath?: string;
  /** state/collision step: bridge RPC method; collision fixes it to query_collisions. */
  method?: string;
  params?: Record<string, unknown>;
  /** Assertion fields, frozen by the submitted sequence; op "within" uses tolerance. */
  path?: string;
  op?: 'equals' | 'includes' | 'greater' | 'exists' | 'within';
  expected?: unknown;
  tolerance?: number;
  /** diagnostics step: maximum tolerated engine error diagnostics at this point. */
  maxErrors?: number;
  /** visual step: screenshot compare against a baseline with a frozen difference budget. */
  baselinePath?: string;
  threshold?: number;
  maxDifferenceRatio?: number;
};

export type LaunchHandle = Awaited<ReturnType<typeof import('./godot-runtime.js').launchProject>>;

export type ScenarioStepResult = {
  status: 'PASS' | 'FAIL' | 'TIMEOUT';
  index: number;
  kind: string;
  attempts: number;
  code?: string;
  error?: string;
  event?: string;
  /** Sequence number of the runtime event that satisfied this step, when it waited on one. */
  sequence?: number;
  /** Raw observed value for assertion steps, retained as replay evidence. */
  actual?: unknown;
  timed_out?: boolean;
  cancelled?: boolean;
  launch?: LaunchHandle;
};

export type ScenarioRunStepResult = Omit<ScenarioStepResult, 'index' | 'kind' | 'attempts' | 'status'> & {
  status: string;
  bridge?: import('./persistent-runtime-bridge.js').PersistentRuntimeBridge;
};

export type ScenarioExecutionContext = {
  scenario: ScenarioDefinition;
  evidence: string;
  bridgePath?: string;
  godotPath?: string;
  launch: LaunchHandle | null;
  bridge: import('./persistent-runtime-bridge.js').PersistentRuntimeBridge | null;
  timeoutMs: number;
  timeout: import('./timeout.js').TimeoutContext;
  /** Strictly increasing event cursor: only events with a greater sequence satisfy a later step. */
  eventCursor: number;
};

export type McpTextContent = { type: 'text'; text: string };
export type McpToolResult = {
  content: McpTextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
export type McpFailureResult = McpToolResult & { isError: true };

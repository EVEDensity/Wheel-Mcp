export type CliOptions = Record<string, string>;

export type ScenarioDefinition = {
  steps: unknown[];
  name?: string;
  project?: string;
};

export type ScenarioStepOptions = {
  project?: string;
  mode?: string;
  event?: string;
  name?: string;
  keycode?: number;
  pressed?: boolean;
  timeoutMs?: number;
  retries?: number;
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
  timed_out?: boolean;
  cancelled?: boolean;
  launch?: LaunchHandle;
};

export type ScenarioRunStepResult = Omit<ScenarioStepResult, 'index' | 'kind' | 'attempts' | 'status'> & {
  status: string;
};

export type ScenarioExecutionContext = {
  scenario: ScenarioDefinition;
  evidence: string;
  bridgePath?: string;
  godotPath?: string;
  launch: LaunchHandle | null;
  timeoutMs: number;
  timeout: import('./timeout.js').TimeoutContext;
};

export type McpTextContent = { type: 'text'; text: string };
export type McpToolResult = {
  content: McpTextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
export type McpFailureResult = McpToolResult & { isError: true };

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ScriptStateTransition {
  from?: string;
  to: string;
  line: number;
  trigger?: string;
  expression?: string;
}

export interface ScriptState {
  name: string;
  line?: number;
  source: 'enum' | 'constant' | 'assignment' | 'match' | 'function';
}

export interface ScriptSemanticAnalysis {
  schema_version: '0.1';
  source: 'REAL';
  scriptPath?: string;
  extends?: string;
  className?: string;
  signals: Array<{ name: string; line: number; parameters: string[] }>;
  variables: Array<{ name: string; type?: string; line: number; export?: boolean; onready?: boolean }>;
  functions: Array<{ name: string; line: number; parameters: string[]; inferredStates: string[] }>;
  states: ScriptState[];
  transitions: ScriptStateTransition[];
  stateMachine: {
    stateVariable?: string;
    states: string[];
    transitions: ScriptStateTransition[];
    entryPoints: string[];
  };
  diagnostics: Array<{ code: string; message: string; line?: number; severity: 'warning' | 'info' }>;
}

function lineNumber(lines: string[], index: number): number {
  return index + 1;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function cleanIdentifier(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function parseParameters(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim().split(':')[0]?.split('=')[0]?.trim())
    .filter((part): part is string => Boolean(part));
}

export function analyzeScriptSemantics(content: string, scriptPath?: string): ScriptSemanticAnalysis {
  const lines = content.split(/\r?\n/);
  const result: ScriptSemanticAnalysis = {
    schema_version: '0.1',
    source: 'REAL',
    ...(scriptPath ? { scriptPath } : {}),
    signals: [],
    variables: [],
    functions: [],
    states: [],
    transitions: [],
    stateMachine: { states: [], transitions: [], entryPoints: [] },
    diagnostics: [],
  };
  let currentFunction: (typeof result.functions)[number] | undefined;
  let stateVariable: string | undefined;
  let currentState: string | undefined;

  lines.forEach((raw, index) => {
    const line = raw.trim();
    const lineNo = lineNumber(lines, index);
    if (!line || line.startsWith('#')) return;

    const extendsMatch = line.match(/^extends\s+([\w./]+)/);
    if (extendsMatch) result.extends = extendsMatch[1];
    const classMatch = line.match(/^class_name\s+([A-Za-z_]\w*)/);
    if (classMatch) result.className = classMatch[1];

    const signalMatch = line.match(/^signal\s+([A-Za-z_]\w*)(?:\s*\(([^)]*)\))?/);
    if (signalMatch)
      result.signals.push({ name: signalMatch[1], line: lineNo, parameters: parseParameters(signalMatch[2] ?? '') });

    const variableMatch = line.match(/^(?:@export\s+)?(?:@onready\s+)?var\s+([A-Za-z_]\w*)(?:\s*:\s*([^=]+))?/);
    if (variableMatch) {
      result.variables.push({
        name: variableMatch[1],
        type: variableMatch[2]?.trim(),
        line: lineNo,
        export: line.includes('@export'),
        onready: line.includes('@onready'),
      });
      if (/state/i.test(variableMatch[1])) stateVariable = variableMatch[1];
    }

    const enumMatch = line.match(/^enum\s*\{([^}]*)\}/);
    if (enumMatch) {
      enumMatch[1]
        .split(',')
        .map(cleanIdentifier)
        .filter(Boolean)
        .forEach((name) => result.states.push({ name, line: lineNo, source: 'enum' }));
    }
    const constantMatch = line.match(/^const\s+([A-Za-z_]\w*)\s*[:=]\s*([A-Za-z_]\w*)/);
    if (constantMatch && /state/i.test(constantMatch[1]))
      result.states.push({ name: constantMatch[1], line: lineNo, source: 'constant' });

    const functionMatch = line.match(/^func\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (functionMatch) {
      currentFunction = {
        name: functionMatch[1],
        line: lineNo,
        parameters: parseParameters(functionMatch[2]),
        inferredStates: [],
      };
      result.functions.push(currentFunction);
      if (/^(?:_ready|_process|_physics_process|_input|_unhandled_input)$/.test(functionMatch[1]))
        result.stateMachine.entryPoints.push(functionMatch[1]);
    }

    const matchState = line.match(/^([A-Za-z_]\w*)\s*:\s*$/);
    if (matchState && (stateVariable || /state/i.test(matchState[1]))) {
      result.states.push({ name: matchState[1], line: lineNo, source: 'match' });
    }

    const assignment = line.match(/^(?:self\.)?([A-Za-z_]\w*)\s*([+]?=)\s*([A-Za-z_]\w*)/);
    if (assignment && /state/i.test(assignment[1])) {
      stateVariable ??= assignment[1];
      const to = assignment[3];
      currentFunction?.inferredStates.push(to);
      result.states.push({ name: to, line: lineNo, source: 'assignment' });
      result.transitions.push({
        from: currentState,
        to,
        line: lineNo,
        trigger: currentFunction?.name,
        expression: line,
      });
      currentState = to;
    }
  });

  result.states = result.states.filter(
    (state, index, all) => all.findIndex((other) => other.name === state.name) === index,
  );
  result.stateMachine.stateVariable = stateVariable;
  result.stateMachine.states = result.states.map((state) => state.name);
  result.stateMachine.transitions = result.transitions;
  if (stateVariable && result.transitions.length === 0) {
    result.diagnostics.push({
      code: 'STATE_MACHINE_NO_TRANSITIONS',
      severity: 'warning',
      message: `State variable "${stateVariable}" was found but no state transitions were detected.`,
    });
  }
  if (result.functions.length === 0)
    result.diagnostics.push({
      code: 'NO_FUNCTIONS',
      severity: 'info',
      message: 'No functions were detected in the script.',
    });
  return result;
}

export async function analyzeScriptFile(projectPath: string, scriptPath: string): Promise<ScriptSemanticAnalysis> {
  const root = path.resolve(projectPath);
  const file = path.resolve(root, scriptPath);
  if (file !== root && !file.startsWith(root + path.sep)) throw new Error('script path must remain inside projectPath');
  return analyzeScriptSemantics(await readFile(file, 'utf8'), path.relative(root, file));
}

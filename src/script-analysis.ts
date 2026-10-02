import { readFile } from 'node:fs/promises';
import { resolveProjectPath } from './project/paths.js';

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
  /** This parser scans lines with regexes; it is not a Godot semantic or syntax service. */
  analysisLevel: 'heuristic';
  /** Heuristic output must never authorize symbol rename or other source edits. */
  safeRefactor: false;
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
    analysisLevel: 'heuristic',
    safeRefactor: false,
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
  // Heuristic enum table: enum name (or '' for anonymous) -> declared members.
  // Lexical only: matching a name never proves a type relation or authorizes edits.
  const enums = new Map<string, Set<string>>();
  const resolveEnumMember = (value: string): string => {
    const segments = value.split('.');
    if (segments.length === 1) return segments[0];
    const owner = enums.get(segments[0]);
    if (owner?.has(segments[1])) return segments[1];
    return segments[segments.length - 1];
  };

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

    const variableMatch = line.match(/^(?:@export\s+)?(?:@onready\s+)?var\s+([A-Za-z_]\w*)(?:\s*:\s*([^=\s]+))?/);
    if (variableMatch) {
      const declaredType = variableMatch[2]?.trim();
      result.variables.push({
        name: variableMatch[1],
        type: declaredType,
        line: lineNo,
        export: line.includes('@export'),
        onready: line.includes('@onready'),
      });
      // A declared enum type is the stronger state-machine signal; a state-like
      // name is the fallback heuristic when no enum table matches yet.
      if (declaredType && enums.has(declaredType)) stateVariable = variableMatch[1];
      else if (/state/i.test(variableMatch[1])) stateVariable ??= variableMatch[1];
      // An enum-typed declaration with an initializer supplies the heuristic
      // initial state, e.g. `var state: Mode = Mode.IDLE` starts at IDLE.
      const initializer = line.match(/=\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*$/);
      if (stateVariable === variableMatch[1] && initializer) {
        const initial = resolveEnumMember(initializer[1]);
        const known = [...enums.values()].some((members) => members.has(initial));
        if (known) currentState ??= initial;
      }
    }

    const enumMatch = line.match(/^enum\s*(?:([A-Za-z_]\w*)\s*)?\{([^}]*)\}/);
    if (enumMatch) {
      const members = new Set<string>();
      enumMatch[2]
        .split(',')
        .map((part) => cleanIdentifier(part.split('=')[0]))
        .filter(Boolean)
        .forEach((name) => {
          members.add(name);
          result.states.push({ name, line: lineNo, source: 'enum' });
        });
      if (members.size) enums.set(enumMatch[1] ?? '', members);
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

    const assignment = line.match(/^(?:self\.)?([A-Za-z_]\w*)\s*([+]?=)\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/);
    if (assignment && /state/i.test(assignment[1])) {
      stateVariable ??= assignment[1];
      // Resolve qualified members like `Mode.RUNNING` to the enum member so
      // transitions reference declared states; unknown qualifiers fall back
      // to the last identifier segment.
      const to = resolveEnumMember(assignment[3]);
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
  const resolved = await resolveProjectPath(projectPath, scriptPath, {
    mode: 'read',
    allowAbsolute: true,
    allowUid: true,
  });
  return analyzeScriptSemantics(await readFile(resolved.absolutePath, 'utf8'), resolved.relativePath);
}

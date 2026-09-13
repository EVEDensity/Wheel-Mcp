export type GodotVariant =
  | { type: 'Vector2'; x: number; y: number }
  | { type: 'Vector3'; x: number; y: number; z: number }
  | { type: 'Color'; r: number; g: number; b: number; a: number }
  | { type: 'NodePath'; path: string }
  | { type: 'Resource'; path?: string; resourceType?: string; [key: string]: unknown }
  | unknown;

export type UnifiedResponse<T extends Record<string, unknown> = Record<string, unknown>> = T & {
  schema_version: '0.1';
  source: 'REAL' | 'SIMULATED';
};

export function serializeGodotValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(serializeGodotValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeGodotValue(item)]));
  }
  if (typeof value !== 'string') return value;
  const text = value.trim();
  let match = text.match(/^Vector2\(([-+]?\d*\.?\d+),\s*([-+]?\d*\.?\d+)\)$/);
  if (match) return { type: 'Vector2', x: Number(match[1]), y: Number(match[2]) };
  match = text.match(/^Vector3\(([-+]?\d*\.?\d+),\s*([-+]?\d*\.?\d+),\s*([-+]?\d*\.?\d+)\)$/);
  if (match) return { type: 'Vector3', x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
  match = text.match(/^Color\(([-+]?\d*\.?\d+),\s*([-+]?\d*\.?\d+),\s*([-+]?\d*\.?\d+)(?:,\s*([-+]?\d*\.?\d+))?\)$/);
  if (match)
    return {
      type: 'Color',
      r: Number(match[1]),
      g: Number(match[2]),
      b: Number(match[3]),
      a: match[4] === undefined ? 1 : Number(match[4]),
    };
  match = text.match(/^NodePath\("(.*)"\)$/);
  if (match) return { type: 'NodePath', path: match[1] };
  return value;
}

export function createUnifiedResponse<T extends Record<string, unknown>>(
  value: T,
  source: 'REAL' | 'SIMULATED' = 'REAL',
): UnifiedResponse<T> {
  return { schema_version: '0.1', source, ...(serializeGodotValue(value) as T) };
}

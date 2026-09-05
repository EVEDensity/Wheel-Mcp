export interface RuntimeEvent {
  schema_version: '0.1';
  source: 'REAL';
  run_id: string;
  sequence: number;
  timestamp: string;
  event: string;
  payload: Record<string, unknown>;
}

export interface EventReadResult {
  schema_version: '0.1';
  source: 'REAL';
  evidenceDir: string;
  events: RuntimeEvent[];
  invalid_lines: Array<{ line: number; reason: string }>;
  pending_partial: boolean;
}

export function parseRuntimeEvent(value: unknown): RuntimeEvent | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (
    item.schema_version !== '0.1' ||
    item.source !== 'REAL' ||
    typeof item.run_id !== 'string' ||
    !item.run_id ||
    !Number.isInteger(item.sequence) ||
    (item.sequence as number) < 1 ||
    typeof item.timestamp !== 'string' ||
    typeof item.event !== 'string' ||
    !item.event ||
    !item.payload ||
    typeof item.payload !== 'object' ||
    Array.isArray(item.payload)
  )
    return null;
  return item as unknown as RuntimeEvent;
}

import { isStableErrorCode, type ErrorCode } from './error-schema.js';

export type GodotVariant =
  | { type: 'Vector2'; x: number; y: number }
  | { type: 'Vector2i'; x: number; y: number }
  | { type: 'Vector3'; x: number; y: number; z: number }
  | { type: 'Vector3i'; x: number; y: number; z: number }
  | { type: 'Color'; r: number; g: number; b: number; a: number }
  | { type: 'NodePath'; path: string }
  | { type: 'Quaternion'; x: number; y: number; z: number; w: number }
  | { type: 'Basis'; x: GodotVariant; y: GodotVariant; z: GodotVariant }
  | { type: 'Transform2D'; x: GodotVariant; y: GodotVariant; origin: GodotVariant }
  | { type: 'Transform3D'; basis: GodotVariant; origin: GodotVariant }
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
  return value;
}

export function createUnifiedResponse<T extends Record<string, unknown>>(
  value: T,
  source: 'REAL' | 'SIMULATED' = 'REAL',
): UnifiedResponse<T> {
  return { schema_version: '0.1', source, ...(serializeGodotValue(value) as T) };
}

export class OperationResultError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'OperationResultError';
  }
}

export function assertNoNestedFailure(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const envelope = value as Record<string, unknown>;
  const response = envelope.response;
  if (!response || typeof response !== 'object' || Array.isArray(response)) return;
  const nested = response as Record<string, unknown>;
  if (!Object.hasOwn(nested, 'error') && nested.status !== 'FAIL') return;
  const error = nested.error;
  const inner = error && typeof error === 'object' && !Array.isArray(error) ? (error as Record<string, unknown>) : null;
  const code = isStableErrorCode(nested.code)
    ? nested.code
    : isStableErrorCode(inner?.code)
      ? inner.code
      : 'INTERNAL_ERROR';
  const message =
    typeof nested.message === 'string'
      ? nested.message
      : typeof inner?.message === 'string'
        ? inner.message
        : typeof error === 'string'
          ? error
          : 'operation returned an untyped nested error';
  throw new OperationResultError(code, message, { nestedError: error ?? null, nestedStatus: nested.status ?? null });
}

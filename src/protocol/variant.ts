import { WheelError } from '../error-schema.js';

const MAX_DEPTH = 32;
const components: Record<string, readonly string[]> = {
  Vector2: ['x', 'y'],
  Vector2i: ['x', 'y'],
  Vector3: ['x', 'y', 'z'],
  Vector3i: ['x', 'y', 'z'],
  Color: ['r', 'g', 'b'],
  Quaternion: ['x', 'y', 'z', 'w'],
};
const structures: Record<string, Record<string, string>> = {
  Basis: { x: 'Vector3', y: 'Vector3', z: 'Vector3' },
  Transform2D: { x: 'Vector2', y: 'Vector2', origin: 'Vector2' },
  Transform3D: { basis: 'Basis', origin: 'Vector3' },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function invalid(path: string, message: string): never {
  throw new WheelError('INVALID_ARGUMENT', `${path}: ${message}`);
}

function unsupported(path: string, message: string): never {
  throw new WheelError('UNSUPPORTED', `${path}: ${message}`);
}

/** Validate the JSON-safe, explicitly tagged subset before sending it to Godot. */
export function validateVariantInput(value: unknown, path = 'value', depth = 0): void {
  if (depth > MAX_DEPTH) unsupported(path, 'Variant nesting exceeds 32 levels');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
      invalid(path, 'number is non-finite or outside the JSON-safe integer range');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateVariantInput(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!isRecord(value)) invalid(path, 'expected a JSON Variant');
  const tag = value.type;
  if (typeof tag === 'string' && tag in components) {
    const required = components[tag];
    for (const name of required) {
      const number = value[name];
      if (typeof number !== 'number' || !Number.isFinite(number))
        invalid(`${path}.${name}`, 'expected a finite number');
      if (tag.endsWith('i') && !Number.isSafeInteger(number)) invalid(`${path}.${name}`, 'expected a safe integer');
    }
    if (tag === 'Color' && value.a !== undefined && (typeof value.a !== 'number' || !Number.isFinite(value.a)))
      invalid(`${path}.a`, 'expected a finite number');
    const allowed = new Set(['type', ...required, ...(tag === 'Color' ? ['a'] : [])]);
    if (Object.keys(value).some((key) => !allowed.has(key))) invalid(path, `unexpected ${tag} component`);
    return;
  }
  if (tag === 'NodePath') {
    if (typeof value.path !== 'string' || Object.keys(value).some((key) => !['type', 'path'].includes(key)))
      invalid(path, 'NodePath requires only a string path');
    return;
  }
  if (typeof tag === 'string' && tag in structures) {
    const shape = structures[tag];
    if (Object.keys(value).some((key) => key !== 'type' && !(key in shape)))
      invalid(path, `unexpected ${tag} component`);
    for (const [name, expected] of Object.entries(shape)) {
      validateVariantInput(value[name], `${path}.${name}`, depth + 1);
      if (!isRecord(value[name]) || value[name].type !== expected) invalid(`${path}.${name}`, `expected ${expected}`);
    }
    return;
  }
  if (tag === 'Resource' || tag === 'Unsupported')
    unsupported(path, 'resource/unsupported Variant input is not accepted');
  for (const [key, item] of Object.entries(value)) validateVariantInput(item, `${path}.${key}`, depth + 1);
}

/** Read-side guard: a bridge cannot report an unsupported or malformed typed value as success. */
export function validateVariantOutput(value: unknown, path = 'value', depth = 0): void {
  if (depth > MAX_DEPTH) unsupported(path, 'Variant output nesting exceeds 32 levels');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
      unsupported(path, 'bridge returned a non-finite or unsafe number');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateVariantOutput(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!isRecord(value)) unsupported(path, 'bridge returned a non-JSON Variant');
  if (value.type === 'Unsupported') unsupported(path, 'bridge returned an unsupported Variant marker');
  if (value.type === 'Resource') {
    if (typeof value.path !== 'string' || !value.path.startsWith('res://') || typeof value.resourceType !== 'string')
      unsupported(path, 'bridge returned an uncontrolled Resource reference');
    return;
  }
  if (
    typeof value.type === 'string' &&
    (value.type in components || value.type in structures || value.type === 'NodePath')
  ) {
    try {
      validateVariantInput(value, path, depth);
    } catch (error) {
      if (error instanceof WheelError) unsupported(path, error.message);
      throw error;
    }
    return;
  }
  for (const [key, item] of Object.entries(value)) validateVariantOutput(item, `${path}.${key}`, depth + 1);
}

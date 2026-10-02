import path from 'node:path';
import type { ErrorCode } from './error-schema.js';
import { validateVariantOutput } from './protocol/variant.js';
import { physics3dResultSchema } from './protocol/physics3d.js';

export const BRIDGE_PROTOCOL_VERSION = 'wheel-runtime/1';

export type BridgeHandshake = {
  protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  bridgeVersion: string;
  godotVersion: string;
  plane: 'runtime';
  projectPath: string;
  runId: string;
  capabilities: string[];
  versionVerification: 'VERIFIED' | 'NOT_VERIFIED';
  runtimeConditions?: {
    renderer: string;
    displayServer: string;
    viewport: { width: number; height: number };
    physicsTicksPerSecond: number;
    physicsFrame: number;
    replaySeed: number | null;
  };
};

export class BridgeProtocolError extends Error {
  readonly code: ErrorCode = 'PROTOCOL_MISMATCH';
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'BridgeProtocolError';
  }
}

export class BridgeRpcError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BridgeRpcError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (value: Record<string, unknown>, key: string) => Object.hasOwn(value, key);

export function classifyBridgeRpcError(
  error: { code: number; message: string; data?: unknown },
  context: { sessionId: string; method: string; params: Record<string, unknown> },
): BridgeRpcError {
  const mapped: Record<number, ErrorCode> = {
    [-32602]: 'INVALID_ARGUMENT',
    [-32601]: 'UNSUPPORTED',
    [-32004]: 'NOT_FOUND',
    [-32009]: 'CONFLICT',
    [-32050]: 'ENGINE_UNAVAILABLE',
  };
  return new BridgeRpcError(mapped[error.code] ?? 'INTERNAL_ERROR', error.message, {
    bridgeCode: error.code,
    sessionId: context.sessionId,
    method: context.method,
    ...(typeof context.params.nodePath === 'string' ? { nodePath: context.params.nodePath } : {}),
    ...(typeof context.params.property === 'string' ? { property: context.params.property } : {}),
    ...(error.data !== undefined ? { bridgeData: error.data } : {}),
  });
}

export function validateBridgeHandshake(
  params: unknown,
  expected: { projectPath: string; runId: string },
): BridgeHandshake {
  if (!isRecord(params)) throw new BridgeProtocolError('bridge ready payload is missing');
  const fields = ['protocolVersion', 'bridgeVersion', 'godotVersion', 'plane', 'projectPath', 'runId'];
  if (fields.some((key) => typeof params[key] !== 'string' || !(params[key] as string).length))
    throw new BridgeProtocolError('bridge ready payload lacks required identity', { params });
  if (params.protocolVersion !== BRIDGE_PROTOCOL_VERSION || params.plane !== 'runtime')
    throw new BridgeProtocolError('bridge protocol version or plane is incompatible', {
      expectedProtocolVersion: BRIDGE_PROTOCOL_VERSION,
      actualProtocolVersion: params.protocolVersion,
      plane: params.plane,
    });
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  if (params.runId !== expected.runId || normalize(params.projectPath as string) !== normalize(expected.projectPath))
    throw new BridgeProtocolError('bridge ready identity does not match the requested session', {
      expectedRunId: expected.runId,
      actualRunId: params.runId,
      expectedProjectPath: expected.projectPath,
      actualProjectPath: params.projectPath,
    });
  if (!Array.isArray(params.capabilities) || !params.capabilities.every((item) => typeof item === 'string'))
    throw new BridgeProtocolError('bridge ready capabilities are invalid');
  if (new Set(params.capabilities).size !== params.capabilities.length)
    throw new BridgeProtocolError('bridge ready capabilities contain duplicates');
  const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(params.godotVersion as string);
  if (params.runtimeConditions !== undefined) {
    const data = params.runtimeConditions;
    if (
      !isRecord(data) ||
      typeof data.renderer !== 'string' ||
      typeof data.displayServer !== 'string' ||
      !isRecord(data.viewport) ||
      !Number.isInteger(data.viewport.width) ||
      Number(data.viewport.width) < 1 ||
      !Number.isInteger(data.viewport.height) ||
      Number(data.viewport.height) < 1 ||
      !Number.isInteger(data.physicsTicksPerSecond) ||
      Number(data.physicsTicksPerSecond) < 1 ||
      !Number.isSafeInteger(data.physicsFrame) ||
      Number(data.physicsFrame) < 0 ||
      !(
        data.replaySeed === null ||
        (Number.isInteger(data.replaySeed) && Number(data.replaySeed) >= 0 && Number(data.replaySeed) <= 0xffffffff)
      )
    )
      throw new BridgeProtocolError('bridge runtime conditions are invalid');
  }
  if (match && (Number(match[1]) !== 4 || Number(match[2]) < 3))
    throw new BridgeRpcError('UNSUPPORTED', 'Godot version is outside the supported runtime range', {
      godotVersion: params.godotVersion,
    });
  return {
    ...(params as Omit<BridgeHandshake, 'versionVerification'>),
    versionVerification: match?.[1] === '4' && match?.[2] === '7' && match?.[3] === '2' ? 'VERIFIED' : 'NOT_VERIFIED',
  };
}

export function validateBridgeResult(method: string, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new BridgeProtocolError(`bridge ${method} returned a non-object result`);
  if (has(value, 'error'))
    throw new BridgeRpcError('INTERNAL_ERROR', `bridge ${method} returned an untyped error`, {
      method,
      bridgeError: value.error,
    });
  const required: Record<string, Array<[string, (input: unknown) => boolean]>> = {
    get_scene_tree: [['nodes', Array.isArray]],
    get_property: [['value', () => true]],
    set_property: [
      ['before', () => true],
      ['after', () => true],
    ],
    create_node: [['nodePath', (item) => typeof item === 'string']],
    delete_node: [['deleted', (item) => item === true]],
    call_method: [['value', () => true]],
    reload_scene: [['reloaded', (item) => item === true]],
    inject_input: [['accepted', (item) => item === true]],
    capture_screenshot: [
      ['path', (item) => typeof item === 'string'],
      ['width', Number.isInteger],
      ['height', Number.isInteger],
    ],
    subscribe_events: [
      ['subscribed', (item) => item === true],
      ['sequence', Number.isInteger],
    ],
    stop: [['stopped', (item) => item === true]],
    wait_physics_frames: [
      ['frames', Number.isInteger],
      ['physicsFrame', Number.isInteger],
    ],
    get_specialized_state: [['state', isRecord]],
    get_game_state: [['properties', isRecord]],
    query_collisions: [
      ['overlaps', Array.isArray],
      ['history', Array.isArray],
    ],
  };
  const shape = required[method];
  if (!shape) throw new BridgeProtocolError(`unsupported bridge result method: ${method}`);
  const controls = new Set(['reload_scene', 'subscribe_events', 'stop', 'wait_physics_frames']);
  if (!controls.has(method) && (value.schema_version !== '0.1' || value.source !== 'REAL'))
    throw new BridgeProtocolError(`bridge ${method} returned an invalid source envelope`, { value });
  for (const [key, check] of shape)
    if (!has(value, key) || !check(value[key]))
      throw new BridgeProtocolError(`bridge ${method} result is missing or invalid: ${key}`, {
        method,
        key,
      });
  validateVariantOutput(value, `bridge.${method}`);
  if (method === 'query_collisions' && value.dimension === '3D') {
    const parsed = physics3dResultSchema.safeParse(value);
    if (!parsed.success)
      throw new BridgeProtocolError('Invalid 3D physics observation', { issues: parsed.error.issues });
  }
  return value;
}

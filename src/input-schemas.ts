import { z } from 'zod';

export const timeoutMsSchema = z.number().int().nonnegative().optional();
export const pidSchema = z.number().int().positive();
export const keycodeSchema = z.number().int();
export const pressedSchema = z.boolean().optional();

export function parseCliNumber(value: string | undefined, name: string, fallback?: number): number {
  const candidate = value === undefined ? fallback : Number(value);
  return z
    .number()
    .finite()
    .parse(candidate, { path: [name] });
}

export function parseCliBoolean(value: string | undefined, fallback = true): boolean {
  if (value === undefined) return fallback;
  return z.enum(['true', 'false']).parse(value) === 'true';
}

export function parseCliJson(value: string, name: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
}

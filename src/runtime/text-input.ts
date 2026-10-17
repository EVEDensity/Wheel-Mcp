import { z } from 'zod';
import { WheelError } from '../error-schema.js';

/** One committed scalar, not a grapheme/IME composition or a keyboard shortcut. */
export function isTextScalar(code: number): boolean {
  return (
    Number.isInteger(code) &&
    code >= 0x20 &&
    code <= 0x10ffff &&
    !(code >= 0x7f && code <= 0x9f) &&
    !(code >= 0xd800 && code <= 0xdfff) &&
    code !== 0x2028 &&
    code !== 0x2029
  );
}

export const textInputSchema = z
  .object({
    type: z.literal('text'),
    text: z
      .string()
      .min(1)
      .max(2)
      .refine(
        (text) => [...text].length === 1 && isTextScalar(text.codePointAt(0)!),
        'One non-control Unicode scalar required',
      ),
  })
  .strict();

export const textInputResultSchema = z
  .object({
    schema_version: z.literal('0.1'),
    source: z.literal('REAL'),
    capability: z.literal('RUNTIME_INPUT_INJECTION'),
    runtime: z.literal(true),
    type: z.literal('text'),
    unicode: z.number().refine(isTextScalar, 'Invalid committed Unicode scalar'),
    accepted: z.literal(true),
  })
  .strict();

export function validateTextInput(params: Record<string, unknown>) {
  const parsed = textInputSchema.safeParse(params);
  if (!parsed.success)
    throw new WheelError('INVALID_ARGUMENT', 'Invalid bounded text input', { issues: parsed.error.issues });
  return parsed.data;
}

/** Acceptance is injection only; read the real focused control to prove consumption. */
export function validateTextObservation(params: Record<string, unknown>, result: Record<string, unknown>) {
  if (params.type !== 'text') {
    if (result.type === 'text')
      throw new WheelError('PROTOCOL_MISMATCH', 'Text observation does not belong to this input request');
    return;
  }
  const request = validateTextInput(params);
  const parsed = textInputResultSchema.safeParse(result);
  if (!parsed.success || parsed.data.unicode !== request.text.codePointAt(0))
    throw new WheelError('PROTOCOL_MISMATCH', 'Text observation does not match its exact scalar request');
}

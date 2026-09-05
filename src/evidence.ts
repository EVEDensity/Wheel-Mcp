import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SENSITIVE_KEY = /(key|token|secret|password|credential|authorization)/i;

export async function createEvidenceEnvelope(directory: string | undefined, metadata: Record<string, unknown> = {}) {
  if (!directory) return null;
  const root = path.resolve(directory);
  await mkdir(root, { recursive: true });
  const envelope = {
    schema_version: '0.1',
    source: 'REAL',
    created_at: new Date().toISOString(),
    ...metadata,
    directory: root,
    requests: path.join(root, 'requests.jsonl'),
    responses: path.join(root, 'responses.jsonl'),
  };
  await writeFile(path.join(root, 'envelope.json'), JSON.stringify(envelope, null, 2));
  return {
    directory: root,
    async request(value: unknown): Promise<void> {
      await appendFile(
        envelope.requests,
        `${JSON.stringify({ at: new Date().toISOString(), direction: 'request', payload: redact(value) })}\n`,
      );
    },
    async response(value: unknown): Promise<void> {
      await appendFile(
        envelope.responses,
        `${JSON.stringify({ at: new Date().toISOString(), direction: 'response', payload: redact(value) })}\n`,
      );
    },
  };
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(item)]),
    );
  }
  return value;
}

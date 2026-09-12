import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type EvidenceProfile = 'PROCESS_EVIDENCE' | 'BRIDGE_EVIDENCE';

export type EvidenceManifest = {
  schema_version: '0.1';
  source: 'REAL';
  profile: EvidenceProfile;
  evidence_dir: string;
  created_at: string;
  finished_at?: string;
  lifecycle?: string;
  request_file: string;
  response_file: string;
  process_file: string;
  stdout_file: string;
  stderr_file: string;
  events_file: string;
  process_tree?: Record<string, unknown>;
};

const SENSITIVE_KEY = /(key|token|secret|password|credential|authorization)/i;

export async function createEvidenceEnvelope(directory: string | undefined, metadata: Record<string, unknown> = {}) {
  if (!directory) return null;
  const root = path.resolve(directory);
  await mkdir(root, { recursive: true });
  await ensureEvidenceManifest(root, 'PROCESS_EVIDENCE', metadata);
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

export async function ensureEvidenceManifest(
  directory: string,
  profile: EvidenceProfile,
  metadata: Record<string, unknown> = {},
): Promise<EvidenceManifest> {
  const root = path.resolve(directory);
  await mkdir(root, { recursive: true });
  const manifest: EvidenceManifest = {
    schema_version: '0.1',
    source: 'REAL',
    profile,
    evidence_dir: root,
    created_at: new Date().toISOString(),
    request_file: path.join(root, 'request.json'),
    response_file: path.join(root, 'response.json'),
    process_file: path.join(root, 'process.json'),
    stdout_file: path.join(root, 'stdout.log'),
    stderr_file: path.join(root, 'stderr.log'),
    events_file: path.join(root, 'events.jsonl'),
    ...(metadata as Partial<EvidenceManifest>),
  };
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function finalizeBridgeEvidence(
  directory: string,
  request: unknown,
  response: unknown,
  process: { exitCode: number | null; stdout: string; stderr: string },
): Promise<void> {
  const root = path.resolve(directory);
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as EvidenceManifest;
  const finishedAt = new Date().toISOString();
  await writeFile(manifest.request_file, JSON.stringify(request, null, 2));
  await writeFile(manifest.response_file, JSON.stringify(response, null, 2));
  await writeFile(manifest.stdout_file, process.stdout);
  await writeFile(manifest.stderr_file, process.stderr);
  await writeFile(
    manifest.process_file,
    JSON.stringify(
      {
        schema_version: '0.1',
        source: 'REAL',
        started: true,
        started_at: manifest.created_at,
        finished_at: finishedAt,
        exit_code: process.exitCode,
        lifecycle: process.exitCode === 0 ? 'EXITED' : 'FAILED',
        timed_out: false,
        cancelled: false,
        stdout: manifest.stdout_file,
        stderr: manifest.stderr_file,
      },
      null,
      2,
    ),
  );
  await writeFile(
    manifestPath,
    JSON.stringify(
      { ...manifest, finished_at: finishedAt, lifecycle: process.exitCode === 0 ? 'EXITED' : 'FAILED' },
      null,
      2,
    ),
  );
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

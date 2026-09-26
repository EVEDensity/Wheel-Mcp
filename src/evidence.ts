import { appendFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
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
  // Only BRIDGE_EVIDENCE runs exchange a request/response and stream events.
  request_file?: string;
  response_file?: string;
  process_file: string;
  stdout_file: string;
  stderr_file: string;
  events_file?: string;
  process_tree?: Record<string, unknown>;
};

const SENSITIVE_KEY = /(key|token|secret|password|credential|authorization)/i;

export async function writeEvidenceJson(file: string, value: unknown): Promise<void> {
  const staged = file + '.' + randomUUID() + '.tmp';
  try {
    const handle = await open(staged, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(value, null, 2));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(staged, file);
  } finally {
    await unlink(staged).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

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
    ...(profile === 'BRIDGE_EVIDENCE'
      ? { request_file: path.join(root, 'request.json'), response_file: path.join(root, 'response.json') }
      : {}),
    process_file: path.join(root, 'process.json'),
    stdout_file: path.join(root, 'stdout.log'),
    stderr_file: path.join(root, 'stderr.log'),
    ...(profile === 'BRIDGE_EVIDENCE' ? { events_file: path.join(root, 'events.jsonl') } : {}),
    ...(metadata as Partial<EvidenceManifest>),
  };
  await writeEvidenceJson(path.join(root, 'manifest.json'), manifest);
  return manifest;
}

export async function finalizeBridgeEvidence(
  directory: string,
  request: unknown,
  response: unknown,
  process: {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    signal?: NodeJS.Signals | null;
    code?: 'OK' | 'TIMEOUT' | 'CANCELLED' | 'FAILED';
    timed_out?: boolean;
    cancelled?: boolean;
    started?: boolean;
    evidence_status?: 'COMPLETE' | 'INCOMPLETE';
    evidence_error?: string;
  },
): Promise<void> {
  const root = path.resolve(directory);
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as EvidenceManifest;
  const finishedAt = new Date().toISOString();
  const requestFile = manifest.request_file ?? path.join(root, 'request.json');
  // Preserve the exact request already sent, including query limits and filters.
  if (!(await stat(requestFile).catch(() => null))) await writeFile(requestFile, JSON.stringify(request, null, 2));
  const responseFile = manifest.response_file ?? path.join(root, 'response.json');
  if (response !== null && response !== undefined) await writeFile(responseFile, JSON.stringify(response, null, 2));
  // A continuously written log must not be replaced by its bounded memory tail.
  if (!(await stat(manifest.stdout_file).catch(() => null))) await writeFile(manifest.stdout_file, process.stdout);
  if (!(await stat(manifest.stderr_file).catch(() => null))) await writeFile(manifest.stderr_file, process.stderr);
  const lifecycle =
    process.timed_out || process.code === 'TIMEOUT'
      ? 'TIMEOUT'
      : process.cancelled || process.code === 'CANCELLED'
        ? 'CANCELLED'
        : process.code === 'FAILED' || process.exitCode !== 0
          ? 'FAILED'
          : 'EXITED';
  await writeEvidenceJson(manifest.process_file, {
    schema_version: '0.1',
    source: 'REAL',
    started: process.started !== false,
    started_at: manifest.created_at,
    finished_at: finishedAt,
    exit_code: process.exitCode,
    signal: process.signal ?? null,
    lifecycle,
    timed_out: lifecycle === 'TIMEOUT',
    cancelled: lifecycle === 'CANCELLED',
    evidence_status: process.evidence_status ?? 'COMPLETE',
    ...(process.evidence_error ? { evidence_error: process.evidence_error } : {}),
    stdout: manifest.stdout_file,
    stderr: manifest.stderr_file,
  });
  const artifacts: Record<string, { status: 'GENERATED' | 'NOT_GENERATED'; path: string; sha256?: string }> = {};
  for (const name of ['request.json', 'response.json', 'events.jsonl', 'process.json', 'stdout.log', 'stderr.log']) {
    const target = path.join(root, name);
    const bytes = await readFile(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    artifacts[name] =
      bytes === null
        ? { status: 'NOT_GENERATED', path: target }
        : { status: 'GENERATED', path: target, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  await writeEvidenceJson(manifestPath, { ...manifest, finished_at: finishedAt, lifecycle, artifacts });
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

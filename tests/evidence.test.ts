import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEvidenceEnvelope } from '../src/evidence.js';

test('Evidence Envelope writes request/response JSONL and redacts secrets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'godot-mcp-evidence-'));
  const envelope = await createEvidenceEnvelope(root, { run_id: 'test-run' });
  await envelope.request({ method: 'tools/call', params: { api_key: 'hidden', value: 1 } });
  await envelope.response({ jsonrpc: '2.0', id: 1, result: { status: 'PASS' } });
  const requests = await readFile(path.join(root, 'requests.jsonl'), 'utf8');
  const responses = await readFile(path.join(root, 'responses.jsonl'), 'utf8');
  assert.match(requests, /\[REDACTED\]/);
  assert.doesNotMatch(requests, /hidden/);
  assert.match(responses, /"status":"PASS"/);
});

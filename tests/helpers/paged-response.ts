import assert from 'node:assert/strict';

export function responseBody(response: unknown): Record<string, unknown> {
  assert.ok(response && typeof response === 'object');
  const raw = response as Record<string, unknown>;
  if (raw.structuredContent !== undefined) {
    assert.ok(
      raw.structuredContent && typeof raw.structuredContent === 'object' && !Array.isArray(raw.structuredContent),
    );
    return raw.structuredContent as Record<string, unknown>;
  }
  assert.ok(Array.isArray(raw.content), 'Expected an immediate tool response, not a deferred task');
  const text = raw.content.find((c) => c?.type === 'text')?.text;
  assert.equal(typeof text, 'string', 'Missing JSON tool response');
  const body = JSON.parse(text);
  assert.ok(body && typeof body === 'object' && !Array.isArray(body));
  return body;
}
/** Test client only: consume a frozen snapshot, NEVER redispatch the original (possibly mutating) tool. */
export async function completeResponse(
  initial: Record<string, unknown>,
  readPage: (ref: string, cursor: number) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  if (initial.encoding !== 'json' || typeof initial.chunk !== 'string') return initial;
  const chunks: string[] = [];
  let page = initial,
    bytes = 0,
    ref: string | undefined,
    total: number | undefined;
  for (let count = 0; ; count++) {
    assert.ok(count < 32768, 'Response snapshot page-count limit');
    assert.notEqual(page.status, 'FAIL', 'Failed snapshot is not a successful response');
    assert.equal(page.encoding, 'json');
    assert.equal(typeof page.chunk, 'string');
    const chunk = page.chunk as string;
    assert.ok(Buffer.byteLength(chunk) > 0, 'Empty snapshot page');
    chunks.push(chunk);
    bytes += Buffer.byteLength(chunk);
    assert.ok(bytes <= 16 * 1024 * 1024, 'Response snapshot byte limit');
    const next = page.continuation as { ref: string; cursor: number; totalBytes: number } | null;
    if (next === null) {
      assert.equal(page.truncated, false);
      if (total !== undefined) assert.equal(bytes, total, 'Snapshot must be complete');
      const body = JSON.parse(chunks.join(''));
      assert.ok(body && typeof body === 'object' && !Array.isArray(body));
      assert.notEqual(body.status, 'FAIL');
      return body;
    }
    assert.ok(next && typeof next.ref === 'string' && next.ref);
    assert.equal(page.truncated, true);
    assert.equal(next.cursor, bytes, 'Snapshot cursor must advance by UTF-8 bytes');
    assert.ok(Number.isSafeInteger(next.totalBytes) && next.totalBytes > bytes && next.totalBytes <= 16 * 1024 * 1024);
    ref ??= next.ref;
    total ??= next.totalBytes;
    assert.equal(next.ref, ref, 'Snapshot owner/reference must not change');
    assert.equal(next.totalBytes, total, 'Snapshot size must not change');
    page = await readPage(ref, bytes);
  }
}

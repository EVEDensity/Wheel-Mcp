import { run } from 'node:test';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import reporter from './json-test-reporter.mjs';

// The CLI alphabetically sorts explicit file arguments. The public run({files})
// API preserves this declared queue, so expensive isolated files can start first.
const { files, concurrency } = JSON.parse(process.argv[2]);
if (
  !Array.isArray(files) ||
  files.length === 0 ||
  files.length > 64 ||
  files.some((file) => typeof file !== 'string' || file.length > 4096) ||
  new Set(files).size !== files.length ||
  ![1, 2].includes(concurrency)
) {
  throw new Error('Expected an explicit bounded test queue and concurrency 1..2');
}
const started = Date.now();
const normalize = (file) => {
  const resolved = path.resolve(file).replaceAll('\\', '/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};
const progress = {
  runId: process.env.WHEEL_RELEASE_RUN_ID ?? null,
  concurrency,
  finalSummaryReceived: false,
  files: files.map((file) => ({
    file,
    events: 0,
    firstEventMs: null,
    lastEventMs: null,
    lastEvent: null,
    lastTest: null,
    summary: null,
  })),
};
const byPath = new Map(progress.files.map((record) => [normalize(record.file), record]));
function record(type, data) {
  if (type === 'test:summary' && data.file === undefined) progress.finalSummaryReceived = true;
  const file = data.entryFile ?? data.file;
  const item = typeof file === 'string' ? byPath.get(normalize(file)) : undefined;
  if (item) {
    item.events++;
    item.firstEventMs ??= Date.now() - started;
    item.lastEventMs = Date.now() - started;
    item.lastEvent = type;
    item.lastTest = String(data.name ?? '').slice(0, 160);
    if (type === 'test:summary') item.summary = { counts: data.counts, durationMs: data.duration_ms };
  }
  if (process.env.WHEEL_CI_PROGRESS_PATH)
    writeFileSync(process.env.WHEEL_CI_PROGRESS_PATH, JSON.stringify(progress, null, 2));
}
const events = run({ files, concurrency });
for (const type of ['test:dequeue', 'test:complete', 'test:summary']) events.on(type, (data) => record(type, data));
events.on('test:fail', () => {
  process.exitCode = 1;
});
for await (const chunk of reporter(events)) {
  if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
}
// Never force exit: leaked workers/handles must still hit the enclosing deadline.

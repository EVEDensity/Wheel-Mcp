import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { sourceIdentity, sha256 } from './lib/production-manifest.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
if (args.length > 1 || (args.length && !['--smoke', '--probe-10k'].includes(args[0])))
  throw new Error('usage: benchmark-context.mjs [--smoke | --probe-10k]; no flag = five-repeat full workload');
const mode = args[0] === '--smoke' ? 'smoke' : args[0] === '--probe-10k' ? 'probe-10k' : 'full';
const startedAt = new Date().toISOString();
const runDir = path.join(root, 'runs/production-roadmap/T26', startedAt.replace(/[:.]/g, '-') + '-' + process.pid);
await mkdir(runDir, { recursive: true });
process.env.GODOT_HARNESS_RUN_REGISTRY_PATH = path.join(runDir, 'test-run-registry.json');
const report = {
  schemaVersion: 1, taskId: 'T26', mode, startedAt, status: 'RUNNING',
  scope: 'Synthetic identifier retrieval and index/context performance; not customer benefit or G4 qualification',
  environment: { node: process.version, platform: process.platform, release: os.release(), arch: process.arch,
    cpus: os.cpus().length, cpu: os.cpus()[0]?.model, totalMemory: os.totalmem(),
    diskCache: 'OS cache not flushed; cold means a new in-process index instance', forcedGC: false },
  thresholds: { warm10kP95Ms: 500, incremental10kP95Ms: 2000, cold10kMs: 60000, cold50kMs: 300000, hitRate: 0.95, maxBytes: 32768 },
  rounds: [], failures: [], cleanup: [], qualification: 'NOT_QUALIFIED',
};
const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
const saveReport = () => writeFile(path.join(runDir, 'results.json'), JSON.stringify(report, null, 2));
await saveReport();
try {
  report.source = await sourceIdentity(root);
  const buildStart = performance.now();
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root], { cwd: root, stdio: 'inherit' });
  report.build = { status: 'PASS', durationMs: performance.now() - buildStart };
  const { generateContextCorpus, CONTEXT_CORPUS } = await import('../build/tests/helpers/context-corpus.js');
  const { getProjectIndex, ProjectIndex } = await import('../build/src/index/project-index.js');
  const { searchProject } = await import('../build/src/godot-development.js');
  const { buildContextPack } = await import('../build/src/context-pack.js');
  const { createTimeoutContext } = await import('../build/src/timeout.js');
  const { readResponsePage } = await import('../build/src/response-budget.js');
  const sizes = mode === 'smoke' ? [1000] : mode === 'probe-10k' ? [10000] : [...CONTEXT_CORPUS.sizes];
  report.workload = { ...CONTEXT_CORPUS, sizes, repeats: mode === 'full' ? 5 : 1,
    warmQueries: mode === 'full' ? { '1000': 30, '10000': 200, '50000': 30 } : 12,
    modifications: mode === 'full' ? { '1000': 10, '10000': 100, '50000': 10 } : 5 };
  report.workloadHash = sha256(JSON.stringify({ workload: report.workload, thresholds: report.thresholds }));
  await saveReport(); // Thresholds and parameters persisted before the first measurement.
  const parent = await realpath(os.tmpdir());
  for (const size of sizes) for (let repeat = 0; repeat < report.workload.repeats; repeat++) {
    const scratch = await mkdtemp(path.join(parent, 'wheel-t26-benchmark-'));
    let index;
    const round = { size, repeat, status: 'RUNNING', failures: [], measurements: {} };
    report.rounds.push(round);
    let peakRss = process.memoryUsage().rss;
    const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 20);
    try {
      console.log(`T26 ${mode}: ${size} files, round ${repeat + 1}, generating`);
      const corpus = await generateContextCorpus(scratch, size);
      round.corpus = corpus;
      await writeFile(path.join(runDir, `corpus-${size}-${repeat}.json`), JSON.stringify(corpus, null, 2));
      const fail = (name, detail) => { round.failures.push({ name, detail }); };
      const cold = new ProjectIndex(scratch);
      let start = performance.now();
      const snapshot = await cold.refresh();
      round.measurements.coldMs = performance.now() - start;
      if (snapshot.files.length !== size) fail('fileCount', snapshot.files.length);
      if (size === 10000 && round.measurements.coldMs > report.thresholds.cold10kMs) fail('cold10k', round.measurements.coldMs);
      if (size === 50000 && round.measurements.coldMs > report.thresholds.cold50kMs) fail('cold50k', round.measurements.coldMs);
      cold.stopWatching();
      index = await getProjectIndex(scratch);
      await index.refresh(); // Separate production cache warm-up, excluded from warm samples.
      const quality = [];
      for (const q of corpus.questions) {
        const result = await searchProject(scratch, q.query, { maxResults: CONTEXT_CORPUS.topK });
        const actualFile = result.results.find(item => item.path === q.expectedFile)?.path;
        const file = snapshot.files.find(item => item.path === actualFile);
        const metadataCorrect = q.kind === 'file' || (q.kind === 'symbol' ? file?.metadata.symbols : file?.metadata.nodes)?.some(item => item.name === q.expectedName);
        quality.push({ id: q.id, hit: Boolean(actualFile && metadataCorrect), results: result.results.map(item => ({ path: item.path, line: item.line })) });
      }
      round.quality = { total: quality.length, hits: quality.filter(item => item.hit).length, topK: CONTEXT_CORPUS.topK, samples: quality };
      round.quality.hitRate = round.quality.hits / round.quality.total;
      if (round.quality.hitRate < report.thresholds.hitRate) fail('retrievalQuality', round.quality);
      const warm = [], bytes = [];
      const count = mode === 'full' ? report.workload.warmQueries[size] : report.workload.warmQueries;
      for (let i = 0; i < count; i++) {
        const q = corpus.questions[i % corpus.questions.length];
        start = performance.now();
        const result = await searchProject(scratch, q.query, { maxResults: CONTEXT_CORPUS.topK });
        warm.push(performance.now() - start);
        bytes.push(Buffer.byteLength(JSON.stringify(result)));
        if (bytes.at(-1) > CONTEXT_CORPUS.maxBytes) fail('searchBytes', bytes.at(-1));
      }
      round.measurements.warm = { samplesMs: warm, p95Ms: p95(warm), responseBytes: bytes };
      if (size === 10000 && p95(warm) > report.thresholds.warm10kP95Ms) fail('warm10k', p95(warm));
      const modifications = mode === 'full' ? report.workload.modifications[size] : report.workload.modifications;
      const target = corpus.questions.find(q => q.kind === 'symbol');
      const original = await readFile(path.join(scratch, target.expectedFile), 'utf8');
      const incremental = [];
      for (let i = 0; i < modifications; i++) {
        const updated = original + `# update_${i}\n`;
        const expectedHash = sha256(updated);
        await writeFile(path.join(scratch, target.expectedFile), updated);
        start = performance.now();
        const result = await searchProject(scratch, target.query, { maxResults: CONTEXT_CORPUS.topK });
        const actual = index.readSnapshot().files.find(file => file.path === target.expectedFile);
        incremental.push(performance.now() - start);
        if (actual?.sha256 !== expectedHash || !result.results.some(item => item.path === target.expectedFile)) fail('incrementalCorrectness', i);
      }
      round.measurements.incremental = { samplesMs: incremental, p95Ms: p95(incremental) };
      if (size === 10000 && p95(incremental) > report.thresholds.incremental10kP95Ms) fail('incremental10k', p95(incremental));
      // The actual search output supplies Context Pack input, not an expected answer.
      const located = await searchProject(scratch, target.query, { maxResults: CONTEXT_CORPUS.topK });
      const locatedFile = located.results[0]?.path;
      if (!locatedFile) throw new Error('Search did not supply a Context Pack target');
      const pack = await buildContextPack({ projectPath: scratch, evidenceDir: path.join(scratch, '.harness'), targets: [locatedFile], fields: ['snippets'], maxBytes: 1024 });
      let page = pack, chunks = '', pages = 0, largestPage = 0;
      for (;;) {
        const length = Buffer.byteLength(JSON.stringify(page));
        largestPage = Math.max(largestPage, length); pages++;
        if (length > 1024) fail('contextPageBytes', length);
        if (typeof page.chunk !== 'string') break;
        chunks += page.chunk;
        if (!page.continuation) { JSON.parse(chunks); break; }
        if (pages > 1000) throw new Error('Context pagination did not terminate');
        page = readResponsePage(page.continuation.ref, page.continuation.cursor);
      }
      round.measurements.context = { pages, largestPage, reconstructed: chunks.length > 0 };
      const timeout = createTimeoutContext(60000);
      const pending = index.refresh(timeout);
      await new Promise(resolve => setTimeout(resolve, 10));
      start = performance.now(); timeout.cancel('T26 cancellation probe');
      try { await pending; fail('cancelRejected', 'refresh unexpectedly completed'); }
      catch (error) { if (error.code !== 'CANCELLED') fail('cancelCode', error.code); }
      finally { timeout.dispose(); }
      round.measurements.cancelMs = performance.now() - start;
      round.status = round.failures.length ? 'FAIL' : 'PASS';
      console.log(`T26 ${size}: ${round.status}; cold=${round.measurements.coldMs.toFixed(1)}ms warm-p95=${p95(warm).toFixed(1)}ms hits=${round.quality.hits}/30`);
    } catch (error) {
      round.status = 'FAIL'; round.failures.push({ name: 'exception', code: error.code, message: error.message, stack: error.stack });
    } finally {
      clearInterval(sampler); index?.stopWatching();
      round.measurements.peakRssBytes = Math.max(peakRss, process.memoryUsage().rss);
      round.measurements.processPeakRssBytes = process.resourceUsage().maxRSS * 1024;
      const actual = await realpath(scratch);
      if (path.dirname(actual) !== parent || !path.basename(actual).startsWith('wheel-t26-benchmark-')) throw new Error('Refusing unowned corpus cleanup');
      await rm(actual, { recursive: true, force: true });
      report.cleanup.push({ size, repeat, status: 'PASS', target: 'owned generated temporary corpus only' });
      await saveReport();
    }
  }
  report.sourceUnchanged = (await sourceIdentity(root)).sourceHash === report.source.sourceHash;
  if (!report.sourceUnchanged) report.failures.push({ name: 'sourceChanged' });
  report.status = report.failures.length || report.rounds.some(round => round.status !== 'PASS') ? 'FAIL' : mode === 'full' ? 'BENCHMARK_PASS' : 'SMOKE_PASS';
} catch (error) {
  report.status = 'FAIL'; report.failures.push({ name: 'exception', code: error.code, message: error.message, stack: error.stack });
} finally {
  report.finishedAt = new Date().toISOString();
  await saveReport();
  console.log(JSON.stringify({ status: report.status, mode, runDir: path.relative(root, runDir), sourceHash: report.source?.sourceHash }));
  if (report.status === 'FAIL') process.exitCode = 1;
}

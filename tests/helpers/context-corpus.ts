import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const CONTEXT_CORPUS = Object.freeze({
  revision: 1,
  seed: 260925,
  sizes: [1000, 10000, 50000] as const,
  nodeCounts: [32, 256, 2048] as const,
  eventCount: 12000,
  topK: 5,
  maxBytes: 32768,
});
export type RetrievalQuestion = {
  id: string;
  kind: 'file' | 'symbol' | 'node';
  query: string;
  expectedFile: string;
  expectedName: string;
};
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

/** Test-only synthetic workload; answer metadata is never passed to the search implementation. */
export async function generateContextCorpus(root: string, fileCount: number, seed: number = CONTEXT_CORPUS.seed) {
  const sizeIndex = CONTEXT_CORPUS.sizes.indexOf(fileCount as 1000 | 10000 | 50000);
  if (sizeIndex < 0 || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('Corpus size or seed is outside the frozen workload');
  const nodeCount = CONTEXT_CORPUS.nodeCounts[sizeIndex];
  const entries: { path: string; bytes: number; sha256: string }[] = [];
  const save = async (relative: string, text: string, indexed = true) => {
    await writeFile(path.join(root, relative), text);
    if (indexed) entries.push({ path: relative, bytes: Buffer.byteLength(text), sha256: digest(text) });
  };
  for (let bucket = 0; bucket < 100; bucket++)
    await mkdir(path.join(root, `scripts/b${String(bucket).padStart(2, '0')}`), { recursive: true });
  await mkdir(path.join(root, '.harness'), { recursive: true });
  await save('project.godot', '[application]\nconfig/name="T26 synthetic corpus"\nrun/main_scene="res://main.tscn"\n');
  const scriptPath = (id: number) =>
    `scripts/b${String(id % 100).padStart(2, '0')}/unit_${String(id).padStart(5, '0')}.gd`;
  for (let id = 0; id < fileCount - 2; id++) {
    // Stable varied sizes, Chinese and escaped strings; no absolute-path content.
    const padding = '# ' + 'context fixture '.repeat(1 + (((Math.imul(id + 1, 1664525) + seed) >>> 0) % 40));
    await save(
      scriptPath(id),
      `extends Node\n# file_marker_${id}_${seed}\n${padding}\nvar label = ${JSON.stringify(`测试 ${id} "quoted"`)}\nfunc symbol_${id}_${seed}():\n\treturn ${id}\n`,
    );
  }
  const nodes = [
    '[gd_scene load_steps=2 format=3]',
    `[ext_resource type="Script" path="res://${scriptPath(0)}" id="1"]`,
    '[node name="Root" type="Node"]',
    'script = ExtResource("1")',
  ];
  for (let id = 0; id < nodeCount; id++) nodes.push(`[node name="node_${id}_${seed}" type="Node" parent="."]`);
  await save('main.tscn', nodes.join('\n') + '\n');
  const events =
    Array.from({ length: CONTEXT_CORPUS.eventCount }, (_, i) =>
      JSON.stringify({ seq: i, type: 'frame', detail: '测试事件', value: i % 17 }),
    ).join('\n') + '\n';
  const errors =
    Array.from(
      { length: CONTEXT_CORPUS.eventCount },
      (_, i) => `ERROR: synthetic diagnostic ${i} at res://${scriptPath(i % (fileCount - 2))}:5`,
    ).join('\n') + '\n';
  await save('.harness/events.jsonl', events, false);
  await save('.harness/stderr.log', errors, false);
  const questions: RetrievalQuestion[] = [];
  for (let i = 0; i < 10; i++) {
    const id = (Math.imul(i + 1, 7919) + seed) % (fileCount - 2);
    const nodeId = (i * 23 + seed) % nodeCount;
    questions.push({
      id: `file-${i}`,
      kind: 'file',
      query: `file_marker_${id}_${seed}`,
      expectedFile: scriptPath(id),
      expectedName: `file_marker_${id}_${seed}`,
    });
    questions.push({
      id: `symbol-${i}`,
      kind: 'symbol',
      query: `symbol_${id}_${seed}`,
      expectedFile: scriptPath(id),
      expectedName: `symbol_${id}_${seed}`,
    });
    questions.push({
      id: `node-${i}`,
      kind: 'node',
      query: `node_${nodeId}_${seed}`,
      expectedFile: 'main.tscn',
      expectedName: `node_${nodeId}_${seed}`,
    });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    revision: CONTEXT_CORPUS.revision,
    seed,
    fileCount,
    nodeCount,
    eventCount: CONTEXT_CORPUS.eventCount,
    indexedBytes: entries.reduce((n, e) => n + e.bytes, 0),
    fileSizeRange: { min: Math.min(...entries.map((e) => e.bytes)), max: Math.max(...entries.map((e) => e.bytes)) },
    contentHash: digest(JSON.stringify(entries)),
    questionsHash: digest(JSON.stringify(questions)),
    eventsHash: digest(events),
    errorsHash: digest(errors),
    questions,
  };
}

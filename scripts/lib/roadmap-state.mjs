import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const hash = (data) => createHash('sha256').update(data).digest('hex');
const validTime = (value) =>
  typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));

export async function validateRoadmapState(state, markdown, root) {
  const errors = [];
  const fail = (message) => errors.push(message);
  const titles = [...markdown.matchAll(/^### (T\d{2}) (.+)$/gm)];
  if (state.schemaVersion !== 1 || !Array.isArray(state.tasks) || !Array.isArray(state.gates)) {
    return ['invalid roadmap state structure'];
  }
  if (titles.length !== 36 || state.tasks.length !== 36) fail('roadmap must contain 36 tasks');
  const byId = new Map();
  let inProgress = 0;
  let firstPendingSeen = false;
  for (const [index, task] of state.tasks.entries()) {
    const expectedId = `T${String(index).padStart(2, '0')}`;
    if (task.id !== expectedId || byId.has(task.id)) fail(`task order/duplicate at ${index}: ${task.id}`);
    if (titles[index]?.[1] !== task.id || titles[index]?.[2] !== task.title)
      fail(`${task.id}: title differs from roadmap`);
    if (!['todo', 'in_progress', 'blocked', 'done'].includes(task.status)) fail(`${task.id}: invalid status`);
    if (task.status !== 'done' && !firstPendingSeen) firstPendingSeen = true;
    else if (firstPendingSeen && (task.status === 'done' || task.status === 'in_progress' || task.status === 'blocked'))
      fail(`${task.id}: task order violates strict sequence`);
    if (task.status === 'in_progress') {
      inProgress++;
      if (!task.notes?.trim()) fail(`${task.id}: in_progress lacks notes`);
    }
    if (
      task.status === 'blocked' &&
      (!task.blocker?.reason ||
        !task.blocker?.since ||
        !task.blocker?.unblockAction ||
        !Array.isArray(task.blocker?.attempts))
    )
      fail(`${task.id}: blocked lacks details`);
    for (const dep of task.dependencies ?? []) {
      const previous = byId.get(dep);
      if (!previous) fail(`${task.id}: missing or forward dependency ${dep}`);
      else if (task.status === 'done' && previous.status !== 'done') fail(`${task.id}: done before dependency ${dep}`);
    }
    if (task.status === 'done') {
      if (!validTime(task.completedAt) || task.blocker) fail(`${task.id}: invalid completion metadata`);
      if (!Array.isArray(task.evidence) || task.evidence.length === 0) fail(`${task.id}: done without evidence`);
      if (!Array.isArray(task.verification) || !task.verification.some((v) => v.required && v.status === 'PASS'))
        fail(`${task.id}: done without required PASS verification`);
      if (task.verification?.some((v) => v.required && v.status !== 'PASS'))
        fail(`${task.id}: required verification is not PASS`);
    }
    if (Array.isArray(task.evidence))
      for (const item of task.evidence) {
        if (
          !item.id ||
          !item.pathOrArchiveId ||
          !/^[a-f0-9]{64}$/.test(item.sha256 ?? '') ||
          !/^[a-f0-9]{64}$/.test(item.sourceHash ?? '') ||
          !validTime(item.createdAt) ||
          !['REAL', 'MOCK', 'MIXED'].includes(item.source)
        ) {
          fail(`${task.id}: malformed evidence`);
          continue;
        }
        try {
          const target = await realpath(path.resolve(root, item.pathOrArchiveId));
          const realRoot = await realpath(root);
          if (!target.startsWith(realRoot + path.sep)) throw new Error('outside repository');
          if (hash(await readFile(target)) !== item.sha256) throw new Error('hash mismatch');
        } catch (error) {
          fail(`${task.id}: evidence ${item.id} unavailable: ${error.message}`);
        }
      }
    if (Array.isArray(task.verification))
      for (const check of task.verification) {
        if (
          !check.name ||
          !check.command ||
          !check.kind ||
          !['PASS', 'FAIL', 'SKIP', 'NOT_RUN', 'EXPECTED_DEFECT'].includes(check.status) ||
          !('exitCode' in check) ||
          !check.evidenceId
        )
          fail(`${task.id}: malformed verification`);
        if (check.evidenceId && !task.evidence?.some((item) => item.id === check.evidenceId))
          fail(`${task.id}: verification evidence missing: ${check.evidenceId}`);
      }
    byId.set(task.id, task);
  }
  if (inProgress > 1) fail('multiple tasks in_progress');
  const firstPending = state.tasks.find((task) => task.status !== 'done')?.id ?? null;
  if (state.execution?.nextTask !== firstPending) fail(`nextTask must be ${firstPending}`);
  if (state.execution?.mode !== 'strict-sequential' || state.execution?.maxInProgress !== 1)
    fail('execution policy mismatch');
  if (state.gates.length !== 7) fail('roadmap must contain seven gates');
  for (const [index, gate] of state.gates.entries()) {
    const id = `G${index}`;
    const expectedTasks = state.tasks.filter((task) => task.phase === `P${index}`).map((task) => task.id);
    if (gate.id !== id || JSON.stringify(gate.tasks) !== JSON.stringify(expectedTasks))
      fail(`${id}: task grouping mismatch`);
    if (JSON.stringify(gate.predecessorGates) !== JSON.stringify(Array.from({ length: index }, (_, i) => `G${i}`)))
      fail(`${id}: predecessor gates mismatch`);
    if (!['NOT_RUN', 'PASS', 'FAIL', 'BLOCKED'].includes(gate.status)) fail(`${id}: invalid gate status`);
    if (
      gate.status === 'PASS' &&
      (!gate.tasks.every((taskId) => byId.get(taskId)?.status === 'done') ||
        !gate.sourceHash ||
        !gate.evidence?.length ||
        gate.predecessorGates.some((gateId) => state.gates.find((g) => g.id === gateId)?.status !== 'PASS'))
    )
      fail(`${id}: PASS without completed tasks/evidence/predecessors`);
    for (const item of gate.evidence ?? []) {
      if (
        !item.id ||
        !item.pathOrArchiveId ||
        !/^[a-f0-9]{64}$/.test(item.sha256 ?? '') ||
        !/^[a-f0-9]{64}$/.test(item.sourceHash ?? '') ||
        !validTime(item.createdAt) ||
        !['REAL', 'MOCK', 'MIXED'].includes(item.source)
      ) {
        fail(`${id}: malformed gate evidence`);
        continue;
      }
      if (gate.status === 'PASS' && item.sourceHash !== gate.sourceHash) fail(`${id}: gate evidence source mismatch`);
      try {
        const target = await realpath(path.resolve(root, item.pathOrArchiveId));
        const realRoot = await realpath(root);
        if (!target.startsWith(realRoot + path.sep)) throw new Error('outside repository');
        if (hash(await readFile(target)) !== item.sha256) throw new Error('hash mismatch');
      } catch (error) {
        fail(`${id}: gate evidence ${item.id} unavailable: ${error.message}`);
      }
    }
  }
  if (
    state.qualification?.status === 'QUALIFIED' &&
    (firstPending || state.gates.some((gate) => gate.status !== 'PASS'))
  )
    fail('qualification without all tasks and gates PASS');
  return errors;
}

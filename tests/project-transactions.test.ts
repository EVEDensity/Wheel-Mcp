import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ProjectTransactions } from '../src/project/transactions.js';
import { readProcessIdentity } from '../src/process-identity.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-transaction-'));
  await writeFile(path.join(root, 'one.gd'), 'one = 1\n');
  await writeFile(path.join(root, 'two.gd'), 'two = 2\n');
  return root;
}

test('prepare is dry-run for project files; server-owned approval binds the exact plan and supports idempotent apply', async () => {
  const root = await fixture();
  const approved: string[] = [];
  const tx = new ProjectTransactions({
    projectPath: root,
    verifyApproval: async (plan) => {
      approved.push(plan.planHash);
      assert.deepEqual(plan.impact, ['one.gd']);
      assert.match(plan.diffPreview, /one = 3/);
      return { actor: 'human-reviewer', receipt: `review-${plan.planHash}`, planHash: plan.planHash };
    },
  });
  const operation = {
    kind: 'replace' as const,
    path: 'one.gd',
    content: 'one = 3\n',
    expectedSha256: sha('one = 1\n'),
  };
  const plan = await tx.prepare([operation], 'review-one');
  assert.match(plan.diffPreview, /one = 1/);
  assert.equal(await readFile(path.join(root, 'one.gd'), 'utf8'), 'one = 1\n');
  assert.equal((await tx.inspect('review-one')).state, 'PREPARED');
  assert.equal((await tx.prepare([operation], 'review-one')).planHash, plan.planHash);
  await assert.rejects(() => tx.prepare([{ ...operation, content: 'different' }], 'review-one'), /conflicts/);
  await assert.rejects(() => tx.apply('review-one', async () => true), /lacks bound approval/);
  assert.equal((await tx.approve('review-one')).actor, 'human-reviewer');
  assert.deepEqual(approved, [plan.planHash]);
  assert.equal(await tx.apply('review-one', async () => true), 'COMMITTED');
  assert.equal((await tx.prepare([operation], 'review-one')).planHash, plan.planHash);
  assert.equal(
    await tx.apply('review-one', async () => {
      throw new Error('must not rerun');
    }),
    'COMMITTED',
  );
  assert.equal(await readFile(path.join(root, 'one.gd'), 'utf8'), 'one = 3\n');
});

test('exact edit extraction stages multiple matches as one hash-bound replacement', async () => {
  const root = await fixture();
  const tx = new ProjectTransactions({
    projectPath: root,
    verifyApproval: async (plan) => ({ actor: 'reviewer', receipt: 'receipt', planHash: plan.planHash }),
  });
  const edits = [
    { path: 'one.gd', find: '1', replace: '2', expectedSha256: sha('one = 1\n') },
    { path: 'one.gd', find: '2', replace: '3', expectedSha256: sha('one = 2\n') },
  ];
  const plan = await tx.prepareExactEdits(edits, 'exact-one');
  assert.equal(plan.changes.length, 1);
  assert.equal(await readFile(path.join(root, 'one.gd'), 'utf8'), 'one = 1\n');
  await tx.approve(plan.operationId);
  assert.equal(await tx.apply(plan.operationId, async () => true), 'COMMITTED');
  assert.equal(await readFile(path.join(root, 'one.gd'), 'utf8'), 'one = 3\n');
  assert.equal((await tx.prepareExactEdits(edits, 'exact-one')).planHash, plan.planHash);
  await assert.rejects(() => tx.prepareExactEdits([{ ...edits[0], replace: 'different' }], 'exact-one'), /conflicts/);
  await assert.rejects(
    () => tx.prepareExactEdits([{ path: 'two.gd', find: 'missing', replace: 'x', expectedSha256: sha('two = 2\n') }]),
    /match once/,
  );
});

test('two approved transactions serialize and the second cannot overwrite a changed input', async () => {
  const root = await fixture();
  const tx = new ProjectTransactions({
    projectPath: root,
    verifyApproval: async (plan) => ({ actor: 'reviewer', receipt: 'receipt', planHash: plan.planHash }),
  });
  const first = await tx.prepare([
    { kind: 'replace', path: 'one.gd', content: 'one = A\n', expectedSha256: sha('one = 1\n') },
  ]);
  const second = await tx.prepare([
    { kind: 'replace', path: 'one.gd', content: 'one = B\n', expectedSha256: sha('one = 1\n') },
  ]);
  await tx.approve(first.operationId);
  await tx.approve(second.operationId);
  const [winner, loser] = await Promise.allSettled([
    tx.apply(first.operationId, async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return true;
    }),
    tx.apply(second.operationId, async () => true),
  ]);
  assert.deepEqual([winner.status, loser.status].sort(), ['fulfilled', 'rejected']);
  assert.equal(
    await readFile(path.join(root, 'one.gd'), 'utf8'),
    winner.status === 'fulfilled' ? 'one = A\n' : 'one = B\n',
  );
});

test('unavailable process identity cannot reclaim a live project lock', async () => {
  const root = await fixture();
  const tx = new ProjectTransactions({
    projectPath: root,
    readLockOwnerIdentity: async () => null,
    verifyApproval: async (plan) => ({ actor: 'fixture-review', receipt: 'mock', planHash: plan.planHash }),
  });
  const plan = await tx.prepare([
    { kind: 'replace', path: 'one.gd', content: 'one = X\n', expectedSha256: sha('one = 1\n') },
  ]);
  await tx.approve(plan.operationId);
  const identity = await readProcessIdentity(process.pid);
  assert.ok(identity);
  const lock = path.join(root, '.harness', 'transactions', '.project.lock');
  await writeFile(lock, JSON.stringify({ pid: process.pid, identity }));
  try {
    await assert.rejects(
      tx.apply(plan.operationId, async () => true),
      /lock is busy/,
    );
    assert.equal(await readFile(path.join(root, 'one.gd'), 'utf8'), 'one = 1\n');
    assert.equal(JSON.parse(await readFile(lock, 'utf8')).pid, process.pid);
  } finally {
    await unlink(lock);
  }
});

for (const checkpoint of ['APPLYING', 'WRITE_0', 'APPLIED_0', 'WRITE_1', 'APPLIED_1', 'VALIDATING']) {
  test(`recovery from persisted checkpoint ${checkpoint} restores the complete two-file batch`, async () => {
    const root = await fixture();
    const tx = new ProjectTransactions({
      projectPath: root,
      verifyApproval: async (plan) => ({ actor: 'reviewer', receipt: 'receipt', planHash: plan.planHash }),
      checkpoint: async (name) => {
        if (name === checkpoint) throw new Error('simulated crash');
      },
    });
    const plan = await tx.prepare([
      { kind: 'replace', path: 'one.gd', content: 'one = X\n', expectedSha256: sha('one = 1\n') },
      { kind: 'replace', path: 'two.gd', content: 'two = X\n', expectedSha256: sha('two = 2\n') },
    ]);
    await tx.approve(plan.operationId);
    await assert.rejects(() => tx.apply(plan.operationId, async () => true), /simulated crash/);
    const restarted = new ProjectTransactions({ projectPath: root });
    assert.deepEqual(await restarted.recoverPending(), [{ operationId: plan.operationId, state: 'ROLLED_BACK' }]);
    assert.equal(await readFile(path.join(root, 'one.gd'), 'utf8'), 'one = 1\n');
    assert.equal(await readFile(path.join(root, 'two.gd'), 'utf8'), 'two = 2\n');
  });
}

test('transaction rejects stale approval inputs and unsafe targets without touching project files', async () => {
  const root = await fixture();
  const tx = new ProjectTransactions({
    projectPath: root,
    verifyApproval: async (plan) => ({ actor: 'reviewer', receipt: 'signed', planHash: plan.planHash }),
  });
  const plan = await tx.prepare([
    { kind: 'replace', path: 'one.gd', content: 'one = 9\n', expectedSha256: sha('one = 1\n') },
  ]);
  await tx.approve(plan.operationId);
  await writeFile(path.join(root, 'one.gd'), 'external edit\n');
  await assert.rejects(() => tx.apply(plan.operationId, async () => true), /changed after approval/);
  assert.equal(await readFile(path.join(root, 'one.gd'), 'utf8'), 'external edit\n');
  for (const unsafe of ['../outside.gd', '.git/config', '.godot/cache', '.harness/journal', 'one.gd:ads']) {
    await assert.rejects(() => tx.prepare([{ kind: 'create', path: unsafe, content: 'x' }]));
  }
  const outside = await mkdtemp(path.join(os.tmpdir(), 'wheel-tx-outside-'));
  await symlink(outside, path.join(root, 'portal'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    () => tx.prepare([{ kind: 'create', path: 'portal/escape.gd', content: 'x' }]),
    /links|junctions/,
  );
});

test('approval for a different plan is rejected even when a receipt and actor are present', async () => {
  const root = await fixture();
  const tx = new ProjectTransactions({
    projectPath: root,
    verifyApproval: async () => ({ actor: 'reviewer', receipt: 'receipt', planHash: '0'.repeat(64) }),
  });
  const plan = await tx.prepare([{ kind: 'create', path: 'new.gd', content: 'new\n' }]);
  await assert.rejects(() => tx.approve(plan.operationId), /not bound/);
  assert.equal((await tx.inspect(plan.operationId)).state, 'PREPARED');
  await assert.rejects(() => readFile(path.join(root, 'new.gd'), 'utf8'), /ENOENT/);
});

for (const checkpoint of ['ROLLING_BACK', 'ROLLBACK_1', 'ROLLBACK_0', 'ROLLED_BACK', 'COMMITTED']) {
  test(`restart after ${checkpoint} preserves or converges the journaled decision`, async () => {
    const root = await fixture();
    const tx = new ProjectTransactions({
      projectPath: root,
      verifyApproval: async (plan) => ({ actor: 'fixture-review', receipt: 'mock', planHash: plan.planHash }),
      checkpoint: async (name) => {
        if (name === checkpoint) throw new Error('checkpoint crash');
      },
    });
    const plan = await tx.prepare([
      { kind: 'replace', path: 'one.gd', content: 'one = X\n', expectedSha256: sha('one = 1\n') },
      { kind: 'replace', path: 'two.gd', content: 'two = X\n', expectedSha256: sha('two = 2\n') },
    ]);
    await tx.approve(plan.operationId);
    await assert.rejects(
      tx.apply(plan.operationId, async () => checkpoint === 'COMMITTED'),
      /checkpoint crash/,
    );
    const restarted = new ProjectTransactions({ projectPath: root });
    assert.equal(await restarted.recover(plan.operationId), checkpoint === 'COMMITTED' ? 'COMMITTED' : 'ROLLED_BACK');
    assert.equal(
      await readFile(path.join(root, 'one.gd'), 'utf8'),
      checkpoint === 'COMMITTED' ? 'one = X\n' : 'one = 1\n',
    );
    assert.equal(
      await readFile(path.join(root, 'two.gd'), 'utf8'),
      checkpoint === 'COMMITTED' ? 'two = X\n' : 'two = 2\n',
    );
  });
}

test(
  'actual Windows read-only second target failure restores the first file without bypassing disk permissions',
  {
    skip: process.platform !== 'win32',
  },
  async () => {
    const root = await fixture();
    const second = path.join(root, 'two.gd');
    const tx = new ProjectTransactions({
      projectPath: root,
      verifyApproval: async (plan) => ({ actor: 'fixture-review', receipt: 'mock', planHash: plan.planHash }),
    });
    const plan = await tx.prepare([
      { kind: 'replace', path: 'one.gd', content: 'one = X\n', expectedSha256: sha('one = 1\n') },
      { kind: 'replace', path: 'two.gd', content: 'two = X\n', expectedSha256: sha('two = 2\n') },
    ]);
    await tx.approve(plan.operationId);
    await chmod(second, 0o444);
    try {
      await assert.rejects(
        tx.apply(plan.operationId, async () => true),
        /mutation failed/,
      );
      assert.equal((await tx.inspect(plan.operationId)).state, 'ROLLED_BACK');
      assert.equal(await readFile(path.join(root, 'one.gd'), 'utf8'), 'one = 1\n');
      assert.equal(await readFile(second, 'utf8'), 'two = 2\n');
    } finally {
      await chmod(second, 0o666);
    }
  },
);

test('a corrupt on-disk journal cannot redirect recovery outside the project', async () => {
  const root = await fixture();
  const tx = new ProjectTransactions({ projectPath: root });
  const plan = await tx.prepare([{ kind: 'create', path: 'new.gd', content: 'new\n' }]);
  const journalPath = path.join(root, '.harness', 'transactions', plan.operationId, 'journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { mutations: Array<{ path: string }> };
  journal.mutations[0].path = '../outside.gd';
  await writeFile(journalPath, JSON.stringify(journal));
  await assert.rejects(() => tx.inspect(plan.operationId), /unsafe|invalid/);
  await assert.rejects(() => tx.recover(plan.operationId), /unsafe|invalid/);
  await assert.rejects(() => readFile(path.join(root, 'new.gd'), 'utf8'), /ENOENT/);
});

test('an incomplete pre-journal staging directory is preserved as an orphan and does not block retry', async () => {
  const root = await fixture();
  const tx = new ProjectTransactions({ projectPath: root });
  await tx.list();
  const transactions = path.join(root, '.harness', 'transactions');
  const partial = path.join(transactions, 'interrupted-prepare');
  await mkdir(partial);
  await writeFile(path.join(partial, '0.before'), 'partial backup');
  const plan = await tx.prepare([{ kind: 'create', path: 'new.gd', content: 'new\n' }], 'interrupted-prepare');
  assert.equal(plan.operationId, 'interrupted-prepare');
  const orphan = (await readdir(transactions)).find((name) => name.startsWith('.orphan-interrupted-prepare-'));
  assert.ok(orphan);
  assert.equal(await readFile(path.join(transactions, orphan, '0.before'), 'utf8'), 'partial backup');
});

test('a crash after stage fsync but before journal creation can be retried without target edits', async () => {
  const root = await fixture();
  const crashing = new ProjectTransactions({
    projectPath: root,
    checkpoint: async (name) => {
      if (name === 'STAGED') throw new Error('simulated preparation crash');
    },
  });
  const operation = {
    kind: 'replace' as const,
    path: 'one.gd',
    content: 'one = 9\n',
    expectedSha256: sha('one = 1\n'),
  };
  await assert.rejects(() => crashing.prepare([operation], 'prepare-crash'), /preparation crash/);
  assert.equal(await readFile(path.join(root, 'one.gd'), 'utf8'), 'one = 1\n');
  const restarted = new ProjectTransactions({ projectPath: root });
  assert.equal((await restarted.prepare([operation], 'prepare-crash')).operationId, 'prepare-crash');
  assert.equal((await restarted.inspect('prepare-crash')).state, 'PREPARED');
});

test('injected second-file I/O failure rolls back the first file and records a terminal state', async () => {
  const root = await fixture();
  const tx = new ProjectTransactions({
    projectPath: root,
    verifyApproval: async (plan) => ({ actor: 'reviewer', receipt: 'receipt', planHash: plan.planHash }),
    beforeMutation: async (index) => {
      if (index === 1) throw new Error('injected disk failure');
    },
  });
  const plan = await tx.prepare([
    { kind: 'replace', path: 'one.gd', content: 'one = 5\n', expectedSha256: sha('one = 1\n') },
    { kind: 'replace', path: 'two.gd', content: 'two = 5\n', expectedSha256: sha('two = 2\n') },
  ]);
  await tx.approve(plan.operationId);
  await assert.rejects(() => tx.apply(plan.operationId, async () => true), /recovery state ROLLED_BACK/);
  assert.equal((await tx.inspect(plan.operationId)).state, 'ROLLED_BACK');
  assert.equal(await readFile(path.join(root, 'one.gd'), 'utf8'), 'one = 1\n');
  assert.equal(await readFile(path.join(root, 'two.gd'), 'utf8'), 'two = 2\n');
});

test('cooperative cancellation converges the journal and rolls back before releasing the project lock', async () => {
  const root = await fixture();
  const abort = new AbortController();
  const tx = new ProjectTransactions({
    projectPath: root,
    verifyApproval: async (plan) => ({ actor: 'reviewer', receipt: 'receipt', planHash: plan.planHash }),
    checkpoint: async (name) => {
      if (name === 'APPLIED_0') abort.abort('user cancelled');
    },
  });
  const plan = await tx.prepare([
    { kind: 'replace', path: 'one.gd', content: 'one = 5\n', expectedSha256: sha('one = 1\n') },
    { kind: 'replace', path: 'two.gd', content: 'two = 5\n', expectedSha256: sha('two = 2\n') },
  ]);
  await tx.approve(plan.operationId);
  await assert.rejects(
    () => tx.apply(plan.operationId, async () => true, abort.signal),
    /cancelled; recovery state ROLLED_BACK/,
  );
  assert.equal((await tx.inspect(plan.operationId)).state, 'ROLLED_BACK');
  assert.equal(await readFile(path.join(root, 'one.gd'), 'utf8'), 'one = 1\n');
  assert.equal(await readFile(path.join(root, 'two.gd'), 'utf8'), 'two = 2\n');
});

test('create, delete and rename form one validated batch, then roll back on failed validation', async () => {
  const root = await fixture();
  const tx = new ProjectTransactions({
    projectPath: root,
    verifyApproval: async (plan) => ({ actor: 'reviewer', receipt: 'signed', planHash: plan.planHash }),
  });
  const plan = await tx.prepare([
    { kind: 'create', path: 'new.gd', content: 'new = true\n' },
    { kind: 'delete', path: 'two.gd', expectedSha256: sha('two = 2\n') },
    { kind: 'rename', from: 'one.gd', to: 'moved.gd', expectedSha256: sha('one = 1\n') },
  ]);
  await tx.approve(plan.operationId);
  assert.equal(await tx.apply(plan.operationId, async () => false), 'ROLLED_BACK');
  assert.equal(await readFile(path.join(root, 'one.gd'), 'utf8'), 'one = 1\n');
  assert.equal(await readFile(path.join(root, 'two.gd'), 'utf8'), 'two = 2\n');
  await assert.rejects(() => readFile(path.join(root, 'new.gd'), 'utf8'), /ENOENT/);
  await assert.rejects(() => readFile(path.join(root, 'moved.gd'), 'utf8'), /ENOENT/);
});

test('a validator exception rolls back the approved mutation before surfacing failure', async () => {
  const root = await fixture();
  const tx = new ProjectTransactions({
    projectPath: root,
    verifyApproval: async (plan) => ({ actor: 'reviewer', receipt: 'receipt', planHash: plan.planHash }),
  });
  const plan = await tx.prepare([
    { kind: 'replace', path: 'one.gd', content: 'one = 6\n', expectedSha256: sha('one = 1\n') },
  ]);
  await tx.approve(plan.operationId);
  await assert.rejects(
    () =>
      tx.apply(plan.operationId, async () => {
        throw new Error('engine unavailable');
      }),
    /recovery state ROLLED_BACK/,
  );
  assert.equal((await tx.inspect(plan.operationId)).state, 'ROLLED_BACK');
  assert.equal(await readFile(path.join(root, 'one.gd'), 'utf8'), 'one = 1\n');
});

test('ENOSPC injection preserves a recoverable terminal journal and cancellation keeps its stable error code', async () => {
  const root = await fixture();
  const tx = new ProjectTransactions({
    projectPath: root,
    verifyApproval: async (plan) => ({ actor: 'fixture-review', receipt: 'mock', planHash: plan.planHash }),
    beforeMutation: async (index) => {
      if (index === 1) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    },
  });
  const plan = await tx.prepare([
    { kind: 'replace', path: 'one.gd', content: 'one = X\n', expectedSha256: sha('one = 1\n') },
    { kind: 'replace', path: 'two.gd', content: 'two = X\n', expectedSha256: sha('two = 2\n') },
  ]);
  await tx.approve(plan.operationId);
  await assert.rejects(
    tx.apply(plan.operationId, async () => true),
    (error: unknown) => {
      assert.equal((error as { details: { operationId: string } }).details.operationId, plan.operationId);
      return true;
    },
  );
  assert.equal((await tx.inspect(plan.operationId)).state, 'ROLLED_BACK');
  assert.equal(await readFile(path.join(root, 'one.gd'), 'utf8'), 'one = 1\n');
  const controller = new AbortController();
  const cancelled = new ProjectTransactions({
    projectPath: root,
    verifyApproval: async (plan) => ({ actor: 'fixture-review', receipt: 'mock', planHash: plan.planHash }),
  });
  const next = await cancelled.prepare([
    { kind: 'replace', path: 'one.gd', content: 'one = X\n', expectedSha256: sha('one = 1\n') },
  ]);
  await cancelled.approve(next.operationId);
  await assert.rejects(
    cancelled.apply(
      next.operationId,
      async () => {
        controller.abort();
        return true;
      },
      controller.signal,
    ),
    (error: unknown) => (error as { code?: string }).code === 'CANCELLED',
  );
  assert.equal((await cancelled.inspect(next.operationId)).state, 'ROLLED_BACK');
});

test('a restarted service recovers a write-before-journal crash; conflicting user edits are preserved', async () => {
  const root = await fixture();
  const crash = new ProjectTransactions({
    projectPath: root,
    verifyApproval: async (plan) => ({ actor: 'reviewer', receipt: 'signed', planHash: plan.planHash }),
    checkpoint: async (name) => {
      if (name === 'WRITE_0') throw new Error('simulated crash');
    },
  });
  const plan = await crash.prepare([
    { kind: 'replace', path: 'one.gd', content: 'one = 8\n', expectedSha256: sha('one = 1\n') },
    { kind: 'replace', path: 'two.gd', content: 'two = 8\n', expectedSha256: sha('two = 2\n') },
  ]);
  await crash.approve(plan.operationId);
  await assert.rejects(() => crash.apply(plan.operationId, async () => true), /simulated crash/);
  const restarted = new ProjectTransactions({ projectPath: root });
  assert.equal(await restarted.recover(plan.operationId), 'ROLLED_BACK');
  assert.equal(await readFile(path.join(root, 'one.gd'), 'utf8'), 'one = 1\n');
  assert.equal(await readFile(path.join(root, 'two.gd'), 'utf8'), 'two = 2\n');

  const second = new ProjectTransactions({
    projectPath: root,
    verifyApproval: async (plan) => ({ actor: 'reviewer', receipt: 'signed', planHash: plan.planHash }),
    checkpoint: async (name) => {
      if (name === 'APPLIED_0') throw new Error('simulated crash');
    },
  });
  const other = await second.prepare([
    { kind: 'replace', path: 'one.gd', content: 'one = 7\n', expectedSha256: sha('one = 1\n') },
  ]);
  await second.approve(other.operationId);
  await assert.rejects(() => second.apply(other.operationId, async () => true), /simulated crash/);
  await writeFile(path.join(root, 'one.gd'), 'user work\n');
  assert.equal(await restarted.recover(other.operationId), 'CONFLICT');
  assert.equal(await readFile(path.join(root, 'one.gd'), 'utf8'), 'user work\n');
});

test('an already-approved plan cannot bypass a transaction interrupted during its approval wait', async () => {
  for (const ownerId of ['waiting-owner', 'another-owner']) {
    const root = await fixture();
    const verifyApproval = async (plan: { planHash: string }) => ({
      actor: 'fixture-review',
      receipt: 'mock',
      planHash: plan.planHash,
    });
    const waiting = new ProjectTransactions({ projectPath: root, ownerId: 'waiting-owner', verifyApproval });
    const next = await waiting.prepare([
      { kind: 'replace', path: 'two.gd', content: 'two = 9\n', expectedSha256: sha('two = 2\n') },
    ]);
    await waiting.approve(next.operationId);
    const interrupted = new ProjectTransactions({
      projectPath: root,
      ownerId,
      verifyApproval,
      checkpoint: async (name) => {
        if (name === 'APPLIED_0') throw new Error('simulated crash');
      },
    });
    const first = await interrupted.prepare([
      { kind: 'replace', path: 'one.gd', content: 'one = 9\n', expectedSha256: sha('one = 1\n') },
    ]);
    await interrupted.approve(first.operationId);
    await assert.rejects(
      interrupted.apply(first.operationId, async () => true),
      /simulated crash/,
    );
    await assert.rejects(
      waiting.apply(next.operationId, async () => true),
      (error: unknown) => (error as { code?: string }).code === 'CONFLICT',
    );
    assert.equal(await readFile(path.join(root, 'two.gd'), 'utf8'), 'two = 2\n');
    assert.equal((await waiting.inspect(next.operationId)).state, 'APPROVED');
    assert.equal(await interrupted.recover(first.operationId), 'ROLLED_BACK');
    assert.equal(await waiting.apply(next.operationId, async () => true), 'COMMITTED');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectTransactions } from '../src/project/transactions.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

if (process.argv[2] === 'transaction-child') {
  const child = new ProjectTransactions({
    projectPath: process.argv[3],
    checkpoint: async (name) => {
      if (name !== 'WRITE_0') return;
      // An unresolved Promise alone does not keep Node alive. Hold an event-loop
      // handle so the parent really kills a live writer, even under suite load.
      setInterval(() => {}, 1000);
      process.send?.({ checkpoint: name });
      await new Promise<never>(() => {});
    },
  });
  void child.apply(process.argv[4], async () => true);
} else {
  test(
    'a killed transaction process leaves a recoverable journal and a safely reclaimable project lock',
    { timeout: 30000 },
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-tx-kill-'));
      await writeFile(path.join(root, 'first.gd'), 'before\n');
      await writeFile(path.join(root, 'second.gd'), 'second\n');
      const parent = new ProjectTransactions({
        projectPath: root,
        verifyApproval: async (plan) => ({ actor: 'reviewer', receipt: 'bound-review', planHash: plan.planHash }),
      });
      const plan = await parent.prepare([
        { kind: 'replace', path: 'first.gd', content: 'after\n', expectedSha256: sha('before\n') },
        { kind: 'replace', path: 'second.gd', content: 'changed\n', expectedSha256: sha('second\n') },
      ]);
      await parent.approve(plan.operationId);
      const child = fork(fileURLToPath(import.meta.url), ['transaction-child', root, plan.operationId], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      try {
        const [message] = await once(child, 'message');
        assert.deepEqual(message, { checkpoint: 'WRITE_0' });
        const exited = once(child, 'exit');
        assert.equal(child.kill('SIGKILL'), true);
        await exited;
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
      const restarted = new ProjectTransactions({ projectPath: root });
      assert.equal(await restarted.recover(plan.operationId), 'ROLLED_BACK');
      assert.equal(await readFile(path.join(root, 'first.gd'), 'utf8'), 'before\n');
      assert.equal(await readFile(path.join(root, 'second.gd'), 'utf8'), 'second\n');
    },
  );
}

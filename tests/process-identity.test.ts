import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readProcessIdentity, sameProcessIdentity, stopIdentifiedProcess } from '../src/process-identity.js';
import { getProcessStatus } from '../src/godot-runtime.js';

test('process identity includes a stable OS start token and executable', async () => {
  const identity = await readProcessIdentity(process.pid);
  if (process.platform === 'win32' || process.platform === 'linux') {
    assert.ok(identity);
    assert.ok(identity.startToken.length > 5);
    assert.ok(identity.executablePath.length > 5);
    assert.equal(sameProcessIdentity(identity, await readProcessIdentity(process.pid)), true);
    assert.equal(sameProcessIdentity({ ...identity, startToken: 'wrong' }, identity), false);
  } else {
    assert.equal(identity, null);
  }
});

test(
  'Windows stop verifies start token and executable before terminating the captured process',
  { skip: process.platform !== 'win32', timeout: 20000 },
  async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    assert.ok(child.pid);
    try {
      const identity = await readProcessIdentity(child.pid);
      assert.ok(identity);
      assert.equal(await stopIdentifiedProcess(child.pid, { ...identity, startToken: 'wrong' }), 'MISMATCH');
      assert.equal(getProcessStatus(child.pid).running, true);
      assert.equal(
        await stopIdentifiedProcess(child.pid, { ...identity, executablePath: identity.executablePath + '.wrong' }),
        'MISMATCH',
      );
      assert.equal(getProcessStatus(child.pid).running, true);
      assert.equal(await stopIdentifiedProcess(child.pid, identity), 'STOPPED');
      assert.equal(getProcessStatus(child.pid).running, false);
    } finally {
      if (getProcessStatus(child.pid).running) child.kill();
    }
  },
);

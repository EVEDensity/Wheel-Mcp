import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  readProcessIdentity,
  sameProcessIdentity,
  stopIdentifiedProcess,
  windowsPowerShellExecutable,
} from '../src/process-identity.js';
import { getProcessStatus } from '../src/godot-runtime.js';

test('Windows process helpers select an absolute installed PowerShell 7 or the system fallback, not arbitrary PATH hosts', () => {
  const modern = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
  assert.equal(
    windowsPowerShellExecutable(
      { ProgramFiles: 'C:\\Program Files', SystemRoot: 'C:\\Windows' },
      (file) => file === modern,
    ),
    modern,
  );
  assert.equal(
    windowsPowerShellExecutable({ ProgramFiles: 'C:\\Program Files', SystemRoot: 'D:\\Windows' }, () => false),
    'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  );
  assert.equal(
    windowsPowerShellExecutable({}, () => false),
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  );
  assert.equal(
    windowsPowerShellExecutable({ ProgramFiles: 'relative', SystemRoot: 'relative' }, () => true),
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  );
});

test('process identity includes a stable OS start token and executable', async () => {
  const started = performance.now();
  const identity = await readProcessIdentity(process.pid);
  if (process.platform === 'win32' || process.platform === 'linux') {
    assert.ok(identity, `Initial OS identity read failed after ${Math.round(performance.now() - started)}ms`);
    assert.ok(identity.startToken.length > 5);
    assert.ok(identity.executablePath.length > 5);
    const secondStarted = performance.now();
    const second = await readProcessIdentity(process.pid);
    assert.ok(
      second,
      `Independent OS identity reread failed after ${Math.round(performance.now() - secondStarted)}ms; no cached identity or retry used`,
    );
    assert.equal(sameProcessIdentity(identity, second), true);
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

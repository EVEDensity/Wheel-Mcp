import { execFile } from 'node:child_process';
import { readFile, readlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ProcessIdentity = {
  platform: 'win32' | 'linux';
  startToken: string;
  executablePath: string;
};

const windowsReadScript = `
$ErrorActionPreference = 'Stop'
$p = Get-Process -Id ([int]$env:WHEEL_IDENTITY_PID) -ErrorAction SilentlyContinue
if ($null -ne $p) {
  $result = [pscustomobject]@{
    startToken = $p.StartTime.ToUniversalTime().ToString('o')
    executablePath = $p.Path
  }
  $result | ConvertTo-Json -Compress
}
`;

const windowsStopScript = `
$ErrorActionPreference = 'Stop'
$p = Get-Process -Id ([int]$env:WHEEL_IDENTITY_PID) -ErrorAction SilentlyContinue
if ($null -eq $p) { Write-Output 'NOT_FOUND'; exit 0 }
if ($p.StartTime.ToUniversalTime().ToString('o') -cne $env:WHEEL_IDENTITY_START -or
    $p.Path -ine $env:WHEEL_IDENTITY_EXE) {
  Write-Output 'MISMATCH'
  exit 0
}
# Hold the Process object and its handle from identity check through Kill.
$null = $p.Handle
$p.Kill()
if ($p.WaitForExit(5000)) { Write-Output 'STOPPED' }
else { Write-Output 'TIMEOUT' }
`;

function validPid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('pid must be a positive safe integer');
}

export async function readProcessIdentity(pid: number): Promise<ProcessIdentity | null> {
  validPid(pid);
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', windowsReadScript],
        {
          windowsHide: true,
          timeout: 5000,
          maxBuffer: 8192,
          env: { ...process.env, WHEEL_IDENTITY_PID: String(pid) },
        },
      );
      if (!stdout.trim()) return null;
      const data = JSON.parse(stdout.trim()) as { startToken?: unknown; executablePath?: unknown };
      if (typeof data.startToken !== 'string' || typeof data.executablePath !== 'string') return null;
      return { platform: 'win32', startToken: data.startToken, executablePath: path.resolve(data.executablePath) };
    } catch {
      return null;
    }
  }
  if (process.platform === 'linux') {
    try {
      const [stat, bootId, executablePath] = await Promise.all([
        readFile(`/proc/${pid}/stat`, 'utf8'),
        readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
        readlink(`/proc/${pid}/exe`),
      ]);
      const closing = stat.lastIndexOf(')');
      const fields = stat
        .slice(closing + 2)
        .trim()
        .split(/\s+/);
      const startTicks = fields[19]; // procfs field 22, after pid and comm.
      if (closing < 0 || !/^\d+$/.test(startTicks)) return null;
      return {
        platform: 'linux',
        startToken: `${bootId.trim()}:${startTicks}`,
        executablePath: path.resolve(executablePath),
      };
    } catch {
      return null;
    }
  }
  return null;
}

export function sameProcessIdentity(expected: ProcessIdentity, actual: ProcessIdentity | null): boolean {
  if (!actual || actual.platform !== expected.platform || actual.startToken !== expected.startToken) return false;
  return expected.platform === 'win32'
    ? actual.executablePath.toLowerCase() === expected.executablePath.toLowerCase()
    : actual.executablePath === expected.executablePath;
}

export async function stopIdentifiedProcess(
  pid: number,
  expected: ProcessIdentity,
): Promise<'STOPPED' | 'NOT_FOUND' | 'MISMATCH' | 'TIMEOUT' | 'UNSUPPORTED'> {
  validPid(pid);
  if (expected.platform !== process.platform) return 'UNSUPPORTED';
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', windowsStopScript],
        {
          windowsHide: true,
          timeout: 10000,
          maxBuffer: 8192,
          env: {
            ...process.env,
            WHEEL_IDENTITY_PID: String(pid),
            WHEEL_IDENTITY_START: expected.startToken,
            WHEEL_IDENTITY_EXE: expected.executablePath,
          },
        },
      );
      const result = stdout.trim();
      return result === 'STOPPED' || result === 'NOT_FOUND' || result === 'MISMATCH' || result === 'TIMEOUT'
        ? result
        : 'UNSUPPORTED';
    } catch {
      return 'UNSUPPORTED';
    }
  }
  // Linux PID-based signalling remains unsafe after a separate identity read.
  // Until pidfd is used, fail closed instead of claiming PID-reuse protection.
  return 'UNSUPPORTED';
}

import { execFile } from 'node:child_process';
import { readFile, readlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Prefer the installed, absolute modern host; never install or retry another host on failure. */
export function windowsPowerShellExecutable(
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = existsSync,
): string {
  if (env.ProgramFiles && path.win32.isAbsolute(env.ProgramFiles)) {
    const modern = path.win32.join(env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe');
    if (exists(modern)) return modern;
  }
  const systemRoot = [env.SystemRoot, env.WINDIR].find((root) => root && path.win32.isAbsolute(root)) || 'C:\\Windows';
  return path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export type ProcessIdentity = {
  platform: 'win32' | 'linux';
  startToken: string;
  executablePath: string;
};

const windowsReadScript = `
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
$p = $null
try {
  $p = [System.Diagnostics.Process]::GetProcessById([int]$env:WHEEL_IDENTITY_PID)
  $null = $p.Handle
  [Console]::Out.WriteLine($p.StartTime.ToUniversalTime().ToString('o'))
  [Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($p.MainModule.FileName)))
} catch [System.ArgumentException] {
  # The process has already exited. No identity is safer than guessing.
} finally {
  if ($null -ne $p) { $p.Dispose() }
}
`;

const windowsStopScript = `
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
try { $p = [System.Diagnostics.Process]::GetProcessById([int]$env:WHEEL_IDENTITY_PID) }
catch [System.ArgumentException] { [Console]::Out.WriteLine('NOT_FOUND'); exit 0 }
# Pin the process handle before inspecting identity; never reopen a recycled
# numeric PID between the generation check and Kill.
$null = $p.Handle
if ($p.StartTime.ToUniversalTime().ToString('o') -cne $env:WHEEL_IDENTITY_START -or
    $p.MainModule.FileName -ine $env:WHEEL_IDENTITY_EXE) {
  [Console]::Out.WriteLine('MISMATCH')
  exit 0
}
# Hold the same Process object/handle through Kill.
$p.Kill()
if ($p.WaitForExit(5000)) { [Console]::Out.WriteLine('STOPPED') }
else { [Console]::Out.WriteLine('TIMEOUT') }
`;

function validPid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('pid must be a positive safe integer');
}

export async function readProcessIdentity(pid: number): Promise<ProcessIdentity | null> {
  validPid(pid);
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        windowsPowerShellExecutable(),
        ['-NoProfile', '-NonInteractive', '-Command', windowsReadScript],
        {
          windowsHide: true,
          timeout: 5000,
          maxBuffer: 8192,
          env: { ...process.env, WHEEL_IDENTITY_PID: String(pid) },
        },
      );
      if (!stdout.trim()) return null;
      const lines = stdout.trim().split(/\r?\n/);
      if (lines.length !== 2 || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(lines[0]) || !/^[A-Za-z0-9+/]+={0,2}$/.test(lines[1]))
        return null;
      const executablePath = Buffer.from(lines[1], 'base64').toString('utf8');
      if (!path.isAbsolute(executablePath)) return null;
      return { platform: 'win32', startToken: lines[0], executablePath: path.resolve(executablePath) };
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
        windowsPowerShellExecutable(),
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

import { spawn } from 'node:child_process';
import process from 'node:process';

export type ProcessTreeMethod = 'taskkill' | 'process-group' | 'fallback';
export type ProcessTreeErrorCode = 'ACCESS_DENIED' | 'NOT_FOUND' | 'TIMEOUT' | 'FAILED';
export type ProcessTreeResult = {
  attempted: boolean;
  terminated: boolean;
  method: ProcessTreeMethod;
  error_code?: ProcessTreeErrorCode;
};

export async function terminateProcessTree(pid: number): Promise<ProcessTreeResult> {
  if (process.platform === 'win32') {
    const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    const exitCode = await new Promise<number | null>((resolve) => child.once('close', resolve));
    if (exitCode === 0) return { attempted: true, terminated: true, method: 'taskkill' };
    return { attempted: true, terminated: false, method: 'taskkill', error_code: exitCode === 5 ? 'ACCESS_DENIED' : 'FAILED' };
  }
  try {
    process.kill(-pid, 'SIGTERM');
    return { attempted: true, terminated: true, method: 'process-group' };
  } catch (error: unknown) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === 'ESRCH') return { attempted: true, terminated: false, method: 'process-group', error_code: 'NOT_FOUND' };
    if (code === 'EPERM') return { attempted: true, terminated: false, method: 'fallback', error_code: 'ACCESS_DENIED' };
    return { attempted: true, terminated: false, method: 'fallback', error_code: 'FAILED' };
  }
}

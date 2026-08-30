import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function resolveGodotPath(value = process.env.GODOT_PATH) {
  if (!value) throw new Error('GODOT_PATH is required');
  return path.resolve(value);
}

export async function getGodotVersion(godotPath) {
  const result = await runProcess(godotPath, ['--version'], process.cwd(), 30);
  if (result.exitCode !== 0) throw new Error(`Godot version failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export async function launchProject({ godotPath, projectPath, evidenceDir, headless = false, extraArgs = [] }) {
  const root = path.resolve(projectPath);
  const evidence = path.resolve(evidenceDir || path.join(root, '.harness', 'runs'));
  await mkdir(evidence, { recursive: true });
  const stdoutPath = path.join(evidence, 'stdout.log');
  const stderrPath = path.join(evidence, 'stderr.log');
  const metadataPath = path.join(evidence, 'process.json');
  const args = [];
  if (headless) args.push('--headless');
  args.push('--path', root, ...extraArgs);
  const child = spawn(resolveGodotPath(godotPath), args, {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, GODOT_PATH: resolveGodotPath(godotPath) }
  });
  const metadata = {
    schema_version: '0.1', source: 'REAL', started: true,
    pid: child.pid, executable: resolveGodotPath(godotPath), arguments: args,
    project_path: root, started_at: new Date().toISOString(), exit_code: null,
    timed_out: false, stdout: stdoutPath, stderr: stderrPath
  };
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const close = new Promise(resolve => child.once('close', async code => {
    metadata.exit_code = code;
    metadata.finished_at = new Date().toISOString();
    await writeFile(stdoutPath, stdout);
    await writeFile(stderrPath, stderr);
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    resolve(metadata);
  }));
  return { metadata, child, close };
}

export async function stopProcess(pid, timeoutMs = 5000) {
  if (!Number.isInteger(Number(pid))) throw new Error('pid must be an integer');
  const processHandle = Number(pid);
  try { process.kill(processHandle); } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(processHandle, 0); } catch (error) {
      if (error.code === 'ESRCH') return { stopped: true, pid: processHandle };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return { stopped: false, pid: processHandle, timed_out: true };
}

export async function stopLaunchedProcess(launch, timeoutMs = 5000) {
  const result = await stopProcess(launch.child.pid, timeoutMs);
  await Promise.race([launch.close, new Promise(resolve => setTimeout(resolve, timeoutMs))]);
  return result;
}

export async function readEvidence(evidenceDir) {
  const root = path.resolve(evidenceDir);
  const [metadata, stdout, stderr] = await Promise.all([
    readFile(path.join(root, 'process.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'stdout.log'), 'utf8').catch(() => ''),
    readFile(path.join(root, 'stderr.log'), 'utf8').catch(() => '')
  ]);
  return { metadata, stdout, stderr };
}

function runProcess(executable, args, cwd, timeoutSeconds) {
  return new Promise(resolve => {
    const child = spawn(executable, args, { cwd, windowsHide: true });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutSeconds * 1000);
    child.once('close', exitCode => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: timedOut ? null : exitCode }); });
    child.once('error', error => { clearTimeout(timer); resolve({ stdout, stderr: `${stderr}${error.message}`, exitCode: null }); });
  });
}

import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
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

export async function listProjects(directory, recursive = false) {
  const root = path.resolve(directory);
  const projects = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    if (entries.some(entry => entry.isFile() && entry.name === 'project.godot')) {
      projects.push(path.join(current, 'project.godot'));
      if (!recursive) return;
    }
    if (!recursive) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      await visit(path.join(current, entry.name));
    }
  }
  await visit(root);
  return { schema_version: '0.1', source: 'REAL', directory: root, recursive, projects: projects.sort() };
}

export async function getProjectInfo(projectPath) {
  const root = path.resolve(projectPath);
  const projectFile = path.join(root, 'project.godot');
  const projectText = await readFile(projectFile, 'utf8');
  const name = projectText.match(/^config\/name\s*=\s*"([^"]*)"/m)?.[1] || null;
  const mainScene = projectText.match(/^run\/main_scene\s*=\s*"([^"]*)"/m)?.[1] || null;
  const files = [];
  async function collect(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await collect(target);
      else files.push(path.relative(root, target).split(path.sep).join('/'));
    }
  }
  await stat(root);
  await collect(root);
  return { schema_version: '0.1', source: 'REAL', projectPath: root, projectFile, name, mainScene, files: files.sort() };
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
  if (!Number.isInteger(Number(timeoutMs)) || Number(timeoutMs) < 0) throw new Error('timeoutMs must be a non-negative integer');
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

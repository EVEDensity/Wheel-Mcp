import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getGodotVersion, getProjectInfo, getSceneTree, resolveGodotPath } from './godot-runtime.js';
import { runGit } from './git-recovery.js';
import type { TimeoutContext } from './timeout.js';

export interface ContextPackOptions {
  projectPath: string;
  godotPath?: string;
  evidenceDir?: string;
  scenePath?: string | null;
  maxErrorBytes?: number;
  timeout?: TimeoutContext;
}
export async function buildContextPack({
  projectPath,
  godotPath,
  evidenceDir,
  scenePath = null,
  maxErrorBytes = 12000,
  timeout,
}: ContextPackOptions) {
  const root = path.resolve(projectPath);
  timeout?.throwIfCancelled();
  const project = await getProjectInfo(root, timeout);
  const godot = {
    path: resolveGodotPath(godotPath),
    version: await getGodotVersion(resolveGodotPath(godotPath), timeout),
  };
  const scene_tree = project.mainScene
    ? await getSceneTree(root, scenePath || project.mainScene, timeout).catch((error: unknown) => ({
        source: 'REAL',
        status: 'FAIL',
        error: error instanceof Error ? error.message : String(error),
      }))
    : null;
  const git = await gitSnapshot(root);
  const recent_errors = evidenceDir ? await readRecentErrors(evidenceDir, maxErrorBytes) : [];
  return {
    schema_version: '0.1',
    source: 'REAL',
    project: { path: root, name: project.name, files: project.files },
    godot,
    main_scene: { path: project.mainScene, scene_tree },
    recent_errors,
    git,
    active_run: null,
  };
}

async function gitSnapshot(root: string) {
  const head = await runGit(root, ['rev-parse', 'HEAD']);
  const status = await runGit(root, ['status', '--short']);
  return { head: head.stdout.trim(), status: status.stdout.trim(), source: 'REAL' };
}

async function readRecentErrors(evidenceDir: string, maxBytes: number) {
  const files = ['stderr.log', 'debug-output.log'];
  const errors: string[] = [];
  for (const file of files) {
    const text = await readFile(path.join(path.resolve(evidenceDir), file), 'utf8').catch(() => '');
    if (text) errors.push(text.slice(-maxBytes));
  }
  return errors;
}

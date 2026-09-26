import { cp, mkdtemp, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Actual installation scripts, isolated output; never rebuild/configure the user's workspace. */
export async function createSetupFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-install-smoke-'));
  for (const name of ['scripts', 'src', 'package.json', 'tsconfig.json'])
    await cp(path.resolve(name), path.join(root, name), { recursive: true });
  await symlink(
    path.resolve('node_modules'),
    path.join(root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  return root;
}

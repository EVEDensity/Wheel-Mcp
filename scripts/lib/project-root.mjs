import path from 'node:path';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function resolveProjectRoot(fromModuleUrl = import.meta.url) {
  let current = path.dirname(fileURLToPath(fromModuleUrl));
  while (true) {
    const marker = path.join(current, 'package.json');
    try {
      await access(marker);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error('Unable to locate project root (package.json not found).');
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const findRepoRoot = (start: string): string => {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
};

export const REPO_ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));

process.chdir(REPO_ROOT);

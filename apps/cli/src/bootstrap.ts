import { fileURLToPath } from 'url';
import path from 'path';

// Resolve repo root: apps/cli/src/ → apps/cli/ → apps/ → repo root
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

// Set working directory to repo root so all relative paths
// (data/, .cache/, .env, logs/) resolve correctly
process.chdir(REPO_ROOT);

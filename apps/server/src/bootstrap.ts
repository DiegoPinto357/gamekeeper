import { fileURLToPath } from 'url';
import path from 'path';

// Resolve repo root: apps/server/src/ → apps/server/ → apps/ → repo root
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

process.chdir(REPO_ROOT);

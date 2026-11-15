import './suppress-warning';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrate';
import { seedStatuses } from './seed';
import { importLegacyUserData } from './legacy-import';
import { log } from '../logger';

const sqlite = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSync;
};

export interface Db {
  raw: DatabaseSync;
  path: string;
  close(): void;
}

export const defaultDbPath = (): string =>
  process.env.GAMEKEEPER_DB ||
  path.join(process.cwd(), 'data', 'gamekeeper.db');

export const openDb = (dbPath?: string): Db => {
  const file = dbPath ?? defaultDbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const raw = new sqlite.DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = DELETE');
  raw.exec('PRAGMA busy_timeout = 5000');
  raw.exec('PRAGMA foreign_keys = ON');

  migrate(raw);
  seedStatuses(raw);

  const imported = importLegacyUserData(raw, path.dirname(file));
  const total =
    imported.interests +
    imported.owned +
    imported.forceMergeRules +
    imported.propertyOverrides;
  if (total > 0) {
    log.info(
      `📥 Imported legacy user data: interests=${imported.interests}, owned=${imported.owned}, forceMerge=${imported.forceMergeRules}, propertyOverrides=${imported.propertyOverrides}`,
    );
  }

  return {
    raw,
    path: file,
    close: () => raw.close(),
  };
};

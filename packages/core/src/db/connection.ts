import './suppress-warning';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { migrate } from './migrate';
import { seedStatuses } from './seed';

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

  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = DELETE');
  raw.exec('PRAGMA busy_timeout = 5000');
  raw.exec('PRAGMA foreign_keys = ON');

  migrate(raw);
  seedStatuses(raw);

  return {
    raw,
    path: file,
    close: () => raw.close(),
  };
};

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, defaultDbPath } from './connection';

const tmpDir = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-db-'));

describe('connection', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates the database file and parent directory', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'nested', 'library.db');

    const db = openDb(file);

    expect(fs.existsSync(file)).toBe(true);
    expect(db.path).toBe(file);
    db.close();
  });

  it('applies pragmas: DELETE journal, busy_timeout=5000, foreign_keys=ON', () => {
    const file = path.join(tmpDir(), 'lib.db');
    const db = openDb(file);

    const journal = db.raw.prepare('PRAGMA journal_mode').get() as {
      journal_mode: string;
    };
    const busy = db.raw.prepare('PRAGMA busy_timeout').get() as {
      timeout: number;
    };
    const fk = db.raw.prepare('PRAGMA foreign_keys').get() as {
      foreign_keys: number;
    };

    expect(journal.journal_mode).toBe('delete');
    expect(busy.timeout).toBe(5000);
    expect(fk.foreign_keys).toBe(1);
    db.close();
  });

  it('migrates and seeds on open (schema + statuses present)', () => {
    const file = path.join(tmpDir(), 'lib.db');
    const db = openDb(file);

    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'statuses',
        'game_status',
        'interests',
        'owned_games',
        'force_merge_rules',
        'property_overrides',
        'games',
        'games_fts',
      ]),
    );

    const statuses = db.raw
      .prepare('SELECT COUNT(*) AS c FROM statuses')
      .get() as { c: number };
    expect(statuses.c).toBe(9);
    db.close();
  });

  it('reopening the same file is idempotent', () => {
    const file = path.join(tmpDir(), 'lib.db');

    const first = openDb(file);
    first.close();
    const second = openDb(file);

    const version = second.raw.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    expect(version.user_version).toBeGreaterThanOrEqual(1);
    const statuses = second.raw
      .prepare('SELECT COUNT(*) AS c FROM statuses')
      .get() as { c: number };
    expect(statuses.c).toBe(9);
    second.close();
  });

  describe('defaultDbPath', () => {
    it('uses GAMEKEEPER_DB env override when set', () => {
      vi.stubEnv('GAMEKEEPER_DB', '/tmp/custom/gamekeeper.db');
      expect(defaultDbPath()).toBe('/tmp/custom/gamekeeper.db');
    });

    it('falls back to <cwd>/data/gamekeeper.db', () => {
      vi.unstubAllEnvs();
      expect(defaultDbPath()).toBe(
        path.join(process.cwd(), 'data', 'gamekeeper.db'),
      );
    });
  });
});

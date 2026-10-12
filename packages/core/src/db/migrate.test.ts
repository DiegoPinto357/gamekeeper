import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './connection';
import { MIGRATIONS, migrate } from './migrate';

const freshDb = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-migrate-'));
  return openDb(path.join(dir, 'lib.db'));
};

describe('migrate', () => {
  it('advances user_version to MIGRATIONS.length on a fresh database', () => {
    const db = freshDb();
    const version = db.raw.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    expect(version.user_version).toBe(MIGRATIONS.length);
    db.close();
  });

  it('is idempotent: second migrate applies nothing', () => {
    const db = freshDb();
    const before = (db.raw.prepare('PRAGMA user_version').get() as {
      user_version: number;
    }).user_version;

    const applied = migrate(db.raw);

    expect(applied).toBe(0);
    const after = (db.raw.prepare('PRAGMA user_version').get() as {
      user_version: number;
    }).user_version;
    expect(after).toBe(before);
    db.close();
  });

  it('creates the full schema (user + derived tables, indexes, FTS)', () => {
    const db = freshDb();
    const rows = db.raw
      .prepare(
        "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
      )
      .all() as { type: string; name: string }[];
    const byType = (t: string) =>
      rows.filter((r) => r.type === t).map((r) => r.name);

    expect(byType('table')).toEqual(
      expect.arrayContaining([
        'statuses',
        'game_status',
        'interests',
        'owned_games',
        'force_merge_rules',
        'property_overrides',
        'games',
        'genres',
        'game_genres',
        'tags',
        'game_tags',
        'similar_games',
        'games_fts',
      ]),
    );
    expect(byType('index')).toEqual(
      expect.arrayContaining(['idx_games_name', 'idx_games_primary_source']),
    );
    db.close();
  });

  it('FTS5 games_fts is queryable', () => {
    const db = freshDb();
    db.raw
      .prepare(
        'INSERT INTO games_fts (canonical_id, name) VALUES (?, ?)',
      )
      .run('steam:1', 'Hades II');

    const hits = db.raw
      .prepare('SELECT canonical_id FROM games_fts WHERE games_fts MATCH ?')
      .all('hades') as { canonical_id: string }[];
    expect(hits.map((h) => h.canonical_id)).toEqual(['steam:1']);
    db.close();
  });
});

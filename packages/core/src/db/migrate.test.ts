import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

  it('has the game_status_touch_updated_at trigger and it fires on update', () => {
    const db = freshDb();

    const trigger = db.raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'game_status_touch_updated_at'",
      )
      .get() as { name: string } | undefined;
    expect(trigger?.name).toBe('game_status_touch_updated_at');

    db.raw
      .prepare(
        "INSERT INTO statuses (key, label, position, color) VALUES ('custom', 'Custom', 99, '#888888')",
      )
      .run();
    db.raw
      .prepare(
        'INSERT INTO game_status (canonical_id, status, updated_at) VALUES (?, ?, ?)',
      )
      .run('steam:1', 'playing', '2000-01-01T00:00:00.000Z');

    db.raw
      .prepare("UPDATE game_status SET status = 'completed' WHERE canonical_id = ?")
      .run('steam:1');

    const row = db.raw
      .prepare('SELECT updated_at FROM game_status WHERE canonical_id = ?')
      .get('steam:1') as { updated_at: string };
    expect(row.updated_at).not.toBe('2000-01-01T00:00:00.000Z');
    db.close();
  });

  it('migration #3 inserts recurrent and renumbers an old 8-status layout', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-migrate-recurrent-'));
    const raw = new DatabaseSync(path.join(dir, 'old.db'));

    // old v2 state: migrations 1-2 applied, 8 statuses with pre-recurrent positions
    raw.exec(MIGRATIONS[0]);
    raw.exec(MIGRATIONS[1]);
    raw.exec('PRAGMA user_version = 2');
    const insert = raw.prepare(
      'INSERT INTO statuses (key, label, position, color) VALUES (?, ?, ?, ?)',
    );
    const old = [
      ['backlog', 'Backlog', 0],
      ['want_to_play', 'Want to Play', 1],
      ['queued_to_play', 'Up Next', 2],
      ['trying', 'Trying Out', 3],
      ['playing', 'Playing', 4],
      ['paused', 'Paused', 5],
      ['completed', 'Completed', 6],
      ['dropped', 'Dropped', 7],
    ] as const;
    for (const [key, label, position] of old) insert.run(key, label, position, '#000000');

    const applied = migrate(raw);

    // #3 (recurrent + renumber) and #4 (unavailable_reason column)
    expect(applied).toBe(2);
    const rows = raw
      .prepare('SELECT key, position FROM statuses ORDER BY position')
      .all() as { key: string; position: number }[];
    expect(rows.map((r) => r.key)).toEqual([
      'backlog',
      'want_to_play',
      'queued_to_play',
      'trying',
      'recurrent',
      'playing',
      'paused',
      'completed',
      'dropped',
    ]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const cols = raw
      .prepare('PRAGMA table_info(games)')
      .all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain('unavailable_reason');
    raw.close();
  });
});

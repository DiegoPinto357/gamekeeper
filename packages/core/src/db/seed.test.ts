import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './connection';
import { seedStatuses, DEFAULT_STATUSES } from './seed';

const freshDb = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-seed-'));
  return openDb(path.join(dir, 'lib.db'));
};

describe('seed', () => {
  it('seeds the 8 canonical status keys in order', () => {
    const db = freshDb();
    const rows = db.raw
      .prepare('SELECT key, label, position, color FROM statuses ORDER BY position')
      .all() as { key: string; label: string; position: number; color: string }[];

    expect(rows.map((r) => r.key)).toEqual([
      'backlog',
      'want_to_play',
      'queued_to_play',
      'trying',
      'playing',
      'paused',
      'completed',
      'dropped',
    ]);
    expect(rows.map((r) => r.label)).toEqual([
      'Backlog',
      'Want to Play',
      'Up Next',
      'Trying Out',
      'Playing',
      'Paused',
      'Completed',
      'Dropped',
    ]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const row of rows) expect(row.color).toMatch(/^#[0-9a-f]{6}$/i);
    db.close();
  });

  it('is idempotent: running twice keeps 8 rows', () => {
    const db = freshDb();
    seedStatuses(db.raw);
    seedStatuses(db.raw);

    const count = db.raw.prepare('SELECT COUNT(*) AS c FROM statuses').get() as {
      c: number;
    };
    expect(count.c).toBe(8);
    db.close();
  });

  it('never overwrites a user-edited label', () => {
    const db = freshDb();
    db.raw
      .prepare('UPDATE statuses SET label = ? WHERE key = ?')
      .run('ICE', 'backlog');

    seedStatuses(db.raw);

    const row = db.raw
      .prepare('SELECT label FROM statuses WHERE key = ?')
      .get('backlog') as { label: string };
    expect(row.label).toBe('ICE');
    db.close();
  });

  it('exposes DEFAULT_STATUSES matching the plan keys', () => {
    expect(DEFAULT_STATUSES.map((s) => s.key)).toEqual([
      'backlog',
      'want_to_play',
      'queued_to_play',
      'trying',
      'playing',
      'paused',
      'completed',
      'dropped',
    ]);
  });
});

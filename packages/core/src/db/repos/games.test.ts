import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UnifiedGame } from '../../types/game';
import { openDb, type Db } from '../connection';
import {
  upsertGames,
  getGame,
  listGames,
  rebuildGamesFts,
  reconcileUnavailableReasons,
} from './games';

const makeGame = (overrides: Partial<UnifiedGame> = {}): UnifiedGame => ({
  canonicalId: 'steam:1145350',
  name: 'Hades II',
  primarySource: 'steam',
  ownedSources: ['steam', 'epic'],
  steamAppId: 1145350,
  playtimeHours: 12.5,
  lastPlayedAt: new Date('2026-01-15T10:00:00.000Z'),
  coverImageUrl: 'https://cdn.example/hades2.jpg',
  releaseDate: new Date('2024-05-06T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
});

const searchFts = (raw: Db['raw'], term: string): string[] => {
  try {
    const rows = raw
      .prepare(
        'SELECT canonical_id FROM games_fts WHERE games_fts MATCH ? ORDER BY rank',
      )
      .all(term) as { canonical_id: string }[];
    return rows.map((r) => r.canonical_id);
  } catch {
    return [];
  }
};

describe('games', () => {
  let db: Db;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-games-'));
    db = openDb(path.join(dir, 'lib.db'));
  });

  afterEach(() => {
    db.close();
  });

  it('round-trips a game (Dates, JSON arrays, optionals)', () => {
    const game = makeGame();
    upsertGames(db.raw, [game]);

    const loaded = getGame(db.raw, game.canonicalId);
    expect(loaded).toEqual(game);
  });

  it('round-trips a minimal game without optional fields', () => {
    const game = makeGame({
      playtimeHours: undefined,
      lastPlayedAt: undefined,
      coverImageUrl: undefined,
      releaseDate: undefined,
      steamAppId: undefined,
    });
    upsertGames(db.raw, [game]);

    const loaded = getGame(db.raw, game.canonicalId);
    expect(loaded).toEqual(game);
    expect(loaded?.playtimeHours).toBeUndefined();
    expect(loaded?.lastPlayedAt).toBeUndefined();
  });

  it('getGame returns undefined for unknown id', () => {
    expect(getGame(db.raw, 'steam:0')).toBeUndefined();
  });

  it('listGames returns all stored games', () => {
    upsertGames(db.raw, [
      makeGame({ canonicalId: 'steam:1', name: 'Alpha' }),
      makeGame({ canonicalId: 'steam:2', name: 'Beta' }),
    ]);

    const all = listGames(db.raw);
    expect(all.map((g) => g.canonicalId).sort()).toEqual(['steam:1', 'steam:2']);
  });

  it('upsert updates sync-owned columns on conflict', () => {
    upsertGames(db.raw, [makeGame({ name: 'Old Name' })]);

    upsertGames(db.raw, [makeGame({ name: 'New Name', playtimeHours: 99 })]);

    const loaded = getGame(db.raw, 'steam:1145350');
    expect(loaded?.name).toBe('New Name');
    expect(loaded?.playtimeHours).toBe(99);
    expect(listGames(db.raw)).toHaveLength(1);
  });

  it('upsert does NOT clobber enrichment columns (igdb_id, enriched_at, meta_source)', () => {
    const game = makeGame();
    upsertGames(db.raw, [game]);

    db.raw
      .prepare(
        'UPDATE games SET igdb_id = ?, enriched_at = ?, meta_source = ? WHERE canonical_id = ?',
      )
      .run(765, '2026-02-01T00:00:00.000Z', 'igdb', game.canonicalId);

    upsertGames(db.raw, [makeGame({ name: 'Renamed' })]);

    const row = db.raw
      .prepare(
        'SELECT name, igdb_id, enriched_at, meta_source FROM games WHERE canonical_id = ?',
      )
      .get(game.canonicalId) as {
      name: string;
      igdb_id: number;
      enriched_at: string;
      meta_source: string;
    };
    expect(row.name).toBe('Renamed');
    expect(row.igdb_id).toBe(765);
    expect(row.enriched_at).toBe('2026-02-01T00:00:00.000Z');
    expect(row.meta_source).toBe('igdb');
  });

  it('rebuilds the FTS index after write (findable, old names dropped)', () => {
    upsertGames(db.raw, [makeGame({ name: 'Hades II' })]);
    expect(searchFts(db.raw, 'hades')).toEqual(['steam:1145350']);

    upsertGames(db.raw, [makeGame({ name: 'Hades: Reborn' })]);
    expect(searchFts(db.raw, 'hades')).toEqual(['steam:1145350']);
    expect(searchFts(db.raw, 'reborn')).toEqual(['steam:1145350']);
    expect(searchFts(db.raw, 'nomatch')).toEqual([]);
  });

  it('rebuildGamesFts can be called explicitly and returns row count', () => {
    upsertGames(db.raw, [makeGame()]);
    const count = rebuildGamesFts(db.raw);
    expect(count).toBe(1);
  });

  it('upsertGames rolls back the whole batch when one row fails', () => {
    upsertGames(db.raw, [makeGame({ canonicalId: 'steam:1', name: 'Existing' })]);

    const bad = makeGame({
      canonicalId: 'steam:2',
      name: undefined as unknown as string,
    });
    expect(() => upsertGames(db.raw, [makeGame({ canonicalId: 'steam:3', name: 'Good' }), bad])).toThrow();

    expect(getGame(db.raw, 'steam:3')).toBeUndefined();
    expect(listGames(db.raw).map((g) => g.canonicalId)).toEqual(['steam:1']);
    expect(searchFts(db.raw, 'good')).toEqual([]);
  });

  describe('reconcileUnavailableReasons', () => {
    const reasons = (raw: Db['raw']): Record<string, string | null> => {
      const rows = raw
        .prepare('SELECT canonical_id, unavailable_reason FROM games')
        .all() as { canonical_id: string; unavailable_reason: string | null }[];
      return Object.fromEntries(
        rows.map((row) => [row.canonical_id, row.unavailable_reason]),
      );
    };

    it('flags games and clears flags for games absent from the snapshot', () => {
      upsertGames(db.raw, [
        makeGame({ canonicalId: 'gp:1', name: 'Clair Obscur: Expedition 33' }),
        makeGame({ canonicalId: 'gp:2', name: 'Pacific Drive' }),
        makeGame({ canonicalId: 'steam:1', name: 'Hades II' }),
      ]);

      reconcileUnavailableReasons(db.raw, [
        { canonicalId: 'gp:1', reason: 'interest-unavailable' },
      ]);
      expect(reasons(db.raw)).toEqual({
        'gp:1': 'interest-unavailable',
        'gp:2': null,
        'steam:1': null,
      });

      // next sync: gp:1 returned, gp:2 dropped — snapshot is authoritative
      const result = reconcileUnavailableReasons(db.raw, [
        { canonicalId: 'gp:2', reason: 'interest-unavailable' },
      ]);
      expect(result).toEqual({ flagged: 1, cleared: 1 });
      expect(reasons(db.raw)).toEqual({
        'gp:1': null,
        'gp:2': 'interest-unavailable',
        'steam:1': null,
      });
    });

    it('an empty snapshot clears every flag', () => {
      upsertGames(db.raw, [
        makeGame({ canonicalId: 'gp:1' }),
        makeGame({ canonicalId: 'gp:2' }),
      ]);
      reconcileUnavailableReasons(db.raw, [
        { canonicalId: 'gp:1', reason: 'left-catalog' },
        { canonicalId: 'gp:2', reason: 'left-catalog' },
      ]);

      const result = reconcileUnavailableReasons(db.raw, []);
      expect(result).toEqual({ flagged: 0, cleared: 2 });
      expect(reasons(db.raw)).toEqual({ 'gp:1': null, 'gp:2': null });
    });

    it('is idempotent: re-flagging the same reason reports no change', () => {
      upsertGames(db.raw, [makeGame({ canonicalId: 'gp:1' })]);
      reconcileUnavailableReasons(db.raw, [
        { canonicalId: 'gp:1', reason: 'left-catalog' },
      ]);

      const result = reconcileUnavailableReasons(db.raw, [
        { canonicalId: 'gp:1', reason: 'left-catalog' },
      ]);
      expect(result).toEqual({ flagged: 0, cleared: 0 });
      expect(reasons(db.raw)['gp:1']).toBe('left-catalog');
    });
  });
});

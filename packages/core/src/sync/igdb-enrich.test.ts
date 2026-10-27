import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { UnifiedGame } from '../types/game';
import { openDb, type Db } from '../db/connection';
import { upsertGames } from '../db/repos/games';
import {
  enrichIgdbMetadata,
  getIgdbEnrichmentCandidates,
  type IgdbApi,
  type IgdbGameDetails,
} from './igdb-enrich';

const makeGame = (overrides: Partial<UnifiedGame> = {}): UnifiedGame => ({
  canonicalId: 'steam:1145350',
  name: 'Hades II',
  primarySource: 'steam',
  ownedSources: ['steam'],
  steamAppId: 1145350,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const details = (
  overrides: Partial<IgdbGameDetails> = {},
): IgdbGameDetails => ({
  igdbId: 5502,
  name: 'Hades II',
  summary: 'Battle beyond the Underworld.',
  genres: ['Action', 'Roguelike'],
  themes: ['Fantasy'],
  keywords: ['roguelike'],
  similarGameIds: [5501],
  developers: ['Supergiant Games'],
  publishers: ['Supergiant Games'],
  ...overrides,
});

const makeApi = (
  overrides: Partial<IgdbApi> = {},
): IgdbApi => ({
  findBySteamAppId: async () => ({ igdbId: 5502, name: 'Hades II' }),
  findByName: async () => ({ igdbId: 5502, name: 'Hades II' }),
  fetchDetails: async () => details(),
  ...overrides,
});

const readGame = (db: DatabaseSync, id: string) =>
  db.prepare('SELECT * FROM games WHERE canonical_id = ?').get(id) as {
    igdb_id: number | null;
    igdb_enriched_at: string | null;
    description: string | null;
    developer: string | null;
    publisher: string | null;
  };

const junctionNames = (db: DatabaseSync, table: 'genres' | 'tags', id: string): string[] =>
  (
    db
      .prepare(
        `SELECT t.name FROM ${table} t
         JOIN game_${table} jt ON jt.${table === 'genres' ? 'genre' : 'tag'}_id = t.id
         WHERE jt.canonical_id = ? ORDER BY t.name`,
      )
      .all(id) as { name: string }[]
  ).map((r) => r.name);

describe('igdb-enrich', () => {
  let db: Db;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-igdb-'));
    db = openDb(path.join(dir, 'lib.db'));
  });

  afterEach(() => {
    db.close();
  });

  describe('getIgdbEnrichmentCandidates', () => {
    it('selects any game not yet IGDB-enriched (Steam and non-Steam)', () => {
      upsertGames(db.raw, [
        makeGame({ canonicalId: 'steam:1', steamAppId: 1 }),
        makeGame({
          canonicalId: 'switch:2',
          steamAppId: undefined,
          name: 'Physical Switch Game',
          primarySource: 'manual',
          ownedSources: ['manual'],
        }),
        makeGame({ canonicalId: 'steam:3', steamAppId: 3 }),
      ]);
      db.raw
        .prepare("UPDATE games SET igdb_enriched_at = '2026-01-02T00:00:00.000Z' WHERE canonical_id = 'steam:3'")
        .run();

      const candidates = getIgdbEnrichmentCandidates(db.raw);

      expect(candidates.map((c) => c.canonicalId).sort()).toEqual([
        'steam:1',
        'switch:2',
      ]);
    });

    it('force includes already-enriched games', () => {
      upsertGames(db.raw, [makeGame()]);
      db.raw
        .prepare("UPDATE games SET igdb_enriched_at = '2026-01-02T00:00:00.000Z'")
        .run();

      expect(getIgdbEnrichmentCandidates(db.raw, { force: true })).toHaveLength(1);
      expect(getIgdbEnrichmentCandidates(db.raw)).toHaveLength(0);
    });
  });

  describe('enrichIgdbMetadata', () => {
    it('persists igdb_id, fills metadata, unions genres + tags, stamps igdb_enriched_at', async () => {
      upsertGames(db.raw, [makeGame()]);

      const result = await enrichIgdbMetadata(
        db.raw,
        { delayMs: 0 },
        makeApi(),
      );

      expect(result).toEqual({ enriched: 1, failed: 0, total: 1 });
      const row = readGame(db.raw, 'steam:1145350');
      expect(row.igdb_id).toBe(5502);
      expect(row.igdb_enriched_at).not.toBeNull();
      expect(row.description).toBe('Battle beyond the Underworld.');
      expect(row.developer).toBe('Supergiant Games');
      expect(row.publisher).toBe('Supergiant Games');
      expect(junctionNames(db.raw, 'genres', 'steam:1145350')).toEqual([
        'Action',
        'Roguelike',
      ]);
      expect(junctionNames(db.raw, 'tags', 'steam:1145350')).toEqual([
        'Fantasy',
        'roguelike',
      ]);
    });

    it('fills only missing fields and unions with existing junction rows', async () => {
      upsertGames(db.raw, [
        makeGame({ description: 'Sibling description.' }),
      ]);
      db.raw.prepare("INSERT INTO genres (name) VALUES ('Existing')").run();
      db.raw
        .prepare(
          `INSERT INTO game_genres (canonical_id, genre_id)
           SELECT 'steam:1145350', id FROM genres WHERE name = 'Existing'`,
        )
        .run();

      await enrichIgdbMetadata(db.raw, { delayMs: 0 }, makeApi());

      const row = readGame(db.raw, 'steam:1145350');
      expect(row.description).toBe('Sibling description.');
      expect(row.developer).toBe('Supergiant Games');
      expect(junctionNames(db.raw, 'genres', 'steam:1145350')).toEqual([
        'Action',
        'Existing',
        'Roguelike',
      ]);
    });

    it('leaves igdb_enriched_at null when the lookup fails', async () => {
      upsertGames(db.raw, [makeGame()]);

      const result = await enrichIgdbMetadata(
        db.raw,
        { delayMs: 0 },
        makeApi({ findBySteamAppId: async () => null }),
      );

      expect(result).toEqual({ enriched: 0, failed: 1, total: 1 });
      const row = readGame(db.raw, 'steam:1145350');
      expect(row.igdb_enriched_at).toBeNull();
      expect(row.igdb_id).toBeNull();
    });

    it('uses an existing igdb_id without re-looking-up', async () => {
      upsertGames(db.raw, [makeGame()]);
      db.raw.prepare('UPDATE games SET igdb_id = 999 WHERE canonical_id = ?').run('steam:1145350');
      const lookups: number[] = [];

      await enrichIgdbMetadata(
        db.raw,
        { delayMs: 0 },
        makeApi({
          findBySteamAppId: async (appId) => {
            lookups.push(appId);
            return { igdbId: 5502, name: 'Hades II' };
          },
        }),
      );

      expect(lookups).toHaveLength(0);
      const row = readGame(db.raw, 'steam:1145350');
      expect(row.igdb_id).toBe(999);
      expect(row.description).toBe('Battle beyond the Underworld.');
    });

    it('routes Steam games through findBySteamAppId and the rest through findByName', async () => {
      upsertGames(db.raw, [
        makeGame({ canonicalId: 'steam:1', steamAppId: 111, name: 'Steam Game' }),
        makeGame({
          canonicalId: 'manual:2',
          steamAppId: undefined,
          name: 'Physical Switch Game',
          primarySource: 'manual',
          ownedSources: ['manual'],
        }),
      ]);
      const steamLookups: number[] = [];
      const nameLookups: string[] = [];

      await enrichIgdbMetadata(
        db.raw,
        { delayMs: 0 },
        makeApi({
          findBySteamAppId: async (appId) => {
            steamLookups.push(appId);
            return { igdbId: 1, name: 'Steam Game' };
          },
          findByName: async (name) => {
            nameLookups.push(name);
            return { igdbId: 2, name: 'Physical Switch Game' };
          },
        }),
      );

      expect(steamLookups).toEqual([111]);
      expect(nameLookups).toEqual(['Physical Switch Game']);
      expect(readGame(db.raw, 'manual:2').igdb_id).toBe(2);
      expect(readGame(db.raw, 'manual:2').description).toBe(
        'Battle beyond the Underworld.',
      );
    });

    it('respects limit and reports progress', async () => {
      upsertGames(db.raw, [
        makeGame({ canonicalId: 'steam:1', steamAppId: 1, name: 'One' }),
        makeGame({ canonicalId: 'steam:2', steamAppId: 2, name: 'Two' }),
        makeGame({ canonicalId: 'steam:3', steamAppId: 3, name: 'Three' }),
      ]);
      const progress: Array<[number, number, string]> = [];

      const result = await enrichIgdbMetadata(
        db.raw,
        {
          delayMs: 0,
          limit: 2,
          onProgress: (done, total, name) => progress.push([done, total, name]),
        },
        makeApi(),
      );

      expect(result.total).toBe(2);
      expect(progress.map((p) => p[0])).toEqual([1, 2]);
    });
  });
});

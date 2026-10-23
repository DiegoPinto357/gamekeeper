import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { UnifiedGame } from '../types/game';
import { openDb, type Db } from '../db/connection';
import { upsertGames } from '../db/repos/games';
import {
  getSteamEnrichmentCandidates,
  enrichSteamMetadata,
  type SteamAppMetadata,
} from './steam-enrich';

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
  overrides: Partial<SteamAppMetadata> = {},
): SteamAppMetadata => ({
  name: 'Hades II',
  steam_appid: 1145350,
  header_image: 'https://cdn.example/hades2.jpg',
  short_description: 'Battle beyond the Underworld.',
  developers: ['Supergiant Games'],
  publishers: ['Supergiant Games'],
  genres: [{ description: 'Action' }, { description: 'Roguelike' }],
  release_date: { coming_soon: false, date: 'May 6, 2024' },
  ...overrides,
});

const readGame = (db: DatabaseSync, id: string) =>
  db.prepare('SELECT * FROM games WHERE canonical_id = ?').get(id) as {
    description: string | null;
    developer: string | null;
    publisher: string | null;
    cover_image_url: string | null;
    release_date: string | null;
    enriched_at: string | null;
  };

const genreNames = (db: DatabaseSync, id: string): string[] =>
  (
    db
      .prepare(
        `SELECT g.name FROM genres g
         JOIN game_genres gg ON gg.genre_id = g.id
         WHERE gg.canonical_id = ? ORDER BY g.name`,
      )
      .all(id) as { name: string }[]
  ).map((r) => r.name);

describe('steam-enrich', () => {
  let db: Db;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-enrich-'));
    db = openDb(path.join(dir, 'lib.db'));
  });

  afterEach(() => {
    db.close();
  });

  describe('getSteamEnrichmentCandidates', () => {
    it('selects Steam games not yet enriched, skipping non-steam and already-enriched', () => {
      upsertGames(db.raw, [
        makeGame({ canonicalId: 'steam:1', steamAppId: 1 }),
        makeGame({ canonicalId: 'steam:2', steamAppId: 2 }),
        makeGame({ canonicalId: 'gog:x', steamAppId: undefined, primarySource: 'gog', ownedSources: ['gog'] }),
      ]);
      db.raw
        .prepare("UPDATE games SET enriched_at = '2026-01-02T00:00:00.000Z' WHERE canonical_id = 'steam:2'")
        .run();

      const candidates = getSteamEnrichmentCandidates(db.raw);

      expect(candidates.map((c) => c.canonicalId)).toEqual(['steam:1']);
    });

    it('force includes already-enriched games', () => {
      upsertGames(db.raw, [makeGame()]);
      db.raw
        .prepare("UPDATE games SET enriched_at = '2026-01-02T00:00:00.000Z'")
        .run();

      expect(getSteamEnrichmentCandidates(db.raw, { force: true })).toHaveLength(1);
      expect(getSteamEnrichmentCandidates(db.raw)).toHaveLength(0);
    });
  });

  describe('enrichSteamMetadata', () => {
    it('applies metadata, unions genres into the junction, and stamps enriched_at', async () => {
      upsertGames(db.raw, [makeGame()]);

      const result = await enrichSteamMetadata(
        db.raw,
        { delayMs: 0 },
        async () => details(),
      );

      expect(result).toEqual({ enriched: 1, failed: 0, total: 1 });
      const row = readGame(db.raw, 'steam:1145350');
      expect(row.description).toBe('Battle beyond the Underworld.');
      expect(row.developer).toBe('Supergiant Games');
      expect(row.publisher).toBe('Supergiant Games');
      expect(row.cover_image_url).toBe('https://cdn.example/hades2.jpg');
      expect(row.release_date).toContain('2024-05-06');
      expect(row.enriched_at).not.toBeNull();
      expect(genreNames(db.raw, 'steam:1145350')).toEqual([
        'Action',
        'Roguelike',
      ]);
    });

    it('fills only missing fields — existing values are preserved', async () => {
      upsertGames(db.raw, [
        makeGame({
          description: 'Sibling description.',
          coverImageUrl: 'https://cdn.example/existing.jpg',
        }),
      ]);

      await enrichSteamMetadata(db.raw, { delayMs: 0 }, async () => details());

      const row = readGame(db.raw, 'steam:1145350');
      expect(row.description).toBe('Sibling description.');
      expect(row.developer).toBe('Supergiant Games');
      expect(row.cover_image_url).toBe('https://cdn.example/existing.jpg');
    });

    it('leaves enriched_at null on fetch failure so the next run retries', async () => {
      upsertGames(db.raw, [makeGame()]);

      const result = await enrichSteamMetadata(
        db.raw,
        { delayMs: 0 },
        async () => null,
      );

      expect(result).toEqual({ enriched: 0, failed: 1, total: 1 });
      expect(readGame(db.raw, 'steam:1145350').enriched_at).toBeNull();
    });

    it('respects limit and reports progress per game', async () => {
      upsertGames(db.raw, [
        makeGame({ canonicalId: 'steam:1', steamAppId: 1, name: 'One' }),
        makeGame({ canonicalId: 'steam:2', steamAppId: 2, name: 'Two' }),
        makeGame({ canonicalId: 'steam:3', steamAppId: 3, name: 'Three' }),
      ]);
      const calls: number[] = [];
      const progress: Array<[number, number, string]> = [];

      const result = await enrichSteamMetadata(
        db.raw,
        {
          delayMs: 0,
          limit: 2,
          onProgress: (done, total, name) => progress.push([done, total, name]),
        },
        async (appId) => {
          calls.push(appId);
          return details({ steam_appid: appId });
        },
      );

      expect(calls).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(progress.map((p) => p[0])).toEqual([1, 2]);
      expect(progress.every((p) => p[1] === 2)).toBe(true);
    });

    it('unions genres with existing junction rows', async () => {
      upsertGames(db.raw, [makeGame()]);
      db.raw
        .prepare("INSERT INTO genres (name) VALUES ('Existing')")
        .run();
      db.raw
        .prepare(
          `INSERT INTO game_genres (canonical_id, genre_id)
           SELECT 'steam:1145350', id FROM genres WHERE name = 'Existing'`,
        )
        .run();

      await enrichSteamMetadata(db.raw, { delayMs: 0 }, async () => details());

      expect(genreNames(db.raw, 'steam:1145350')).toEqual([
        'Action',
        'Existing',
        'Roguelike',
      ]);
    });

    it('skips coming_soon release dates', async () => {
      upsertGames(db.raw, [makeGame()]);

      await enrichSteamMetadata(
        db.raw,
        { delayMs: 0 },
        async () =>
          details({
            release_date: { coming_soon: true, date: 'Dec 31, 2027' },
          }),
      );

      expect(readGame(db.raw, 'steam:1145350').release_date).toBeNull();
    });
  });
});

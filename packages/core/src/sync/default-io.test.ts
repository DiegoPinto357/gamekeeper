import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, addInterest, addOwnedGame, type Db } from '../db/index';
import { defaultSyncIO } from './default-io';
import { shouldForceMerge } from '../core/overrides';

vi.mock('fs/promises');

const dirs: string[] = [];
let db: Db | null = null;

const seedDb = (): Db => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-default-io-'));
  dirs.push(dir);
  const file = path.join(dir, 'gamekeeper.db');
  vi.stubEnv('GAMEKEEPER_DB', file);
  db = openDb(file);
  return db;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  // Clear the module-level overrides cache via a fresh empty db so it
  // never leaks across tests
  const clearDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-io-clear-'));
  vi.stubEnv('GAMEKEEPER_DB', path.join(clearDir, 'gamekeeper.db'));
  await defaultSyncIO.loadOverrides();
  vi.unstubAllEnvs();

  if (db) {
    db.close();
    db = null;
  }
  fs.rmSync(clearDir, { recursive: true, force: true });
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('defaultSyncIO (DB-backed, P0B)', () => {
  describe('loadInterests', () => {
    it('returns interest entries from the database in insertion order', async () => {
      const database = seedDb();
      addInterest(database.raw, 'Starfield');
      addInterest(database.raw, 'Hi-Fi RUSH');

      const interests = await defaultSyncIO.loadInterests();

      expect(interests).toEqual([
        { id: 'manual:starfield', title: 'Starfield' },
        { id: 'manual:hi-fi-rush', title: 'Hi-Fi RUSH' },
      ]);
    });

    it('returns an empty list (never null) for an empty database', async () => {
      seedDb();

      const interests = await defaultSyncIO.loadInterests();

      expect(interests).toEqual([]);
    });
  });

  describe('loadOverrides', () => {
    it('loads force-merge rules and property overrides into the cache', async () => {
      const database = seedDb();
      database.raw
        .prepare(
          'INSERT INTO force_merge_rules (match_ids, match_names, canonical_name, position) VALUES (?, ?, ?, ?)',
        )
        .run(
          '[]',
          JSON.stringify(['Disco Elysium', 'Disco Elysium - The Final Cut']),
          'Disco Elysium',
          1,
        );
      database.raw
        .prepare(
          'INSERT INTO property_overrides (match_id, match_name, properties) VALUES (?, ?, ?)',
        )
        .run(null, 'FUEL', JSON.stringify({ steamAppId: 40100 }));

      const overrides = await defaultSyncIO.loadOverrides();

      expect(overrides.forceMerge).toEqual([
        {
          games: ['Disco Elysium', 'Disco Elysium - The Final Cut'],
          canonicalName: 'Disco Elysium',
        },
      ]);
      expect(overrides.propertyOverrides).toEqual([
        { match: 'FUEL', properties: { steamAppId: 40100 } },
      ]);
      // cache is what the synchronous dedupe path reads
      expect(
        shouldForceMerge('Disco Elysium', 'Disco Elysium - The Final Cut'),
      ).toBe('Disco Elysium');
    });
  });

  describe('processGamePassAvailability', () => {
    it('flags seeded interests that are missing from the catalog', async () => {
      const database = seedDb();
      addInterest(database.raw, 'Future Game');

      const result = await defaultSyncIO.processGamePassAvailability([], []);

      expect(result.unavailable).toHaveLength(1);
      expect(result.unavailable[0].name).toBe('future game');
      expect(result.unavailable[0].reason).toBe('interest-unavailable');
    });

    it('flags played xbox games that left the catalog and are not owned', async () => {
      seedDb();

      const result = await defaultSyncIO.processGamePassAvailability(
        [
          {
            name: 'Old Game',
            source: 'xbox',
            externalId: 'xbox-old-game',
          },
        ],
        [],
      );

      expect(result.unavailable).toHaveLength(1);
      expect(result.unavailable[0].reason).toBe('left-catalog');
    });

    it('does not flag owned xbox games that left the catalog', async () => {
      const database = seedDb();
      addOwnedGame(database.raw, { name: 'Halo Infinite' });

      const result = await defaultSyncIO.processGamePassAvailability(
        [
          {
            name: 'Halo Infinite',
            source: 'xbox',
            externalId: 'xbox-halo-infinite',
          },
        ],
        [],
      );

      expect(result.unavailable).toHaveLength(0);
    });
  });
});

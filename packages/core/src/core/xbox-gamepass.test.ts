import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'node:path';
import os from 'node:os';
import nodeFs from 'node:fs';
import { openDb, addOwnedGame, addInterest, type Db } from '../db/index';
import {
  loadOwnedXboxGames,
  loadGamePassInterests,
  isOwnedOnXbox,
  isAvailableOnGamePass,
  processGamePassAvailability,
  resolveXboxSource,
  shouldSyncToNotion,
  getInterestGamesToSync,
  selectInterestGames,
} from './xbox-gamepass';
import { RawGameData, Source } from '../types/game';
import { GamePassGame } from '../adapters/gamepass.adapter';

vi.mock('fs/promises');

const createGame = (
  name: string,
  source: Source,
  options: Partial<RawGameData> = {},
): RawGameData => ({
  name,
  source,
  externalId: `${source}-${name.toLowerCase().replace(/\s+/g, '-')}`,
  ...options,
});

const createGamePassGame = (
  title: string,
  available: boolean = true,
): GamePassGame => ({
  id: title.toLowerCase().replace(/\s+/g, '-'),
  title,
  available,
});

type Fixture = { db: Db; dir: string };
const fixtures: Fixture[] = [];

const makeDb = (): Db => {
  const dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-xgp-'));
  const db = openDb(path.join(dir, 'lib.db'));
  fixtures.push({ db, dir });
  return db;
};

const seedOwned = (db: Db, names: string[]): void => {
  for (const name of names) addOwnedGame(db.raw, { name });
};

const seedInterests = (db: Db, titles: string[]): void => {
  for (const title of titles) addInterest(db.raw, title);
};

describe('xbox-gamepass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const { db, dir } of fixtures.splice(0)) {
      db.close();
      nodeFs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('loadOwnedXboxGames', () => {
    it('loads and normalizes owned Xbox games from the db', async () => {
      const db = makeDb();
      seedOwned(db, ['Halo Infinite', 'Forza Horizon 5']);

      const owned = await loadOwnedXboxGames(db.raw);

      expect(owned.has('halo infinite')).toBe(true);
      expect(owned.has('forza horizon 5')).toBe(true);
    });

    it('returns an empty set when no rows exist', async () => {
      const db = makeDb();

      const owned = await loadOwnedXboxGames(db.raw);

      expect(owned.size).toBe(0);
    });
  });

  describe('loadGamePassInterests', () => {
    it('loads and normalizes interest games from the db', async () => {
      const db = makeDb();
      seedInterests(db, ['Starfield', 'Hi-Fi RUSH']);

      const interests = await loadGamePassInterests(db.raw);

      expect(interests.has('starfield')).toBe(true);
      expect(interests.has('hi fi rush')).toBe(true);
    });

    it('returns an empty set when no rows exist', async () => {
      const db = makeDb();

      const interests = await loadGamePassInterests(db.raw);

      expect(interests.size).toBe(0);
    });
  });

  describe('isOwnedOnXbox', () => {
    it('returns true for owned games', async () => {
      const db = makeDb();
      seedOwned(db, ['Halo Infinite']);

      expect(await isOwnedOnXbox(db.raw, 'Halo Infinite')).toBe(true);
    });

    it('returns false for non-owned games', async () => {
      const db = makeDb();
      seedOwned(db, ['Halo Infinite']);

      expect(await isOwnedOnXbox(db.raw, 'Starfield')).toBe(false);
    });
  });

  describe('isAvailableOnGamePass', () => {
    it('finds games in catalog by normalized name', async () => {
      const catalog = [
        createGamePassGame('Hollow Knight'),
        createGamePassGame('Starfield'),
      ];

      expect(await isAvailableOnGamePass('Hollow Knight', catalog)).toBe(true);
      expect(await isAvailableOnGamePass('Forza', catalog)).toBe(false);
    });

    it('handles name normalization', async () => {
      const catalog = [createGamePassGame('Hi-Fi RUSH')];

      expect(await isAvailableOnGamePass('Hi Fi RUSH', catalog)).toBe(true);
    });

    it('matches swapped subtitle/main-title order (word-sorted equality)', async () => {
      const catalog = [createGamePassGame("Hellblade II: Senua's Saga")];

      expect(
        await isAvailableOnGamePass("Senua's Saga: Hellblade II", catalog),
      ).toBe(true);
      expect(
        await isAvailableOnGamePass("Hellblade II: Senua's Saga", catalog),
      ).toBe(true);
    });

    it('still matches edition suffixes after word-sorted equality', async () => {
      const catalog = [
        createGamePassGame(
          'Call of Duty®: Modern Warfare® - Digital Standard Edition (Windows)',
        ),
      ];

      expect(
        await isAvailableOnGamePass('Call of Duty: Modern Warfare', catalog),
      ).toBe(true);
    });

    it('does not match sequels via word-sorted equality', async () => {
      const catalog = [createGamePassGame('Call of Duty: Modern Warfare II')];

      expect(
        await isAvailableOnGamePass('Call of Duty: Modern Warfare', catalog),
      ).toBe(false);
    });
  });

  describe('resolveXboxSource', () => {
    it('returns xbox for owned games', async () => {
      const db = makeDb();
      seedOwned(db, ['Halo Infinite']);

      const catalog = [createGamePassGame('Halo Infinite')];
      const source = await resolveXboxSource(db.raw, 'Halo Infinite', catalog);

      expect(source).toBe('xbox');
    });

    it('returns gamepass for non-owned available games', async () => {
      const db = makeDb();

      const catalog = [createGamePassGame('Starfield')];
      const source = await resolveXboxSource(db.raw, 'Starfield', catalog);

      expect(source).toBe('gamepass');
    });

    it('returns xbox for non-owned unavailable games', async () => {
      const db = makeDb();

      const catalog: GamePassGame[] = [];
      const source = await resolveXboxSource(db.raw, 'Old Game', catalog);

      expect(source).toBe('xbox');
    });
  });

  describe('shouldSyncToNotion', () => {
    it('always syncs non-Xbox/GamePass games', async () => {
      const db = makeDb();
      const game = createGame('Portal 2', 'steam');

      expect(await shouldSyncToNotion(db.raw, game, [])).toBe(true);
    });

    it('syncs owned Xbox games even if not on Game Pass', async () => {
      const db = makeDb();
      seedOwned(db, ['Halo Infinite']);
      const game = createGame('Halo Infinite', 'xbox');

      expect(await shouldSyncToNotion(db.raw, game, [])).toBe(true);
    });

    it('syncs Game Pass games if available', async () => {
      const db = makeDb();
      const game = createGame('Starfield', 'gamepass');
      const catalog = [createGamePassGame('Starfield')];

      expect(await shouldSyncToNotion(db.raw, game, catalog)).toBe(true);
    });

    it('does not sync non-owned Xbox games not on Game Pass', async () => {
      const db = makeDb();
      const game = createGame('Old Game', 'xbox');

      expect(await shouldSyncToNotion(db.raw, game, [])).toBe(false);
    });
  });

  describe('processGamePassAvailability', () => {
    it('identifies played games that left Game Pass', async () => {
      const db = makeDb();
      const playedGames = [createGame('Old Game', 'xbox')];
      const catalog: GamePassGame[] = [];

      const result = await processGamePassAvailability(
        db.raw,
        playedGames,
        catalog,
      );

      expect(result.unavailable).toHaveLength(1);
      expect(result.unavailable[0].name).toBe('Old Game');
      expect(result.unavailable[0].reason).toBe('left-catalog');
      expect(result.unavailable[0].wasPlayed).toBe(true);
    });

    it('identifies interest games not on Game Pass', async () => {
      const db = makeDb();
      seedInterests(db, ['Future Game']);

      const result = await processGamePassAvailability(db.raw, [], []);

      expect(result.unavailable).toHaveLength(1);
      expect(result.unavailable[0].name).toBe('future game');
      expect(result.unavailable[0].reason).toBe('interest-unavailable');
      expect(result.unavailable[0].wasPlayed).toBe(false);
    });

    it('tracks returned games', async () => {
      const db = makeDb();
      seedInterests(db, ['Returned Game']);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          unavailableGames: [
            {
              name: 'Returned Game',
              reason: 'left-catalog',
              wasPlayed: true,
            },
          ],
          lastUpdated: new Date().toISOString(),
        }),
      );

      const catalog = [createGamePassGame('Returned Game')];

      const result = await processGamePassAvailability(db.raw, [], catalog);

      expect(result.returned).toContain('returned game');
    });
  });

  describe('getInterestGamesToSync', () => {
    it('returns interest games available on Game Pass', async () => {
      const db = makeDb();
      seedInterests(db, ['Starfield', 'Unavailable Game']);

      const catalog = [createGamePassGame('Starfield')];
      const played: RawGameData[] = [];

      const result = await getInterestGamesToSync(db.raw, catalog, played);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Starfield');
    });

    it('uses the clean interest name, not the verbose catalog title', async () => {
      const db = makeDb();
      seedInterests(db, ['Call of Duty: Modern Warfare']);

      const catalog = [
        createGamePassGame(
          'Call of Duty®: Modern Warfare® - Digital Standard Edition (Windows)',
        ),
      ];
      const result = await getInterestGamesToSync(db.raw, catalog, []);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Call of Duty: Modern Warfare');
    });

    it('carries catalog description/genres/developer/publisher into RawGameData', async () => {
      const db = makeDb();
      seedInterests(db, ['Starfield']);

      const catalog = [
        {
          id: 'starfield-id',
          title: 'Starfield',
          available: true,
          description: 'Space RPG.',
          genres: ['Role-playing (RPG)'],
          developer: 'Bethesda Game Studios',
          publisher: 'Bethesda Softworks',
        },
      ];
      const result = await getInterestGamesToSync(db.raw, catalog, []);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'Starfield',
        description: 'Space RPG.',
        genres: ['Role-playing (RPG)'],
        developer: 'Bethesda Game Studios',
        publisher: 'Bethesda Softworks',
      });
    });

    it('deduplicates interests that normalize to the same name', async () => {
      const db = makeDb();
      seedInterests(db, [
        "Assassin's Creed® Mirage",
        "Assassin's Creed Mirage",
      ]);

      const catalog = [
        createGamePassGame('Assassin’s Creed® Mirage'),
      ];
      const result = await getInterestGamesToSync(db.raw, catalog, []);

      expect(result).toHaveLength(1);
    });

    it('includes interest games even if already played', async () => {
      const db = makeDb();
      seedInterests(db, ['Starfield']);

      const catalog = [createGamePassGame('Starfield')];
      const played = [createGame('Starfield', 'gamepass')];

      const result = await getInterestGamesToSync(db.raw, catalog, played);

      expect(result).toHaveLength(1);
    });

    it('excludes unavailable interest games', async () => {
      const db = makeDb();
      seedInterests(db, ['Not Available']);

      const result = await getInterestGamesToSync(db.raw, [], []);

      expect(result).toHaveLength(0);
    });
  });

  describe('selectInterestGames — id-equality (P0B rekey)', () => {
    it('matches a catalog-backed interest by id even when titles differ', async () => {
      const entries = [{ id: 'prod-1', title: 'User Clean Name' }];
      const catalog: GamePassGame[] = [
        { id: 'prod-1', title: 'A Totally Different Verbose Title', available: true },
      ];

      const result = await selectInterestGames(entries, catalog, []);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('User Clean Name');
      expect(result[0].externalId).toBe('gamepass-interest-prod-1');
    });

    it('falls back to name matching for legacy manual: ids', async () => {
      const entries = [{ id: 'manual:starfield', title: 'Starfield' }];
      const catalog: GamePassGame[] = [
        { id: 'prod-9', title: 'Starfield', available: true },
      ];

      const result = await selectInterestGames(entries, catalog, []);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Starfield');
    });

    it('does not match an unavailable catalog row by id', async () => {
      const entries = [{ id: 'prod-1', title: 'Some Game' }];
      const catalog: GamePassGame[] = [
        { id: 'prod-1', title: 'Some Game', available: false },
      ];

      const result = await selectInterestGames(entries, catalog, []);

      expect(result).toHaveLength(0);
    });

    it('skips an id-backed interest with no catalog match and no name match', async () => {
      const entries = [{ id: 'prod-1', title: 'Unrelated Name' }];
      const catalog: GamePassGame[] = [
        { id: 'prod-2', title: 'Different Game', available: true },
      ];

      const result = await selectInterestGames(entries, catalog, []);

      expect(result).toHaveLength(0);
    });
  });

  describe('Integration: Xbox/Game Pass tagging scenarios', () => {
    it('owned Xbox game available on Game Pass gets Xbox tag only', async () => {
      const db = makeDb();
      seedOwned(db, ['Halo Infinite']);

      const catalog = [createGamePassGame('Halo Infinite')];
      const source = await resolveXboxSource(db.raw, 'Halo Infinite', catalog);

      expect(source).toBe('xbox');
    });

    it('played but not owned game on Game Pass gets gamepass tag', async () => {
      const db = makeDb();

      const game = createGame('Starfield', 'xbox');
      const catalog = [createGamePassGame('Starfield')];

      const shouldSync = await shouldSyncToNotion(db.raw, game, catalog);
      expect(shouldSync).toBe(true);
    });

    it('played game left Game Pass and not owned does not sync', async () => {
      const db = makeDb();

      const game = createGame('Old Game', 'xbox');
      const catalog: GamePassGame[] = [];

      const shouldSync = await shouldSyncToNotion(db.raw, game, catalog);
      expect(shouldSync).toBe(false);
    });
  });

  describe('catalog matching — smart quotes and verbose titles', () => {
    it('matches interest with straight apostrophe against catalog title with curly apostrophe', async () => {
      // Microsoft catalog uses U+2019 curly apostrophe; interests use straight apostrophe
      const catalog = [
        createGamePassGame('Assassin’s Creed® Mirage'),
      ];

      expect(
        await isAvailableOnGamePass("Assassin's Creed® Mirage", catalog),
      ).toBe(true);
    });

    it('matches Tom Clancy title with curly apostrophe in catalog', async () => {
      const catalog = [createGamePassGame('Tom Clancy’s The Division 2')];

      expect(
        await isAvailableOnGamePass("Tom Clancy's The Division 2", catalog),
      ).toBe(true);
    });

    it('matches interest against verbose catalog title containing it as substring', async () => {
      // Catalog: "Call of Duty®: Modern Warfare® - Digital Standard Edition (Windows)"
      const catalog = [
        createGamePassGame(
          'Call of Duty®: Modern Warfare® - Digital Standard Edition (Windows)',
        ),
      ];

      expect(
        await isAvailableOnGamePass('Call of Duty: Modern Warfare', catalog),
      ).toBe(true);
    });

    it('does NOT match a short interest name against a long unrelated catalog title', async () => {
      const catalog = [
        createGamePassGame(
          'Call of Duty: Black Ops 6 Extended Ultimate Mega Edition',
        ),
      ];

      // "Doom" (too short for substring guard) should not match
      expect(await isAvailableOnGamePass('Doom', catalog)).toBe(false);
    });

    it('processGamePassAvailability does not flag interests that match via smart quotes', async () => {
      const db = makeDb();
      seedInterests(db, ["Assassin's Creed® Mirage"]);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ unavailableGames: [] }),
      );

      const catalog = [
        createGamePassGame('Assassin’s Creed® Mirage'),
      ];
      const result = await processGamePassAvailability(db.raw, [], catalog);

      expect(result.unavailable).toHaveLength(0);
    });

    it('getInterestGamesToSync matches via substring for verbose catalog titles', async () => {
      const db = makeDb();
      seedInterests(db, ['Call of Duty: Modern Warfare']);

      const catalog = [
        createGamePassGame(
          'Call of Duty®: Modern Warfare® - Digital Standard Edition (Windows)',
        ),
      ];
      const result = await getInterestGamesToSync(db.raw, catalog, []);

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('gamepass');
    });

    it('does NOT match sequel-numbered title as prefix of base interest name', async () => {
      // "Modern Warfare" interest must not match "Modern Warfare II" catalog entry
      const catalog = [
        createGamePassGame(
          'Call of Duty®: Modern Warfare® II - Standard Edition (Windows)',
        ),
        createGamePassGame(
          'Call of Duty®: Modern Warfare® III - Standard Edition (Windows)',
        ),
      ];

      // Without the original MW I in the catalog, the interest should NOT match MW II or III
      expect(
        await isAvailableOnGamePass('Call of Duty: Modern Warfare', catalog),
      ).toBe(false);
    });

    it('matches "Modern Warfare II" interest against the MW II catalog entry', async () => {
      const catalog = [
        createGamePassGame(
          'Call of Duty®: Modern Warfare® - Digital Standard Edition (Windows)',
        ),
        createGamePassGame(
          'Call of Duty®: Modern Warfare® II - Standard Edition (Windows)',
        ),
      ];

      expect(
        await isAvailableOnGamePass('Call of Duty: Modern Warfare II', catalog),
      ).toBe(true);
    });
  });
});

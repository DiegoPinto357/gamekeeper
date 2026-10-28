import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UnifiedGame } from '../../types/game';
import { openDb, type Db } from '../connection';
import { upsertGames, rebuildGamesFts } from './games';
import { parseDiscoverFilters, queryGames, getFacets } from './discover';

const base = {
  primarySource: 'steam' as const,
  ownedSources: ['steam' as const],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const makeGame = (overrides: Partial<UnifiedGame> & { canonicalId: string; name: string }): UnifiedGame =>
  ({ ...base, ...overrides } as UnifiedGame);

const hades = makeGame({
  canonicalId: 'hades-ii',
  name: 'Hades II',
  genres: ['Action', 'Roguelike'],
  playtimeHours: 12.5,
  releaseDate: new Date('2024-05-06T00:00:00.000Z'),
  proton: { tier: 'gold', steamDeck: 'verified' },
  description: 'A roguelike dungeon crawler',
});

const celeste = makeGame({
  canonicalId: 'celeste',
  name: 'Celeste',
  primarySource: 'gog',
  ownedSources: ['gog', 'steam'],
  genres: ['Platformer'],
  playtimeHours: 3,
  releaseDate: new Date('2018-01-25T00:00:00.000Z'),
  proton: { tier: 'platinum', steamDeck: 'playable' },
});

const outerWilds = makeGame({
  canonicalId: 'outer-wilds',
  name: 'Outer Wilds',
  primarySource: 'epic',
  ownedSources: ['epic'],
  genres: ['Adventure'],
  // unplayed: no playtime, no release date, no proton
});

const insertTag = (db: Db, canonicalId: string, tag: string): void => {
  db.raw.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(tag);
  db.raw
    .prepare(
      `INSERT INTO game_tags (canonical_id, tag_id)
       SELECT ?, id FROM tags WHERE name = ?
       ON CONFLICT(canonical_id, tag_id) DO NOTHING`,
    )
    .run(canonicalId, tag);
};

const setStatus = (db: Db, canonicalId: string, status: string): void => {
  db.raw
    .prepare(
      `INSERT INTO game_status (canonical_id, status, position)
       VALUES (?, ?, NULL)
       ON CONFLICT(canonical_id) DO UPDATE SET status = excluded.status`,
    )
    .run(canonicalId, status);
};

describe('discover', () => {
  let db: Db;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-discover-'));
    db = openDb(path.join(dir, 'lib.db'));
    upsertGames(db.raw, [hades, celeste, outerWilds]);
    insertTag(db, 'hades-ii', 'mythology');
    insertTag(db, 'celeste', 'indies');
    insertTag(db, 'outer-wilds', 'indies');
    insertTag(db, 'outer-wilds', 'space');
    setStatus(db, 'hades-ii', 'playing');
    setStatus(db, 'celeste', 'completed');
    rebuildGamesFts(db.raw);
  });

  afterEach(() => {
    db.close();
  });

  describe('parseDiscoverFilters', () => {
    it('maps query params: comma lists, repeated keys, numbers', () => {
      expect(
        parseDiscoverFilters({
          q: 'hades',
          genre: 'Action,Roguelike',
          tag: ['indies', 'space'],
          source: 'steam',
          status: 'playing,completed',
          deck: 'verified',
          proton: 'gold,platinum',
          year: '2024,2018',
          playtimeMin: '5',
          playtimeMax: '50.5',
          yearMin: '2018',
          yearMax: '2024',
        }),
      ).toEqual({
        q: 'hades',
        genres: ['Action', 'Roguelike'],
        tags: ['indies', 'space'],
        sources: ['steam'],
        statuses: ['playing', 'completed'],
        decks: ['verified'],
        protonTiers: ['gold', 'platinum'],
        years: [2024, 2018],
        playtimeMin: 5,
        playtimeMax: 50.5,
        yearMin: 2018,
        yearMax: 2024,
      });
    });

    it('ignores empty and invalid params', () => {
      expect(
        parseDiscoverFilters({
          genre: '',
          playtimeMin: 'not-a-number',
          yearMax: '',
          deck: 'quantum',
          proton: 'wood',
        }),
      ).toEqual({});
    });

    it('returns {} for no params', () => {
      expect(parseDiscoverFilters({})).toEqual({});
    });
  });

  describe('queryGames', () => {
    const names = (filters: Parameters<typeof queryGames>[1]) =>
      queryGames(db.raw, filters).games.map((g) => g.name);

    it('returns all games ordered by name with facets fields', () => {
      const { games, total } = queryGames(db.raw, {});
      expect(total).toBe(3);
      expect(games.map((g) => g.name)).toEqual(['Celeste', 'Hades II', 'Outer Wilds']);
      const h = games.find((g) => g.canonicalId === 'hades-ii')!;
      expect(h).toMatchObject({
        name: 'Hades II',
        genres: ['Action', 'Roguelike'],
        status: 'playing',
        deck: 'verified',
        protonTier: 'gold',
        playtimeHours: 12.5,
        year: 2024,
        ownedSources: ['steam'],
      });
    });

    it('defaults status to backlog when untracked', () => {
      expect(names({ statuses: ['backlog'] })).toEqual(['Outer Wilds']);
      expect(names({ statuses: ['playing'] })).toEqual(['Hades II']);
    });

    it('filters by genre (OR within facet)', () => {
      expect(names({ genres: ['Action', 'Platformer'] })).toEqual(['Celeste', 'Hades II']);
    });

    it('filters by tag', () => {
      expect(names({ tags: ['space'] })).toEqual(['Outer Wilds']);
      expect(names({ tags: ['indies'] })).toEqual(['Celeste', 'Outer Wilds']);
    });

    it('filters by owned source', () => {
      expect(names({ sources: ['gog'] })).toEqual(['Celeste']);
      expect(names({ sources: ['steam'] })).toEqual(['Celeste', 'Hades II']);
    });

    it('filters by deck and proton tier', () => {
      expect(names({ decks: ['verified'] })).toEqual(['Hades II']);
      expect(names({ decks: ['verified', 'playable'] })).toEqual(['Celeste', 'Hades II']);
      expect(names({ protonTiers: ['platinum'] })).toEqual(['Celeste']);
    });

    it('filters by playtime range and release year range', () => {
      expect(names({ playtimeMin: 5 })).toEqual(['Hades II']);
      expect(names({ playtimeMax: 5 })).toEqual(['Celeste']);
      expect(names({ yearMin: 2020 })).toEqual(['Hades II']);
      expect(names({ yearMin: 2010, yearMax: 2020 })).toEqual(['Celeste']);
    });

    it('filters by exact release years (OR within list)', () => {
      expect(names({ years: [2018, 2024] })).toEqual(['Celeste', 'Hades II']);
      expect(names({ years: [2018] })).toEqual(['Celeste']);
      expect(names({ years: [1999] })).toEqual([]);
    });

    it('searches via FTS across name, description, genres, and tags', () => {
      expect(names({ q: 'roguelike' })).toEqual(['Hades II']); // genre column
      expect(names({ q: 'dungeon' })).toEqual(['Hades II']); // description column
      expect(names({ q: 'mythology' })).toEqual(['Hades II']); // tags column
      expect(names({ q: 'celes' })).toEqual(['Celeste']); // prefix match on name
      expect(names({ q: 'unobtainium' })).toEqual([]);
    });

    it('ANDs across dimensions', () => {
      expect(
        names({ genres: ['Action'], statuses: ['playing'], decks: ['verified'] }),
      ).toEqual(['Hades II']);
      expect(names({ genres: ['Action'], statuses: ['completed'] })).toEqual([]);
      expect(names({ genres: ['Platformer'], sources: ['gog'], playtimeMin: 10 })).toEqual([]);
    });
  });

  describe('getFacets', () => {
    it('counts every dimension over the whole library', () => {
      const facets = getFacets(db.raw, {});
      expect(facets.genres).toEqual([
        { value: 'Action', count: 1 },
        { value: 'Adventure', count: 1 },
        { value: 'Platformer', count: 1 },
        { value: 'Roguelike', count: 1 },
      ]);
      expect(facets.tags).toEqual([
        { value: 'indies', count: 2 },
        { value: 'mythology', count: 1 },
        { value: 'space', count: 1 },
      ]);
      expect(facets.sources).toEqual([
        { value: 'steam', count: 2 },
        { value: 'epic', count: 1 },
        { value: 'gog', count: 1 },
      ]);
      expect(facets.statuses).toEqual([
        { value: 'backlog', count: 1 },
        { value: 'completed', count: 1 },
        { value: 'playing', count: 1 },
      ]);
      expect(facets.decks).toEqual([
        { value: 'playable', count: 1 },
        { value: 'verified', count: 1 },
      ]);
      expect(facets.protonTiers).toEqual([
        { value: 'gold', count: 1 },
        { value: 'platinum', count: 1 },
      ]);
      expect(facets.years).toEqual([
        { value: 2018, count: 1 },
        { value: 2024, count: 1 },
      ]);
    });

    it('counts a dimension against the OTHER filters, excluding its own', () => {
      // deck filter narrows genre counts but genre counts ignore genre filter
      const facets = getFacets(db.raw, { decks: ['verified'] });
      expect(facets.genres).toEqual([
        { value: 'Action', count: 1 },
        { value: 'Roguelike', count: 1 },
      ]);
      // decks facet ignores the deck filter → full picture over the library
      expect(facets.decks).toEqual([
        { value: 'playable', count: 1 },
        { value: 'verified', count: 1 },
      ]);
    });

    it('genre filter narrows tag and status counts', () => {
      const facets = getFacets(db.raw, { genres: ['Platformer'] });
      expect(facets.tags).toEqual([{ value: 'indies', count: 1 }]);
      expect(facets.statuses).toEqual([{ value: 'completed', count: 1 }]);
      expect(facets.genres).toEqual([
        { value: 'Action', count: 1 },
        { value: 'Adventure', count: 1 },
        { value: 'Platformer', count: 1 },
        { value: 'Roguelike', count: 1 },
      ]);
    });

    it('respects q across facets', () => {
      const facets = getFacets(db.raw, { q: 'indies' });
      expect(facets.genres).toEqual([
        { value: 'Adventure', count: 1 },
        { value: 'Platformer', count: 1 },
      ]);
    });

    it('years facet ignores year filters', () => {
      const facets = getFacets(db.raw, { years: [2024] });
      expect(facets.years).toEqual([
        { value: 2018, count: 1 },
        { value: 2024, count: 1 },
      ]);
      // but respects other dimensions
      expect(facets.genres).toEqual([
        { value: 'Action', count: 1 },
        { value: 'Roguelike', count: 1 },
      ]);
    });
  });
});

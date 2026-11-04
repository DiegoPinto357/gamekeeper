import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UnifiedGame } from '../types/game';
import { openDb, type Db } from '../db/connection';
import { upsertGames } from '../db/repos/games';
import type { DiscoverFilters, DiscoverGame } from '../db/repos/discover';
import {
  SHELF_SIZE,
  SUGGEST_STATUSES,
  candidateWeight,
  completedGenreAffinity,
  pickWeighted,
  suggestPick,
  suggestReasons,
  suggestShelves,
} from './suggest';

const base = {
  primarySource: 'steam' as const,
  ownedSources: ['steam' as const],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const makeGame = (
  overrides: Partial<UnifiedGame> & { canonicalId: string; name: string },
): UnifiedGame => ({ ...base, ...overrides }) as UnifiedGame;

/** Minimal DiscoverGame for pure-weight tests. */
const dg = (status: string, genres: string[] = []): DiscoverGame => ({
  canonicalId: `g-${status}`,
  name: status,
  primarySource: 'steam',
  ownedSources: ['steam'],
  status,
  genres,
  tags: [],
});

const aff = (entries: [string, number][]): Map<string, number> =>
  new Map(entries);

const insertTag = (db: Db, canonicalId: string, tag: string): void => {
  db.raw
    .prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING')
    .run(tag);
  db.raw
    .prepare(
      `INSERT INTO game_tags (canonical_id, tag_id)
       SELECT ?, id FROM tags WHERE name = ?
       ON CONFLICT(canonical_id, tag_id) DO NOTHING`,
    )
    .run(canonicalId, tag);
};

const setStatus = (
  db: Db,
  canonicalId: string,
  status: string,
  updatedAt?: string,
): void => {
  db.raw
    .prepare(
      `INSERT INTO game_status (canonical_id, status, position, updated_at)
       VALUES (?, ?, NULL, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))
       ON CONFLICT(canonical_id) DO UPDATE SET status = excluded.status`,
    )
    .run(canonicalId, status, updatedAt ?? null);
};

// ineligible
const hadesIi = makeGame({
  canonicalId: 'hades-ii',
  name: 'Hades II',
  genres: ['Action', 'Roguelike'],
  playtimeHours: 12.5,
  proton: { tier: 'gold', steamDeck: 'verified' },
});
const celeste = makeGame({
  canonicalId: 'celeste',
  name: 'Celeste',
  primarySource: 'gog',
  ownedSources: ['gog', 'steam'],
  genres: ['Platformer'],
  playtimeHours: 3,
  proton: { tier: 'platinum', steamDeck: 'playable' },
});
const deadCells = makeGame({
  canonicalId: 'dead-cells',
  name: 'Dead Cells',
  genres: ['Roguelike'],
  playtimeHours: 40,
});

// eligible
const outerWilds = makeGame({
  canonicalId: 'outer-wilds',
  name: 'Outer Wilds',
  primarySource: 'epic',
  ownedSources: ['epic'],
  genres: ['Adventure'],
});
const balatro = makeGame({
  canonicalId: 'balatro',
  name: 'Balatro',
  genres: ['Card', 'Roguelike'],
  proton: { tier: 'gold', steamDeck: 'verified' },
});
const hades = makeGame({
  canonicalId: 'hades',
  name: 'Hades',
  genres: ['Action'],
  playtimeHours: 8,
});
const silksong = makeGame({
  canonicalId: 'silksong',
  name: 'Silksong',
  genres: ['Metroidvania', 'Adventure'],
});
const discoElysium = makeGame({
  canonicalId: 'disco-elysium',
  name: 'Disco Elysium',
  primarySource: 'gog',
  ownedSources: ['gog'],
  genres: ['RPG', 'Adventure'],
});
const obraDinn = makeGame({
  canonicalId: 'obra-dinn',
  name: 'Return of the Obra Dinn',
  primarySource: 'gog',
  ownedSources: ['gog'],
  genres: ['Puzzle', 'Adventure'],
});
const tunic = makeGame({
  canonicalId: 'tunic',
  name: 'Tunic',
  primarySource: 'epic',
  ownedSources: ['epic'],
  genres: ['Adventure', 'Puzzle'],
  playtimeHours: 2,
});

const ELIGIBLE_IDS = [
  'balatro',
  'disco-elysium',
  'hades',
  'obra-dinn',
  'outer-wilds',
  'silksong',
  'tunic',
];

describe('suggest', () => {
  let db: Db;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-suggest-'));
    db = openDb(path.join(dir, 'lib.db'));
    upsertGames(db.raw, [
      hadesIi,
      celeste,
      deadCells,
      outerWilds,
      balatro,
      hades,
      silksong,
      discoElysium,
      obraDinn,
      tunic,
    ]);
    insertTag(db, 'disco-elysium', 'indies');
    insertTag(db, 'balatro', 'cards');
    setStatus(db, 'hades-ii', 'playing');
    setStatus(db, 'dead-cells', 'completed');
    // celeste finished a year ago → weaker recency than dead-cells
    setStatus(db, 'celeste', 'completed', '2025-11-04T00:00:00.000Z');
    setStatus(db, 'balatro', 'queued_to_play');
    setStatus(db, 'hades', 'paused');
    setStatus(db, 'silksong', 'want_to_play');
    setStatus(db, 'obra-dinn', 'want_to_play');
    setStatus(db, 'tunic', 'paused');
    // outer-wilds + disco-elysium: no row → backlog
  });

  afterEach(() => {
    db.close();
  });

  it('exposes the four eligible statuses', () => {
    expect([...SUGGEST_STATUSES]).toEqual([
      'backlog',
      'queued_to_play',
      'want_to_play',
      'paused',
    ]);
    expect(SHELF_SIZE).toBe(8);
  });

  describe('candidateWeight', () => {
    it('weights eligible statuses backlog > queued > want > paused', () => {
      const empty = aff([]);
      expect(candidateWeight(dg('backlog'), empty)).toBe(5);
      expect(candidateWeight(dg('queued_to_play'), empty)).toBe(4);
      expect(candidateWeight(dg('want_to_play'), empty)).toBe(3);
      expect(candidateWeight(dg('paused'), empty)).toBe(2);
    });

    it('weighs ineligible statuses 0', () => {
      const empty = aff([]);
      for (const status of [
        'playing',
        'trying',
        'recurrent',
        'completed',
        'dropped',
      ]) {
        expect(candidateWeight(dg(status), empty)).toBe(0);
      }
    });

    it('boosts matched genres up to ×2 at strongest affinity', () => {
      const strong = aff([['Roguelike', 1]]);
      expect(candidateWeight(dg('backlog', ['Roguelike']), strong)).toBe(10);
      expect(candidateWeight(dg('backlog', ['RPG']), strong)).toBe(5);
      // partial affinity scales the boost
      const mixed = aff([
        ['Roguelike', 1],
        ['Card', 0.5],
      ]);
      expect(candidateWeight(dg('queued_to_play', ['Card']), mixed)).toBe(6);
      // best genre wins across several
      expect(
        candidateWeight(
          dg('backlog', ['RPG', 'Roguelike']),
          aff([
            ['RPG', 0.2],
            ['Roguelike', 1],
          ]),
        ),
      ).toBe(10);
    });

    it('falls back to base when affinity is empty or all-zero', () => {
      expect(candidateWeight(dg('paused', ['Roguelike']), aff([['RPG', 0]]))).toBe(
        2,
      );
      expect(candidateWeight(dg('paused', ['Roguelike']), aff([]))).toBe(2);
    });
  });

  describe('pickWeighted', () => {
    it('picks the first item at rng 0 and the last at rng 1', () => {
      expect(pickWeighted(['a', 'b', 'c'], [1, 1, 1], () => 0)).toBe('a');
      expect(pickWeighted(['a', 'b', 'c'], [1, 1, 1], () => 1)).toBe('c');
      expect(pickWeighted(['only'], [7], () => 0.99)).toBe('only');
    });

    it('follows the weight distribution', () => {
      const items = ['paused', 'backlog'];
      const weights = [2, 5];
      expect(pickWeighted(items, weights, () => 0.05)).toBe('paused');
      expect(pickWeighted(items, weights, () => 0.5)).toBe('backlog');
    });
  });

  describe('completedGenreAffinity', () => {
    it('scores only completed genres, recency-weighted', () => {
      const scores = completedGenreAffinity(db.raw);
      // dead-cells finished now → ~1; celeste a year old → ~0.2
      expect(scores.get('Roguelike')).toBeCloseTo(1, 1);
      expect(scores.get('Platformer')).toBeLessThan(scores.get('Roguelike')!);
      expect(scores.get('Platformer')).toBeGreaterThan(0);
      // genres from non-completed games never contribute
      expect(scores.has('Adventure')).toBe(false);
      expect(scores.has('Card')).toBe(false);
      expect(scores.has('RPG')).toBe(false);
    });

    it('is empty for a library with no completions', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-aff-'));
      const fresh = openDb(path.join(dir, 'lib.db'));
      upsertGames(fresh.raw, [outerWilds]);
      expect(completedGenreAffinity(fresh.raw).size).toBe(0);
      fresh.close();
    });
  });

  describe('suggestPick', () => {
    it('picks only from eligible statuses', () => {
      const pick = suggestPick(db.raw, {}, { rng: () => 0.5 });
      expect(pick).not.toBeNull();
      expect(SUGGEST_STATUSES).toContain(pick!.game.status);
      expect(['hades-ii', 'celeste', 'dead-cells']).not.toContain(
        pick!.game.canonicalId,
      );
    });

    it('is deterministic under an injected rng', () => {
      // queryGames orders by name → first eligible candidate is Balatro
      const pick = suggestPick(db.raw, {}, { rng: () => 0 });
      expect(pick?.game.canonicalId).toBe('balatro');
    });

    it('respects discover filters', () => {
      const pick = suggestPick(
        db.raw,
        { genres: ['Puzzle'] },
        { rng: () => 0 },
      );
      expect(pick?.game.canonicalId).toBe('obra-dinn');
    });

    it('skips excluded ids (spin again)', () => {
      const exclude = [...ELIGIBLE_IDS.slice(0, 6)]; // everything but tunic
      const pick = suggestPick(db.raw, {}, { rng: () => 0, exclude });
      expect(pick?.game.canonicalId).toBe('tunic');
    });

    it('returns null when the pool is empty', () => {
      expect(
        suggestPick(db.raw, { statuses: ['completed'] }, { rng: () => 0 }),
      ).toBeNull();
      expect(
        suggestPick(
          db.raw,
          {},
          { rng: () => 0, exclude: [...ELIGIBLE_IDS] },
        ),
      ).toBeNull();
    });

    it('affinity boost changes the pick for the same rng', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-aff2-'));
      const makePair = (withCompleted: boolean): string | undefined => {
        const fresh = openDb(path.join(dir, withCompleted ? 'a.db' : 'b.db'));
        const games = [
          makeGame({
            canonicalId: 'a-roguelike',
            name: 'Aaa',
            genres: ['Roguelike'],
          }),
          makeGame({ canonicalId: 'b-rpg', name: 'Bbb', genres: ['RPG'] }),
        ];
        if (withCompleted) {
          games.push(
            makeGame({ canonicalId: 'c-done', name: 'Ccc', genres: ['Roguelike'] }),
          );
        }
        upsertGames(fresh.raw, games);
        if (withCompleted) setStatus(fresh, 'c-done', 'completed');
        setStatus(fresh, 'a-roguelike', 'paused');
        const id = suggestPick(fresh.raw, {}, { rng: () => 0.4 })?.game
          .canonicalId;
        fresh.close();
        return id;
      };
      // no affinity: Aaa(paused, 2) loses to Bbb(backlog, 5) at rng 0.4
      expect(makePair(false)).toBe('b-rpg');
      // with Roguelike affinity: Aaa is boosted 2 → 4 and wins the 0..3.6 slice
      expect(makePair(true)).toBe('a-roguelike');
    });

    it('builds reason chips: status, never played, matched filters', () => {
      const pick = suggestPick(
        db.raw,
        {
          genres: ['Roguelike'],
          tags: ['cards'],
          sources: ['steam'],
          decks: ['verified'],
          protonTiers: ['gold'],
        },
        { rng: () => 0 },
      );
      expect(pick?.game.canonicalId).toBe('balatro');
      expect(pick?.reasons).toEqual([
        'Up Next',
        'Never played',
        'Roguelike',
        'cards',
        'Steam',
        'Deck verified',
        'ProtonDB gold',
      ]);
    });
  });

  describe('suggestReasons', () => {
    const labels = new Map([
      ['backlog', 'Backlog'],
      ['paused', 'Paused'],
      ['want_to_play', 'Want to Play'],
    ]);
    const game = dg('paused');
    game.playtimeHours = 8;
    game.ownedSources = ['gog', 'gamepass'];
    game.deck = 'playable';

    it('uses the seeded status label', () => {
      expect(suggestReasons(game, {}, labels)).toEqual(['Paused']);
    });

    it('falls back to the spaced status key when no label exists', () => {
      const want = dg('queued_to_play');
      expect(suggestReasons(want, {}, labels)).toEqual([
        'queued to play',
        'Never played',
      ]);
    });

    it('adds "Never played" only for zero/absent playtime', () => {
      expect(suggestReasons(game, {}, labels)).not.toContain('Never played');
      const unplayed = dg('backlog');
      expect(suggestReasons(unplayed, {}, labels)).toContain('Never played');
      const zeroed = dg('backlog');
      zeroed.playtimeHours = 0;
      expect(suggestReasons(zeroed, {}, labels)).toContain('Never played');
    });

    it('dedupes chips when a tag equals a genre', () => {
      const dup = dg('backlog', ['Indie']);
      dup.tags = ['Indie'];
      const filters: DiscoverFilters = { genres: ['Indie'], tags: ['Indie'] };
      expect(suggestReasons(dup, filters, labels)).toEqual([
        'Backlog',
        'Never played',
        'Indie',
      ]);
    });

    it('labels sources with display names', () => {
      const filters: DiscoverFilters = { sources: ['gog', 'gamepass'] };
      expect(suggestReasons(game, filters, labels)).toEqual([
        'Paused',
        'Gog',
        'Game Pass',
      ]);
    });
  });

  describe('suggestShelves', () => {
    const titles = (filters: DiscoverFilters = {}, seed = 7): string[] =>
      suggestShelves(db.raw, filters, { seed }).map((s) => s.title);
    const shelfKeys = (seed = 7): string[] =>
      suggestShelves(db.raw, {}, { seed }).map((s) => s.key);

    it('starts with the "Picked for you" hero capped at SHELF_SIZE', () => {
      const shelves = suggestShelves(db.raw, {}, { seed: 7 });
      expect(shelves[0].key).toBe('picked');
      expect(shelves[0].title).toBe('Picked for you');
      expect(shelves[0].games).toHaveLength(ELIGIBLE_IDS.length);
      for (const shelf of shelves) {
        expect(shelf.games.length).toBeLessThanOrEqual(SHELF_SIZE);
      }
    });

    it('only shelves eligible games', () => {
      const shelves = suggestShelves(db.raw, {}, { seed: 7 });
      const ids = shelves.flatMap((s) => s.games.map((g) => g.canonicalId));
      expect(ids.length).toBeGreaterThan(0);
      for (const shelf of shelves) {
        for (const game of shelf.games) {
          expect(SUGGEST_STATUSES).toContain(game.status);
        }
      }
      for (const id of ['hades-ii', 'celeste', 'dead-cells']) {
        expect(ids).not.toContain(id);
      }
    });

    it('builds affinity, genre, and tail shelves', () => {
      const shelves = suggestShelves(db.raw, {}, { seed: 7 });
      const byKey = new Map(shelves.map((s) => [s.key, s]));

      // strongest recent completion genre (Roguelike, from dead-cells)
      const more = byKey.get('genre:Roguelike');
      expect(more?.title).toBe('More Roguelike');
      expect(more?.games.map((g) => g.canonicalId)).toEqual(['balatro']);

      // only Adventure has ≥3 eligible games besides the affinity genre
      expect(byKey.get('genre:Adventure')?.title).toBe('Adventure');

      const tailKeys = shelves.map((s) => s.key);
      expect(tailKeys).toContain('paused');
      expect(tailKeys).toContain('want');
      expect(byKey.get('paused')?.title).toBe('Jump back in');
      expect(byKey.get('want')?.title).toBe('Want to play');
    });

    it('is stable for a seed and reshuffles across seeds', () => {
      const a = suggestShelves(db.raw, {}, { seed: 42 });
      const b = suggestShelves(db.raw, {}, { seed: 42 });
      expect(a).toEqual(b);
      const c = suggestShelves(db.raw, {}, { seed: 43 });
      expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
    });

    it('respects the shelf size option', () => {
      const shelves = suggestShelves(db.raw, {}, { seed: 3, size: 3 });
      for (const shelf of shelves) {
        expect(shelf.games.length).toBeLessThanOrEqual(3);
      }
      expect(shelves[0].games).toHaveLength(3);
    });

    it('drops shelves whose pool shrinks with filters', () => {
      // paused-only pool: no affinity bucket, no ≥3 genre buckets, no want tail
      expect(titles({ statuses: ['paused'] }, 5)).toEqual([
        'Picked for you',
        'Jump back in',
      ]);
    });

    it('returns [] when nothing qualifies', () => {
      expect(
        suggestShelves(db.raw, { statuses: ['completed'] }, { seed: 1 }),
      ).toEqual([]);
    });

    it('produces stable keys for a fixed seed', () => {
      // tail order is seeded (shuffled), so compare as a set
      expect([...shelfKeys(7)].sort()).toEqual([
        'genre:Adventure',
        'genre:Roguelike',
        'paused',
        'picked',
        'want',
      ]);
      // hero always leads
      expect(shelfKeys(7)[0]).toBe('picked');
    });
  });
});

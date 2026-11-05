import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { UnifiedGame } from '../types/game';
import { openDb, type Db } from '../db/connection';
import { upsertGames } from '../db/repos/games';
import { getSimilarGames, jaccard, SIMILAR_LIMIT } from './similarity';

const base = {
  primarySource: 'steam' as const,
  ownedSources: ['steam' as const],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const makeGame = (
  overrides: Partial<UnifiedGame> & { canonicalId: string; name: string },
): UnifiedGame => ({ ...base, genres: [], tags: [], ...overrides }) as UnifiedGame;

let db: Db;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-sim-'));
  db = openDb(path.join(dir, 'gamekeeper.db'));
});

afterEach(() => {
  db.close();
});

const insertTag = (database: DatabaseSync, canonicalId: string, tag: string): void => {
  database
    .prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING')
    .run(tag);
  database
    .prepare(
      `INSERT INTO game_tags (canonical_id, tag_id)
       SELECT ?, id FROM tags WHERE name = ?
       ON CONFLICT(canonical_id, tag_id) DO NOTHING`,
    )
    .run(canonicalId, tag);
};

const insertSimilar = (
  database: DatabaseSync,
  canonicalId: string,
  similar: string,
  rank: number | null,
): void => {
  database
    .prepare(
      `INSERT INTO similar_games (canonical_id, similar_canonical_id, rank, score)
       VALUES (?, ?, ?, NULL)
       ON CONFLICT(canonical_id, similar_canonical_id)
       DO UPDATE SET rank = excluded.rank`,
    )
    .run(canonicalId, similar, rank);
};

const setIgdbId = (database: DatabaseSync, canonicalId: string, igdbId: number): void => {
  database
    .prepare('UPDATE games SET igdb_id = ? WHERE canonical_id = ?')
    .run(igdbId, canonicalId);
};

const setStatus = (database: DatabaseSync, canonicalId: string, status: string): void => {
  database
    .prepare(
      `INSERT INTO game_status (canonical_id, status, position, updated_at)
       VALUES (?, ?, NULL, '2026-01-01T00:00:00.000Z')
       ON CONFLICT(canonical_id) DO UPDATE SET status = excluded.status`,
    )
    .run(canonicalId, status);
};

describe('jaccard', () => {
  it('scores identical sets 1, disjoint sets 0, partial overlap as a ratio', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
    expect(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c']))).toBeCloseTo(2 / 3);
  });

  it('scores two empty sets as 0 (no evidence of similarity)', () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

describe('getSimilarGames — IGDB curated', () => {
  it('returns curated rows first, ordered by rank, with metadata', () => {
    upsertGames(db.raw, [
      makeGame({ canonicalId: 'hades', name: 'Hades' }),
      makeGame({ canonicalId: 'celeste', name: 'Celeste', coverImageUrl: 'https://cdn/c.jpg' }),
      makeGame({ canonicalId: 'dead-cells', name: 'Dead Cells' }),
    ]);
    insertSimilar(db.raw, 'hades', 'celeste', 2);
    insertSimilar(db.raw, 'hades', 'dead-cells', 1);
    setStatus(db.raw, 'dead-cells', 'playing');

    const similar = getSimilarGames(db.raw, 'hades');

    expect(similar.map((game) => game.canonicalId)).toEqual(['dead-cells', 'celeste']);
    expect(similar[0]).toMatchObject({
      name: 'Dead Cells',
      origin: 'igdb',
      rank: 1,
      score: null,
      status: 'playing',
    });
    expect(similar[1].coverImageUrl).toBe('https://cdn/c.jpg');
    // no status row yet → counts as Backlog, same as the board
    expect(similar[1].status).toBe('backlog');
  });

  it('resolves igdb-prefixed rows through games.igdb_id and drops unresolved/self', () => {
    upsertGames(db.raw, [
      makeGame({ canonicalId: 'hades', name: 'Hades' }),
      makeGame({ canonicalId: 'celeste', name: 'Celeste' }),
      makeGame({ canonicalId: 'hollow', name: 'Hollow Knight' }),
    ]);
    setIgdbId(db.raw, 'hades', 42);
    setIgdbId(db.raw, 'celeste', 5501);
    insertSimilar(db.raw, 'hades', 'igdb:5501', 1); // target enriched later → resolves
    insertSimilar(db.raw, 'hades', 'igdb:9999', 2); // never enriched → dropped
    insertSimilar(db.raw, 'hades', 'igdb:42', 3); // self → dropped
    insertSimilar(db.raw, 'hades', 'hollow', 4); // canonical form, no igdb needed

    const similar = getSimilarGames(db.raw, 'hades');

    expect(similar.map((game) => game.canonicalId)).toEqual(['celeste', 'hollow']);
    expect(similar[0].origin).toBe('igdb');
    expect(similar[0].rank).toBe(1);
    expect(similar[1].rank).toBe(4);
  });
});

describe('getSimilarGames — computed overlap', () => {
  it('scores 0.4·jaccard(genres) + 0.6·jaccard(tags) and skips non-sharing games', () => {
    upsertGames(db.raw, [
      makeGame({
        canonicalId: 'target',
        name: 'Target',
        genres: ['Action', 'RPG'],
        tags: ['roguelike', 'turn-based'],
      }),
      makeGame({
        canonicalId: 'close',
        name: 'Close',
        genres: ['Action', 'RPG'],
        tags: ['roguelike'],
      }),
      makeGame({ canonicalId: 'loose', name: 'Loose', genres: ['Action'] }),
      makeGame({ canonicalId: 'stranger', name: 'Stranger', genres: ['Puzzle'] }),
    ]);
    insertTag(db.raw, 'target', 'roguelike');
    insertTag(db.raw, 'target', 'turn-based');
    insertTag(db.raw, 'close', 'roguelike');

    const similar = getSimilarGames(db.raw, 'target');

    expect(similar.map((game) => game.canonicalId)).toEqual(['close', 'loose']);
    // genres identical → 0.4; tags 1/2 → 0.6·0.5 = 0.3
    expect(similar[0].score).toBeCloseTo(0.7, 5);
    // genres 1/2 → 0.4·0.5; no tags on either side → that dimension contributes 0
    expect(similar[1].score).toBeCloseTo(0.2, 5);
    expect(similar.every((game) => game.origin === 'overlap')).toBe(true);
    expect(similar.every((game) => game.rank === null)).toBe(true);
  });

  it('excludes the target itself even though it shares everything', () => {
    upsertGames(db.raw, [
      makeGame({ canonicalId: 'lonely', name: 'Lonely', genres: ['Action'] }),
    ]);

    expect(getSimilarGames(db.raw, 'lonely')).toEqual([]);
  });

  it('returns [] for games with thin metadata and for unknown ids', () => {
    upsertGames(db.raw, [
      makeGame({ canonicalId: 'bare', name: 'Bare' }),
      makeGame({ canonicalId: 'other', name: 'Other', genres: ['Action'] }),
    ]);

    expect(getSimilarGames(db.raw, 'bare')).toEqual([]);
    expect(getSimilarGames(db.raw, 'missing')).toEqual([]);
  });
});

describe('getSimilarGames — merge + limits', () => {
  it('puts curated rows before overlap results and dedupes (curated wins)', () => {
    upsertGames(db.raw, [
      makeGame({
        canonicalId: 'target',
        name: 'Target',
        genres: ['Action', 'RPG', 'Roguelike'],
        tags: ['fast', 'pixel'],
      }),
      makeGame({
        canonicalId: 'star',
        name: 'Star',
        genres: ['Action', 'RPG', 'Roguelike'],
        tags: ['fast', 'pixel'],
      }),
      makeGame({ canonicalId: 'runner', name: 'Runner', genres: ['Action'] }),
    ]);
    insertTag(db.raw, 'target', 'fast');
    insertTag(db.raw, 'target', 'pixel');
    insertTag(db.raw, 'star', 'fast');
    insertTag(db.raw, 'star', 'pixel');
    // star is a perfect overlap AND curated at rank 2
    insertSimilar(db.raw, 'target', 'star', 2);

    const similar = getSimilarGames(db.raw, 'target');

    expect(similar.map((game) => game.canonicalId)).toEqual(['star', 'runner']);
    expect(similar[0].origin).toBe('igdb');
    expect(similar[1].origin).toBe('overlap');
  });

  it('caps results at SIMILAR_LIMIT by default and honors an explicit limit', () => {
    const games: UnifiedGame[] = [
      makeGame({ canonicalId: 'target', name: 'Target', genres: ['Shared'] }),
    ];
    for (let i = 0; i < SIMILAR_LIMIT + 2; i++) {
      games.push(
        makeGame({
          canonicalId: `filler-${i}`,
          name: `Filler ${String(i).padStart(2, '0')}`,
          genres: ['Shared'],
        }),
      );
    }
    upsertGames(db.raw, games);

    expect(getSimilarGames(db.raw, 'target')).toHaveLength(SIMILAR_LIMIT);
    expect(getSimilarGames(db.raw, 'target', 3)).toHaveLength(3);
  });
});

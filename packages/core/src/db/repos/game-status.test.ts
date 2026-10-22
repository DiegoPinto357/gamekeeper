import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UnifiedGame } from '../../types/game';
import { openDb, type Db } from '../connection';
import { upsertGames } from './games';
import {
  listStatuses,
  getLibraryGames,
  setGameStatus,
  materializeBacklog,
  UnknownStatusError,
  UnknownGameError,
} from './game-status';

const makeGame = (overrides: Partial<UnifiedGame> = {}): UnifiedGame => ({
  canonicalId: 'steam:1',
  name: 'Game',
  primarySource: 'steam',
  ownedSources: ['steam'],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const seedGames = (db: Db, games: UnifiedGame[]) => {
  upsertGames(db.raw, games);
};

const insertStatusRow = (
  db: Db,
  canonicalId: string,
  status: string,
  position: number,
) => {
  db.raw
    .prepare(
      `
      INSERT INTO game_status (canonical_id, status, position) VALUES (?, ?, ?)
      ON CONFLICT(canonical_id) DO UPDATE SET
        status = excluded.status,
        position = excluded.position
      `,
    )
    .run(canonicalId, status, position);
};

const getStatusRow = (
  db: Db,
  canonicalId: string,
): { status: string; position: number | null; updated_at: string } | undefined =>
  db.raw
    .prepare(
      'SELECT status, position, updated_at FROM game_status WHERE canonical_id = ?',
    )
    .get(canonicalId) as
    | { status: string; position: number | null; updated_at: string }
    | undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('game-status repo', () => {
  let db: Db;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-library-'));
    db = openDb(path.join(dir, 'lib.db'));
  });

  afterEach(() => {
    db.close();
  });

  describe('listStatuses', () => {
    it('returns the 9 seeded statuses ordered by position', () => {
      const statuses = listStatuses(db.raw);
      expect(statuses.map((s) => s.key)).toEqual([
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
      expect(statuses.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
      expect(statuses[0]).toMatchObject({ label: 'Backlog', color: '#64748b' });
    });
  });

  describe('getLibraryGames', () => {
    it('returns games with status null when no game_status row exists', () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:1', name: 'A' })]);

      const games = getLibraryGames(db.raw);
      expect(games).toHaveLength(1);
      expect(games[0]).toMatchObject({
        canonicalId: 'steam:1',
        name: 'A',
        status: null,
        position: null,
      });
    });

    it('joins status + position for games with a game_status row', () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:1', name: 'A' })]);
      insertStatusRow(db, 'steam:1', 'playing', 2.5);

      const [game] = getLibraryGames(db.raw);
      expect(game).toMatchObject({
        status: 'playing',
        position: 2.5,
        primarySource: 'steam',
        ownedSources: ['steam'],
      });
    });

    it('orders no-status games by COALESCE(last_played_at, created_at) DESC, name ASC', () => {
      seedGames(db, [
        makeGame({
          canonicalId: 'steam:a',
          name: 'A',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          lastPlayedAt: new Date('2026-03-01T00:00:00.000Z'),
        }),
        makeGame({
          canonicalId: 'steam:b',
          name: 'B',
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
        }),
        makeGame({
          canonicalId: 'steam:c',
          name: 'C',
          createdAt: new Date('2026-01-05T00:00:00.000Z'),
        }),
        makeGame({
          canonicalId: 'steam:d',
          name: 'D',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          lastPlayedAt: new Date('2026-04-01T00:00:00.000Z'),
        }),
      ]);

      const ordered = getLibraryGames(db.raw).map((g) => g.canonicalId);
      expect(ordered).toEqual(['steam:d', 'steam:a', 'steam:b', 'steam:c']);
    });

    it('breaks Q10.1 ties by name ASC', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:z', name: 'Zeta' }),
        makeGame({ canonicalId: 'steam:a', name: 'Alpha' }),
      ]);

      const ordered = getLibraryGames(db.raw).map((g) => g.canonicalId);
      expect(ordered).toEqual(['steam:a', 'steam:z']);
    });
  });

  describe('setGameStatus — position math', () => {
    it('places the game at position 1 in an empty column', () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:1' })]);

      const result = setGameStatus(db.raw, 'steam:1', 'playing', {});
      expect(result).toEqual({
        canonicalId: 'steam:1',
        status: 'playing',
        position: 1,
      });
      expect(getStatusRow(db, 'steam:1')).toMatchObject({
        status: 'playing',
        position: 1,
      });
    });

    it('computes the midpoint between two neighbors', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:1' }),
        makeGame({ canonicalId: 'steam:2' }),
        makeGame({ canonicalId: 'steam:3' }),
      ]);
      insertStatusRow(db, 'steam:1', 'playing', 1);
      insertStatusRow(db, 'steam:2', 'playing', 2);

      const result = setGameStatus(db.raw, 'steam:3', 'playing', {
        beforeId: 'steam:1',
        afterId: 'steam:2',
      });
      expect(result.position).toBe(1.5);
    });

    it('appends at the end (before + 1) when afterId is missing', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:1' }),
        makeGame({ canonicalId: 'steam:2' }),
      ]);
      insertStatusRow(db, 'steam:1', 'playing', 1);
      insertStatusRow(db, 'steam:2', 'playing', 1.5);

      const result = setGameStatus(db.raw, 'steam:2', 'playing', {
        beforeId: 'steam:1',
      });
      expect(result.position).toBe(2);
    });

    it('prepends at the start (after − 1) when beforeId is missing', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:1' }),
        makeGame({ canonicalId: 'steam:2' }),
      ]);
      insertStatusRow(db, 'steam:1', 'playing', 5);

      const result = setGameStatus(db.raw, 'steam:2', 'playing', {
        afterId: 'steam:1',
      });
      expect(result.position).toBe(4);
    });

    it('appends at max + 1 when no neighbors given in a non-empty column', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:1' }),
        makeGame({ canonicalId: 'steam:2' }),
      ]);
      insertStatusRow(db, 'steam:1', 'playing', 3);

      const result = setGameStatus(db.raw, 'steam:2', 'playing', {});
      expect(result.position).toBe(4);
    });

    it('re-PATCH same status recomputes position from neighbors', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:1' }),
        makeGame({ canonicalId: 'steam:2' }),
        makeGame({ canonicalId: 'steam:3' }),
      ]);
      setGameStatus(db.raw, 'steam:3', 'playing', {});
      expect(getStatusRow(db, 'steam:3')?.position).toBe(1);

      insertStatusRow(db, 'steam:1', 'playing', 5);
      insertStatusRow(db, 'steam:2', 'playing', 10);
      const result = setGameStatus(db.raw, 'steam:3', 'playing', {
        beforeId: 'steam:1',
        afterId: 'steam:2',
      });
      expect(result.position).toBe(7.5);
    });

    it('ignores the moving game itself as a neighbor', () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:1' })]);
      insertStatusRow(db, 'steam:1', 'playing', 4);

      const result = setGameStatus(db.raw, 'steam:1', 'playing', {
        beforeId: 'steam:1',
        afterId: 'steam:1',
      });
      // degenerate neighbors collapse to a no-op placement, not a crash
      expect(result).toMatchObject({ status: 'playing' });
      expect(getStatusRow(db, 'steam:1')).toMatchObject({ status: 'playing' });
    });
  });

  describe('setGameStatus — precision decay reindex', () => {
    it('reindexes the column when neighbor spacing is below 1e-9 and recomputes', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:1' }),
        makeGame({ canonicalId: 'steam:2' }),
        makeGame({ canonicalId: 'steam:3' }),
      ]);
      insertStatusRow(db, 'steam:1', 'playing', 1);
      insertStatusRow(db, 'steam:2', 'playing', 1 + 5e-10);

      const result = setGameStatus(db.raw, 'steam:3', 'playing', {
        beforeId: 'steam:1',
        afterId: 'steam:2',
      });

      const rows = db.raw
        .prepare(
          'SELECT canonical_id, position FROM game_status WHERE status = ? ORDER BY position',
        )
        .all('playing') as { canonical_id: string; position: number }[];
      // column renumbered to 1..n, moved game lands at the recomputed midpoint
      expect(rows.map((r) => r.position)).toEqual([1, 1.5, 2]);
      const ids = rows.map((r) => r.canonical_id);
      const movedIdx = ids.indexOf('steam:3');
      expect(movedIdx).toBe(1);
      expect(result.position).toBe(1.5);
    });

    it('reindexes when float exhaustion makes the midpoint collapse onto a neighbor', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:1' }),
        makeGame({ canonicalId: 'steam:2' }),
        makeGame({ canonicalId: 'steam:3' }),
      ]);
      // spacing is above 1e-9 but (prev + next) / 2 rounds onto prev
      const prev = 2 ** 52;
      const next = 2 ** 52 + 1;
      insertStatusRow(db, 'steam:1', 'playing', prev);
      insertStatusRow(db, 'steam:2', 'playing', next);
      expect((prev + next) / 2).toBe(prev);

      const result = setGameStatus(db.raw, 'steam:3', 'playing', {
        beforeId: 'steam:1',
        afterId: 'steam:2',
      });
      expect(result.position).toBe(1.5);
    });

    it('never reindexes other columns', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:1' }),
        makeGame({ canonicalId: 'steam:2' }),
        makeGame({ canonicalId: 'steam:3' }),
        makeGame({ canonicalId: 'steam:4' }),
      ]);
      insertStatusRow(db, 'steam:1', 'playing', 1);
      insertStatusRow(db, 'steam:2', 'playing', 1 + 5e-10);
      insertStatusRow(db, 'steam:4', 'paused', 7.25);

      setGameStatus(db.raw, 'steam:3', 'playing', {
        beforeId: 'steam:1',
        afterId: 'steam:2',
      });

      expect(getStatusRow(db, 'steam:4')).toMatchObject({
        status: 'paused',
        position: 7.25,
      });
    });
  });

  describe('materializeBacklog', () => {
    it('assigns positions 1..n to all no-status games in Q10.1 order', () => {
      seedGames(db, [
        makeGame({
          canonicalId: 'steam:a',
          name: 'A',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          lastPlayedAt: new Date('2026-03-01T00:00:00.000Z'),
        }),
        makeGame({
          canonicalId: 'steam:b',
          name: 'B',
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
        }),
        makeGame({
          canonicalId: 'steam:c',
          name: 'C',
          createdAt: new Date('2026-01-05T00:00:00.000Z'),
        }),
      ]);

      const count = materializeBacklog(db.raw);
      expect(count).toBe(3);

      const rows = db.raw
        .prepare(
          'SELECT canonical_id, status, position FROM game_status ORDER BY position',
        )
        .all() as { canonical_id: string; status: string; position: number }[];
      expect(rows.map((r) => r.canonical_id)).toEqual([
        'steam:a',
        'steam:b',
        'steam:c',
      ]);
      expect(rows.every((r) => r.status === 'backlog')).toBe(true);
      expect(rows.map((r) => r.position)).toEqual([1, 2, 3]);
    });

    it('is idempotent — second call is a no-op', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:a', name: 'A' }),
        makeGame({ canonicalId: 'steam:b', name: 'B' }),
      ]);

      expect(materializeBacklog(db.raw)).toBe(2);
      const before = db.raw
        .prepare('SELECT canonical_id, position FROM game_status ORDER BY position')
        .all();

      expect(materializeBacklog(db.raw)).toBe(0);
      const after = db.raw
        .prepare('SELECT canonical_id, position FROM game_status ORDER BY position')
        .all();
      expect(after).toEqual(before);
    });

    it('appends newly synced no-status games after existing backlog positions', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:a', name: 'A' }),
        makeGame({ canonicalId: 'steam:b', name: 'B' }),
      ]);
      materializeBacklog(db.raw);

      seedGames(db, [makeGame({ canonicalId: 'steam:new', name: 'New' })]);
      const count = materializeBacklog(db.raw);
      expect(count).toBe(1);
      expect(getStatusRow(db, 'steam:new')).toMatchObject({
        status: 'backlog',
        position: 3,
      });
    });

    it('does not touch games that already have other statuses', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:a', name: 'A' }),
        makeGame({ canonicalId: 'steam:b', name: 'B' }),
      ]);
      insertStatusRow(db, 'steam:a', 'playing', 1);

      materializeBacklog(db.raw);
      expect(getStatusRow(db, 'steam:a')).toMatchObject({
        status: 'playing',
        position: 1,
      });
    });
  });

  describe('setGameStatus — Backlog involvement', () => {
    it('materializes backlog before positioning a game dropped into Backlog', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:mover' }),
        makeGame({ canonicalId: 'steam:b1', name: 'B1' }),
        makeGame({ canonicalId: 'steam:b2', name: 'B2' }),
      ]);
      insertStatusRow(db, 'steam:mover', 'playing', 1);

      const result = setGameStatus(db.raw, 'steam:mover', 'backlog', {
        beforeId: 'steam:b1',
        afterId: 'steam:b2',
      });

      expect(getStatusRow(db, 'steam:b1')).toMatchObject({ status: 'backlog' });
      expect(getStatusRow(db, 'steam:b2')).toMatchObject({ status: 'backlog' });
      expect(result).toMatchObject({ status: 'backlog', position: 1.5 });
    });

    it('materializes backlog when a no-status (default backlog) game moves out', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:mover', name: 'Mover' }),
        makeGame({ canonicalId: 'steam:other', name: 'Other' }),
      ]);

      const result = setGameStatus(db.raw, 'steam:mover', 'want_to_play', {});

      expect(result).toMatchObject({ status: 'want_to_play', position: 1 });
      // remaining backlog game got materialized (Mover sorts before Other → pos 2)
      expect(getStatusRow(db, 'steam:other')).toMatchObject({
        status: 'backlog',
        position: 2,
      });
    });

    it('getLibraryGames renders no-status games as backlog until materialized', () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:1', name: 'A' })]);

      const games = getLibraryGames(db.raw);
      expect(games[0].status).toBeNull();
      expect(db.raw.prepare('SELECT COUNT(*) AS c FROM game_status').get()).toEqual({
        c: 0,
      });
    });
  });

  describe('validation', () => {
    it('throws UnknownStatusError for an unknown status key', () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:1' })]);

      expect(() => setGameStatus(db.raw, 'steam:1', 'nope', {})).toThrow(
        UnknownStatusError,
      );
      expect(getStatusRow(db, 'steam:1')).toBeUndefined();
    });

    it('throws UnknownGameError for an unknown game', () => {
      expect(() => setGameStatus(db.raw, 'steam:0', 'playing', {})).toThrow(
        UnknownGameError,
      );
    });
  });

  describe('updated_at (trigger-owned)', () => {
    it('sets updated_at on insert via column default and bumps it on update', async () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:1' })]);

      setGameStatus(db.raw, 'steam:1', 'playing', {});
      const first = getStatusRow(db, 'steam:1');
      expect(first?.updated_at).toBeTruthy();

      await sleep(5);
      setGameStatus(db.raw, 'steam:1', 'paused', {});
      const second = getStatusRow(db, 'steam:1');
      expect(second?.updated_at).toBeTruthy();
      expect(second!.updated_at > first!.updated_at).toBe(true);
    });
  });
});

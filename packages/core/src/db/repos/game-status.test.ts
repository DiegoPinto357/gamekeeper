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
  unpinGame,
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
  position: number | null,
  pinned = 1,
) => {
  db.raw
    .prepare(
      `
      INSERT INTO game_status (canonical_id, status, position, pinned)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(canonical_id) DO UPDATE SET
        status = excluded.status,
        position = excluded.position,
        pinned = excluded.pinned
      `,
    )
    .run(canonicalId, status, position, pinned);
};

const getStatusRow = (
  db: Db,
  canonicalId: string,
): {
  status: string;
  position: number | null;
  pinned: number;
  notes: string | null;
  updated_at: string;
} | undefined =>
  db.raw
    .prepare(
      'SELECT status, position, pinned, notes, updated_at FROM game_status WHERE canonical_id = ?',
    )
    .get(canonicalId) as
  | {
      status: string;
      position: number | null;
      pinned: number;
      notes: string | null;
      updated_at: string;
    }
  | undefined;

const boardOrder = (db: Db, status: string): string[] =>
  getLibraryGames(db.raw)
    .filter((g) => (g.status ?? 'backlog') === status)
    .map((g) => g.canonicalId);

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
        pinned: false,
      });
    });

    it('joins status + position + pinned for games with a game_status row', () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:1', name: 'A' })]);
      insertStatusRow(db, 'steam:1', 'playing', 2);

      const [game] = getLibraryGames(db.raw);
      expect(game).toMatchObject({
        status: 'playing',
        position: 2,
        pinned: true,
        primarySource: 'steam',
        ownedSources: ['steam'],
      });
    });

    it('orders no-status (auto) games by COALESCE(last_played_at, created_at) DESC, name ASC', () => {
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

      expect(boardOrder(db, 'backlog')).toEqual([
        'steam:d',
        'steam:a',
        'steam:b',
        'steam:c',
      ]);
    });

    it('breaks Q10.1 ties by name ASC', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:z', name: 'Zeta' }),
        makeGame({ canonicalId: 'steam:a', name: 'Alpha' }),
      ]);

      expect(boardOrder(db, 'backlog')).toEqual(['steam:a', 'steam:z']);
    });

    it('maps proton_json into the proton DTO (tier + steamDeck)', () => {
      seedGames(db, [
        makeGame({
          canonicalId: 'steam:1',
          name: 'A',
          proton: { tier: 'gold', steamDeck: 'verified' },
        }),
      ]);

      const [game] = getLibraryGames(db.raw);
      expect(game.proton).toEqual({ tier: 'gold', steamDeck: 'verified' });
    });

    it('proton is null when missing or malformed', () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:1', name: 'A' })]);
      expect(getLibraryGames(db.raw)[0].proton).toBeNull();

      db.raw
        .prepare("UPDATE games SET proton_json = 'not-json' WHERE canonical_id = 'steam:1'")
        .run();
      expect(getLibraryGames(db.raw)[0].proton).toBeNull();

      db.raw
        .prepare("UPDATE games SET proton_json = '{\"tier\":\"nope\"}' WHERE canonical_id = 'steam:1'")
        .run();
      expect(getLibraryGames(db.raw)[0].proton).toBeNull();
    });

    it('parses real-world proton_json with ISO-string lastUpdated (regression)', () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:1', name: 'A' })]);
      db.raw
        .prepare(
          "UPDATE games SET proton_json = ? WHERE canonical_id = 'steam:1'",
        )
        .run(
          JSON.stringify({
            tier: 'platinum',
            steamDeck: 'verified',
            trendingTier: 'platinum',
            lastUpdated: '2026-10-02T03:06:02.444Z',
          }),
        );

      expect(getLibraryGames(db.raw)[0].proton).toEqual({
        tier: 'platinum',
        steamDeck: 'verified',
      });
    });
  });

  describe('merge order (pinned anchored + auto flows around)', () => {
    it('anchors a pinned card at its slot while auto cards flow around it', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:d', name: 'D' }),
        makeGame({ canonicalId: 'steam:a', name: 'A' }),
        makeGame({ canonicalId: 'steam:b', name: 'B' }),
        makeGame({ canonicalId: 'steam:c', name: 'C' }),
        makeGame({ canonicalId: 'steam:p', name: 'P' }),
      ]);
      // auto order by name asc (no last_played): A B C D P; pin P at slot 3
      insertStatusRow(db, 'steam:p', 'backlog', 3, 1);

      expect(boardOrder(db, 'backlog')).toEqual([
        'steam:a',
        'steam:b',
        'steam:p',
        'steam:c',
        'steam:d',
      ]);
    });

    it('keeps pinned anchors while auto cards reflow after a last_played change', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:a', name: 'A' }),
        makeGame({ canonicalId: 'steam:b', name: 'B' }),
        makeGame({ canonicalId: 'steam:c', name: 'C' }),
        makeGame({ canonicalId: 'steam:p', name: 'P' }),
      ]);
      insertStatusRow(db, 'steam:p', 'backlog', 2, 1);
      expect(boardOrder(db, 'backlog')).toEqual([
        'steam:a',
        'steam:p',
        'steam:b',
        'steam:c',
      ]);

      // B becomes the most recently played → auto reflows B to the top of
      // the auto block; the pin stays anchored at slot 2
      seedGames(db, [
        makeGame({
          canonicalId: 'steam:b',
          name: 'B',
          lastPlayedAt: new Date('2026-06-01T00:00:00.000Z'),
        }),
      ]);
      expect(boardOrder(db, 'backlog')).toEqual([
        'steam:b',
        'steam:p',
        'steam:a',
        'steam:c',
      ]);
    });

    it('slots a newly synced game into the auto flow without touching pins', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:a', name: 'A' }),
        makeGame({ canonicalId: 'steam:p', name: 'P' }),
      ]);
      insertStatusRow(db, 'steam:p', 'backlog', 1, 1);
      expect(boardOrder(db, 'backlog')).toEqual(['steam:p', 'steam:a']);

      seedGames(db, [
        makeGame({
          canonicalId: 'steam:new',
          name: 'New',
          lastPlayedAt: new Date('2026-06-01T00:00:00.000Z'),
        }),
      ]);
      expect(boardOrder(db, 'backlog')).toEqual([
        'steam:p',
        'steam:new',
        'steam:a',
      ]);
    });

    it('legacy rows default to pinned=1 and anchor at their positions', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:a', name: 'A' }),
        makeGame({ canonicalId: 'steam:b', name: 'B' }),
        makeGame({ canonicalId: 'steam:old', name: 'Old' }),
      ]);
      // inserted without pinned → column DEFAULT 1
      db.raw
        .prepare(
          "INSERT INTO game_status (canonical_id, status, position) VALUES ('steam:old', 'backlog', 1)",
        )
        .run();

      expect(boardOrder(db, 'backlog')).toEqual(['steam:old', 'steam:a', 'steam:b']);
      expect(getStatusRow(db, 'steam:old')?.pinned).toBe(1);
    });
  });

  describe('setGameStatus — pin model', () => {
    it('cross-column move joins the auto flow (unpinned, no position)', () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:1', name: 'A' })]);

      const result = setGameStatus(db.raw, 'steam:1', 'playing', {});
      expect(result).toEqual({
        canonicalId: 'steam:1',
        status: 'playing',
        position: null,
      });
      expect(getStatusRow(db, 'steam:1')).toMatchObject({
        status: 'playing',
        position: null,
        pinned: 0,
      });
    });

    it('cross-column move ignores neighbors and sorts into the auto flow by last played', () => {
      seedGames(db, [
        makeGame({
          canonicalId: 'steam:a',
          name: 'A',
          lastPlayedAt: new Date('2026-03-01T00:00:00.000Z'),
        }),
        makeGame({
          canonicalId: 'steam:b',
          name: 'B',
          lastPlayedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        makeGame({ canonicalId: 'steam:p', name: 'P' }),
      ]);
      insertStatusRow(db, 'steam:p', 'playing', 1, 1);

      setGameStatus(db.raw, 'steam:a', 'playing', {});
      setGameStatus(db.raw, 'steam:b', 'playing', {
        beforeId: 'steam:p',
        afterId: 'steam:a',
      });

      // auto order by last played: A (Mar) then B (Jan); the pin anchors at 1
      expect(boardOrder(db, 'playing')).toEqual(['steam:p', 'steam:a', 'steam:b']);
      expect(getStatusRow(db, 'steam:a')).toMatchObject({ pinned: 0, position: null });
      expect(getStatusRow(db, 'steam:b')).toMatchObject({ pinned: 0, position: null });
    });

    it('a same-column move pins the game at the drop slot', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:1', name: 'One' }),
        makeGame({ canonicalId: 'steam:2', name: 'Two' }),
        makeGame({ canonicalId: 'steam:3', name: 'Three' }),
      ]);
      setGameStatus(db.raw, 'steam:1', 'playing', {});
      setGameStatus(db.raw, 'steam:2', 'playing', {});
      setGameStatus(db.raw, 'steam:3', 'playing', {});
      // auto by name: One, Three, Two — all unpinned
      expect(boardOrder(db, 'playing')).toEqual(['steam:1', 'steam:3', 'steam:2']);

      const result = setGameStatus(db.raw, 'steam:3', 'playing', {
        beforeId: 'steam:1',
      });
      expect(result).toEqual({
        canonicalId: 'steam:3',
        status: 'playing',
        position: 2,
      });
      expect(getStatusRow(db, 'steam:3')).toMatchObject({ pinned: 1, position: 2 });
      expect(boardOrder(db, 'playing')).toEqual(['steam:1', 'steam:3', 'steam:2']);
    });

    it('inserting between two pinned cards lands at the slot and shifts the tail down', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:1', name: 'One' }),
        makeGame({ canonicalId: 'steam:2', name: 'Two' }),
        makeGame({ canonicalId: 'steam:3', name: 'Three' }),
      ]);
      setGameStatus(db.raw, 'steam:1', 'playing', {});
      setGameStatus(db.raw, 'steam:2', 'playing', {});
      // pin both so the drop computes from pinned ranks
      setGameStatus(db.raw, 'steam:1', 'playing', {});
      setGameStatus(db.raw, 'steam:2', 'playing', {});
      setGameStatus(db.raw, 'steam:3', 'playing', {}); // cross → auto

      const result = setGameStatus(db.raw, 'steam:3', 'playing', {
        beforeId: 'steam:1',
        afterId: 'steam:2',
      });

      expect(result.position).toBe(2);
      expect(boardOrder(db, 'playing')).toEqual(['steam:1', 'steam:3', 'steam:2']);
    });

    it('prepends at the top of the pinned group when only afterId given', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:1', name: 'One' }),
        makeGame({ canonicalId: 'steam:2', name: 'Two' }),
      ]);
      setGameStatus(db.raw, 'steam:1', 'playing', {});
      setGameStatus(db.raw, 'steam:1', 'playing', {}); // pin One
      setGameStatus(db.raw, 'steam:2', 'playing', {}); // cross → auto

      const result = setGameStatus(db.raw, 'steam:2', 'playing', {
        afterId: 'steam:1',
      });
      expect(result.position).toBe(1);
      expect(getStatusRow(db, 'steam:2')).toMatchObject({ pinned: 1, position: 1 });
      expect(boardOrder(db, 'playing')).toEqual(['steam:2', 'steam:1']);
    });

    it('a drop on default Backlog (no-row game) pins within Backlog', () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:1', name: 'A' })]);

      const result = setGameStatus(db.raw, 'steam:1', 'backlog', {});
      expect(result).toMatchObject({ status: 'backlog', position: 1 });
      expect(getStatusRow(db, 'steam:1')).toMatchObject({ pinned: 1, position: 1 });
    });

    it('moving a pinned card to another column unpins it', () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:1', name: 'A' })]);
      setGameStatus(db.raw, 'steam:1', 'playing', {});
      setGameStatus(db.raw, 'steam:1', 'playing', {}); // pin
      expect(getStatusRow(db, 'steam:1')).toMatchObject({ pinned: 1 });

      setGameStatus(db.raw, 'steam:1', 'paused', {});
      expect(getStatusRow(db, 'steam:1')).toMatchObject({
        status: 'paused',
        pinned: 0,
        position: null,
      });
    });

    it('ignores neighbors from another column (falls back to auto)', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:1', name: 'One' }),
        makeGame({ canonicalId: 'steam:2', name: 'Two' }),
        makeGame({ canonicalId: 'steam:other', name: 'Other' }),
      ]);
      setGameStatus(db.raw, 'steam:1', 'playing', {});
      setGameStatus(db.raw, 'steam:other', 'paused', {});

      const result = setGameStatus(db.raw, 'steam:2', 'playing', {
        beforeId: 'steam:other',
      });
      expect(result).toMatchObject({ position: null });
      expect(boardOrder(db, 'playing')).toEqual(['steam:1', 'steam:2']);
    });

    it('never reindexes other columns', () => {
      seedGames(db, [
        makeGame({ canonicalId: 'steam:1', name: 'One' }),
        makeGame({ canonicalId: 'steam:2', name: 'Two' }),
        makeGame({ canonicalId: 'steam:3', name: 'Three' }),
        makeGame({ canonicalId: 'steam:4', name: 'Four' }),
      ]);
      setGameStatus(db.raw, 'steam:1', 'playing', {});
      setGameStatus(db.raw, 'steam:2', 'playing', {});
      setGameStatus(db.raw, 'steam:1', 'playing', {}); // pin One
      setGameStatus(db.raw, 'steam:2', 'playing', {}); // pin Two
      setGameStatus(db.raw, 'steam:4', 'paused', {});

      setGameStatus(db.raw, 'steam:3', 'playing', {
        beforeId: 'steam:1',
        afterId: 'steam:2',
      });

      expect(getStatusRow(db, 'steam:4')).toMatchObject({
        status: 'paused',
        pinned: 0,
        position: null,
      });
    });

    it('renders no-status games as backlog without creating rows on move-out', () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:mover', name: 'Mover' })]);

      const result = setGameStatus(db.raw, 'steam:mover', 'want_to_play', {});
      expect(result).toMatchObject({ status: 'want_to_play', position: null });
      expect(db.raw.prepare('SELECT COUNT(*) AS c FROM game_status').get()).toEqual({
        c: 1,
      });
      expect(getStatusRow(db, 'steam:mover')).toMatchObject({ pinned: 0 });
    });
  });

  describe('unpinGame', () => {
    it('deletes a backlog row so the game returns to the lazy auto flow', () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:1' })]);
      setGameStatus(db.raw, 'steam:1', 'backlog', {});

      const result = unpinGame(db.raw, 'steam:1');
      expect(result).toEqual({
        canonicalId: 'steam:1',
        status: 'backlog',
        pinned: false,
      });
      expect(getStatusRow(db, 'steam:1')).toBeUndefined();
    });

    it('keeps a backlog row that has notes (clears the pin instead)', () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:1' })]);
      setGameStatus(db.raw, 'steam:1', 'backlog', {});
      db.raw
        .prepare("UPDATE game_status SET notes = 'keep me' WHERE canonical_id = 'steam:1'")
        .run();

      unpinGame(db.raw, 'steam:1');
      expect(getStatusRow(db, 'steam:1')).toMatchObject({
        status: 'backlog',
        pinned: 0,
        position: null,
        notes: 'keep me',
      });
    });

    it('clears the pin for non-backlog statuses, keeping the status', () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:1' })]);
      setGameStatus(db.raw, 'steam:1', 'playing', {});
      setGameStatus(db.raw, 'steam:1', 'playing', {}); // same-column → pin
      expect(getStatusRow(db, 'steam:1')).toMatchObject({ pinned: 1 });

      const result = unpinGame(db.raw, 'steam:1');
      expect(result).toEqual({
        canonicalId: 'steam:1',
        status: 'playing',
        pinned: false,
      });
      expect(getStatusRow(db, 'steam:1')).toMatchObject({
        status: 'playing',
        pinned: 0,
        position: null,
      });
    });

    it('is a no-op for a game without a status row (already auto)', () => {
      seedGames(db, [makeGame({ canonicalId: 'steam:1' })]);

      const result = unpinGame(db.raw, 'steam:1');
      expect(result).toEqual({
        canonicalId: 'steam:1',
        status: 'backlog',
        pinned: false,
      });
      expect(db.raw.prepare('SELECT COUNT(*) AS c FROM game_status').get()).toEqual({
        c: 0,
      });
    });

    it('throws UnknownGameError for an unknown game', () => {
      expect(() => unpinGame(db.raw, 'steam:0')).toThrow(UnknownGameError);
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

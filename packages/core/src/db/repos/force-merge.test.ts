import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UnifiedGame } from '../../types/game';
import type { ForceMergeRule } from '../../types/overrides';
import { openDb, type Db } from '../connection';
import { upsertGames, getGame } from './games';
import { applyForceMerge } from './force-merge';

const makeGame = (overrides: Partial<UnifiedGame> = {}): UnifiedGame => ({
  canonicalId: 'steam:1',
  name: 'Game',
  primarySource: 'steam',
  ownedSources: ['steam'],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const WINNER_ID = 'steam:100';
const LOSER_ID = 'rustler-grand-theft-horse';
const rule: ForceMergeRule = {
  games: ['Rustler', 'Rustler - Grand Theft Horse'],
  canonicalName: 'Rustler',
};

const seedPair = (db: Db) => {
  upsertGames(db.raw, [
    makeGame({
      canonicalId: WINNER_ID,
      name: 'Rustler',
      ownedSources: ['steam'],
      steamAppId: 100,
      playtimeHours: 1,
      lastPlayedAt: new Date('2026-01-05T00:00:00.000Z'),
      coverImageUrl: 'winner.jpg',
      description: 'Winner description',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-06T00:00:00.000Z'),
      genres: ['Action'],
    }),
    makeGame({
      canonicalId: LOSER_ID,
      name: 'Rustler - Grand Theft Horse',
      primarySource: 'xbox',
      ownedSources: ['xbox'],
      playtimeHours: 3,
      lastPlayedAt: new Date('2026-02-05T00:00:00.000Z'),
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
      updatedAt: new Date('2026-02-06T00:00:00.000Z'),
      genres: ['Adventure', 'Action'],
    }),
  ]);
};

const insertStatusRow = (
  db: Db,
  canonicalId: string,
  status: string,
  opts: { position?: number | null; pinned?: number; notes?: string | null } = {},
) => {
  const { position = null, pinned = 0, notes = null } = opts;
  db.raw
    .prepare(
      `INSERT INTO game_status (canonical_id, status, position, pinned, notes)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(canonical_id) DO UPDATE SET
         status = excluded.status, position = excluded.position,
         pinned = excluded.pinned, notes = excluded.notes`,
    )
    .run(canonicalId, status, position, pinned, notes);
};

const getStatusRow = (
  db: Db,
  canonicalId: string,
): { status: string; position: number | null; pinned: number; notes: string | null } | undefined =>
  db.raw
    .prepare(
      'SELECT status, position, pinned, notes FROM game_status WHERE canonical_id = ?',
    )
    .get(canonicalId) as never;

describe('applyForceMerge', () => {
  let db: Db;
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-fm-'));
    db = openDb(path.join(dir, 'test.db'));
    seedPair(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('merges loser fields into the canonical winner and deletes the loser', () => {
    const report = applyForceMerge(db.raw, [rule]);

    expect(report.merged).toBe(1);
    expect(report.rules[0]).toMatchObject({
      canonicalName: 'Rustler',
      winnerId: WINNER_ID,
      mergedIds: [LOSER_ID],
      statusAction: 'none',
    });

    const winner = getGame(db.raw, WINNER_ID)!;
    expect(winner.ownedSources).toEqual(['steam', 'xbox']);
    expect(winner.playtimeHours).toBe(4);
    expect(winner.lastPlayedAt?.toISOString()).toBe('2026-02-05T00:00:00.000Z');
    expect(winner.coverImageUrl).toBe('winner.jpg');
    expect(winner.description).toBe('Winner description');
    expect(winner.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(winner.updatedAt.toISOString()).toBe('2026-02-06T00:00:00.000Z');
    expect(getGame(db.raw, LOSER_ID)).toBeUndefined();
  });

  it('lets the loser fill gaps the winner left empty', () => {
    db.raw
      .prepare(
        `UPDATE games SET cover_image_url = NULL, description = NULL,
         steam_app_id = NULL WHERE canonical_id = ?`,
      )
      .run(WINNER_ID);
    db.raw
      .prepare(
        `UPDATE games SET cover_image_url = 'loser.jpg',
         description = 'Loser description', steam_app_id = 100,
         proton_json = '{"tier":"verified","steamDeck":"verified"}'
         WHERE canonical_id = ?`,
      )
      .run(LOSER_ID);

    applyForceMerge(db.raw, [rule]);

    const winner = getGame(db.raw, WINNER_ID)!;
    expect(winner.coverImageUrl).toBe('loser.jpg');
    expect(winner.description).toBe('Loser description');
    expect(winner.steamAppId).toBe(100);
    expect(winner.proton?.tier).toBe('verified');
  });

  it('copies loser genre and tag links to the winner and drops loser rows', () => {
    const linkTag = db.raw.prepare(
      `INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING`,
    );
    const linkTagToGame = db.raw.prepare(
      `INSERT INTO game_tags (canonical_id, tag_id)
       SELECT ?, id FROM tags WHERE name = ?
       ON CONFLICT(canonical_id, tag_id) DO NOTHING`,
    );
    linkTag.run('open-world');
    linkTagToGame.run(LOSER_ID, 'open-world');
    linkTagToGame.run(WINNER_ID, 'open-world');
    linkTag.run('horse');
    linkTagToGame.run(LOSER_ID, 'horse');

    applyForceMerge(db.raw, [rule]);

    const genres = db.raw
      .prepare(
        `SELECT gn.name FROM game_genres gg JOIN genres gn ON gn.id = gg.genre_id
         WHERE gg.canonical_id = ? ORDER BY gn.name`,
      )
      .all(WINNER_ID) as { name: string }[];
    expect(genres.map((g) => g.name)).toEqual(['Action', 'Adventure']);

    const tags = db.raw
      .prepare(
        `SELECT t.name FROM game_tags gt JOIN tags t ON t.id = gt.tag_id
         WHERE gt.canonical_id = ? ORDER BY t.name`,
      )
      .all(WINNER_ID) as { name: string }[];
    expect(tags.map((t) => t.name)).toEqual(['horse', 'open-world']);

    const loserGenreLinks = db.raw
      .prepare('SELECT COUNT(*) AS n FROM game_genres WHERE canonical_id = ?')
      .get(LOSER_ID) as { n: number };
    const loserTagLinks = db.raw
      .prepare('SELECT COUNT(*) AS n FROM game_tags WHERE canonical_id = ?')
      .get(LOSER_ID) as { n: number };
    expect(loserGenreLinks.n).toBe(0);
    expect(loserTagLinks.n).toBe(0);
  });

  it('copies the loser status row to the winner when the winner has none', () => {
    insertStatusRow(db, LOSER_ID, 'queued_to_play', { notes: 'next up' });

    const report = applyForceMerge(db.raw, [rule]);

    expect(report.rules[0].statusAction).toBe('copied-loser');
    expect(getStatusRow(db, WINNER_ID)).toEqual({
      status: 'queued_to_play',
      position: null,
      pinned: 0,
      notes: 'next up',
    });
    expect(getStatusRow(db, LOSER_ID)).toBeUndefined();
  });

  it('keeps the winner status by default when both rows conflict', () => {
    insertStatusRow(db, WINNER_ID, 'backlog', { position: 2, notes: 'mine' });
    insertStatusRow(db, LOSER_ID, 'queued_to_play', { notes: 'theirs' });

    const report = applyForceMerge(db.raw, [rule]);

    expect(report.rules[0].statusAction).toBe('kept-winner');
    expect(getStatusRow(db, WINNER_ID)).toEqual({
      status: 'backlog',
      position: 2,
      pinned: 0,
      notes: 'mine',
    });
    expect(getStatusRow(db, LOSER_ID)).toBeUndefined();
  });

  it('overwrites the winner status with the loser status when asked', () => {
    insertStatusRow(db, WINNER_ID, 'backlog', { position: 2, pinned: 1, notes: 'mine' });
    insertStatusRow(db, LOSER_ID, 'queued_to_play', {
      position: 9,
      pinned: 0,
      notes: 'theirs',
    });

    const report = applyForceMerge(db.raw, [rule], { statusConflict: 'loser' });

    expect(report.rules[0].statusAction).toBe('overwrote-winner');
    expect(getStatusRow(db, WINNER_ID)).toEqual({
      status: 'queued_to_play',
      position: 9,
      pinned: 0,
      notes: 'theirs',
    });
    expect(getStatusRow(db, LOSER_ID)).toBeUndefined();
  });

  it('keeps the winner row when both sides already share the same status', () => {
    insertStatusRow(db, WINNER_ID, 'backlog', { position: 2, notes: 'mine' });
    insertStatusRow(db, LOSER_ID, 'backlog', { position: 9, notes: 'theirs' });

    const report = applyForceMerge(db.raw, [rule]);

    expect(report.rules[0].statusAction).toBe('kept-winner');
    expect(getStatusRow(db, WINNER_ID)).toEqual({
      status: 'backlog',
      position: 2,
      pinned: 0,
      notes: 'mine',
    });
    expect(getStatusRow(db, LOSER_ID)).toBeUndefined();
  });

  it('reports the merge without touching the database in dry-run mode', () => {
    insertStatusRow(db, LOSER_ID, 'queued_to_play');

    const report = applyForceMerge(db.raw, [rule], { dryRun: true });

    expect(report.merged).toBe(1);
    expect(report.dryRun).toBe(true);
    expect(report.rules[0].mergedIds).toEqual([LOSER_ID]);
    expect(getGame(db.raw, LOSER_ID)).toBeDefined();
    expect(getStatusRow(db, WINNER_ID)).toBeUndefined();
    expect(getStatusRow(db, LOSER_ID)).toEqual(
      expect.objectContaining({ status: 'queued_to_play' }),
    );
  });

  it('skips rules whose canonical row or duplicates are missing', () => {
    const missingCanonical: ForceMergeRule = {
      games: ['Rustler', 'Rustler - Grand Theft Horse'],
      canonicalName: 'Ghost Recon Wildlands',
    };
    const noDuplicate: ForceMergeRule = {
      games: ['Rustler'],
      canonicalName: 'Rustler',
    };

    const report = applyForceMerge(db.raw, [missingCanonical, noDuplicate]);

    expect(report.merged).toBe(0);
    expect(report.rules[0]).toMatchObject({
      winnerId: null,
      mergedIds: [],
      skipped: true,
      skipReason: 'canonical row not found',
    });
    expect(report.rules[1]).toMatchObject({
      winnerId: WINNER_ID,
      mergedIds: [],
      skipped: true,
      skipReason: 'no duplicate rows to merge',
    });
    expect(getGame(db.raw, LOSER_ID)).toBeDefined();
  });

  it('applies only the rule selected via the rule filter', () => {
    const otherLoser = 'senua-s-saga-hellblade-ii';
    const otherRule: ForceMergeRule = {
      games: ["Hellblade II: Senua's Saga", "Senua's Saga: Hellblade II"],
      canonicalName: "Senua's Saga: Hellblade II",
    };
    upsertGames(db.raw, [
      makeGame({ canonicalId: 'steam:200', name: "Senua's Saga: Hellblade II" }),
      makeGame({
        canonicalId: otherLoser,
        name: "Hellblade II: Senua's Saga",
        primarySource: 'xbox',
        ownedSources: ['xbox'],
      }),
    ]);

    const report = applyForceMerge(db.raw, [rule, otherRule], {
      rule: "Senua's Saga: Hellblade II",
    });

    expect(report.rules).toHaveLength(1);
    expect(report.rules[0].canonicalName).toBe("Senua's Saga: Hellblade II");
    expect(getGame(db.raw, otherLoser)).toBeUndefined();
    expect(getGame(db.raw, LOSER_ID)).toBeDefined();
  });

  it('re-points owned_games and interests rows from loser to winner', () => {
    db.raw
      .prepare(
        `INSERT INTO owned_games (canonical_id, name, platform)
         VALUES (?, 'Rustler - Grand Theft Horse', 'xbox')`,
      )
      .run(LOSER_ID);
    db.raw
      .prepare(
        `INSERT INTO interests (catalog_product_id, title, canonical_id)
         VALUES (?, 'Rustler - Grand Theft Horse', ?)`,
      )
      .run('ms-store-1', LOSER_ID);

    applyForceMerge(db.raw, [rule]);

    const owned = db.raw
      .prepare('SELECT canonical_id, platform FROM owned_games')
      .all() as { canonical_id: string; platform: string }[];
    expect(owned).toEqual([{ canonical_id: WINNER_ID, platform: 'xbox' }]);

    const interest = db.raw
      .prepare('SELECT canonical_id FROM interests WHERE catalog_product_id = ?')
      .get('ms-store-1') as { canonical_id: string };
    expect(interest.canonical_id).toBe(WINNER_ID);
  });

  it('drops the loser owned_games row when the winner already owns an entry', () => {
    db.raw
      .prepare(
        `INSERT INTO owned_games (canonical_id, name) VALUES (?, 'Rustler')`,
      )
      .run(WINNER_ID);
    db.raw
      .prepare(
        `INSERT INTO owned_games (canonical_id, name, platform)
         VALUES (?, 'Rustler - Grand Theft Horse', 'xbox')`,
      )
      .run(LOSER_ID);

    applyForceMerge(db.raw, [rule]);

    const owned = db.raw
      .prepare('SELECT canonical_id FROM owned_games ORDER BY canonical_id')
      .all() as { canonical_id: string }[];
    expect(owned).toEqual([{ canonical_id: WINNER_ID }]);
  });

  it('rebuilds the FTS index so the loser disappears from search', () => {
    const before = db.raw
      .prepare('SELECT COUNT(*) AS n FROM games_fts')
      .get() as { n: number };
    expect(before.n).toBe(2);

    applyForceMerge(db.raw, [rule]);

    const after = db.raw
      .prepare('SELECT COUNT(*) AS n FROM games_fts')
      .get() as { n: number };
    expect(after.n).toBe(1);
    const hit = db.raw
      .prepare('SELECT COUNT(*) AS n FROM games_fts WHERE canonical_id = ?')
      .get(LOSER_ID) as { n: number };
    expect(hit.n).toBe(0);
    const winnerHit = db.raw
      .prepare('SELECT COUNT(*) AS n FROM games_fts WHERE canonical_id = ?')
      .get(WINNER_ID) as { n: number };
    expect(winnerHit.n).toBe(1);
  });

  it('merges every duplicate a multi-name rule matches', () => {
    const third = 'rustler-2';
    upsertGames(db.raw, [
      makeGame({
        canonicalId: third,
        name: 'Rustler 2',
        primarySource: 'epic',
        ownedSources: ['epic'],
        playtimeHours: 5,
        lastPlayedAt: new Date('2026-03-05T00:00:00.000Z'),
      }),
    ]);

    const report = applyForceMerge(db.raw, [
      { games: ['Rustler', 'Rustler - Grand Theft Horse', 'Rustler 2'], canonicalName: 'Rustler' },
    ]);

    expect(report.merged).toBe(2);
    expect(report.rules[0].mergedIds.sort()).toEqual([LOSER_ID, third].sort());
    const winner = getGame(db.raw, WINNER_ID)!;
    expect(winner.ownedSources).toEqual(['steam', 'xbox', 'epic']);
    expect(winner.playtimeHours).toBe(9);
    expect(winner.lastPlayedAt?.toISOString()).toBe('2026-03-05T00:00:00.000Z');
    expect(getGame(db.raw, third)).toBeUndefined();
  });
});

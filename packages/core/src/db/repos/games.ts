import type { DatabaseSync } from 'node:sqlite';
import type { Source, UnifiedGame } from '../../types/game';

type GameRow = {
  canonical_id: string;
  name: string;
  primary_source: Source;
  owned_sources: string;
  steam_app_id: number | null;
  playtime_hours: number | null;
  last_played_at: string | null;
  cover_image_url: string | null;
  release_date: string | null;
  interest: string | null;
  proton_json: string | null;
  created_at: string;
  updated_at: string;
  raw_json: string | null;
  igdb_id: number | null;
  meta_source: string | null;
  enriched_at: string | null;
  igdb_enriched_at: string | null;
  description: string | null;
  developer: string | null;
  publisher: string | null;
};

const toRow = (game: UnifiedGame): (string | number | null)[] => [
  game.canonicalId,
  game.name,
  game.primarySource,
  JSON.stringify(game.ownedSources),
  game.steamAppId ?? null,
  game.playtimeHours ?? null,
  game.lastPlayedAt ? game.lastPlayedAt.toISOString() : null,
  game.coverImageUrl ?? null,
  game.releaseDate ? game.releaseDate.toISOString() : null,
  game.interest ?? null,
  game.proton ? JSON.stringify(game.proton) : null,
  game.createdAt.toISOString(),
  game.updatedAt.toISOString(),
  game.description ?? null,
  game.developer ?? null,
  game.publisher ?? null,
];

const fromRow = (row: GameRow): UnifiedGame => {
  const proton = row.proton_json
    ? (JSON.parse(row.proton_json) as UnifiedGame['proton'])
    : undefined;
  if (proton?.lastUpdated) {
    proton.lastUpdated = new Date(proton.lastUpdated);
  }

  return {
    canonicalId: row.canonical_id,
    name: row.name,
    primarySource: row.primary_source,
    ownedSources: JSON.parse(row.owned_sources) as Source[],
    steamAppId: row.steam_app_id ?? undefined,
    playtimeHours: row.playtime_hours ?? undefined,
    lastPlayedAt: row.last_played_at ? new Date(row.last_played_at) : undefined,
    coverImageUrl: row.cover_image_url ?? undefined,
    releaseDate: row.release_date ? new Date(row.release_date) : undefined,
    interest: (row.interest as UnifiedGame['interest']) ?? undefined,
    proton,
    description: row.description ?? undefined,
    developer: row.developer ?? undefined,
    publisher: row.publisher ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
};

// Metadata columns use COALESCE(excluded, existing): a sync resend without
// the field must not clobber enrichment (Steam appdetails / local harvest);
// a new non-null value still updates.
const UPSERT_SQL = `
  INSERT INTO games (
    canonical_id, name, primary_source, owned_sources, steam_app_id,
    playtime_hours, last_played_at, cover_image_url, release_date,
    interest, proton_json, created_at, updated_at,
    description, developer, publisher
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(canonical_id) DO UPDATE SET
    name = excluded.name,
    primary_source = excluded.primary_source,
    owned_sources = excluded.owned_sources,
    steam_app_id = excluded.steam_app_id,
    playtime_hours = excluded.playtime_hours,
    last_played_at = excluded.last_played_at,
    cover_image_url = excluded.cover_image_url,
    release_date = COALESCE(excluded.release_date, games.release_date),
    interest = excluded.interest,
    proton_json = excluded.proton_json,
    description = COALESCE(excluded.description, games.description),
    developer = COALESCE(excluded.developer, games.developer),
    publisher = COALESCE(excluded.publisher, games.publisher),
    updated_at = excluded.updated_at
`;

export const upsertGames = (
  db: DatabaseSync,
  games: UnifiedGame[],
): number => {
  const stmt = db.prepare(UPSERT_SQL);
  db.exec('BEGIN');
  try {
    for (const game of games) {
      stmt.run(...toRow(game));
    }
    rebuildGamesFts(db);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  db.exec('COMMIT');
  return games.length;
};

export type UnavailableFlag = {
  canonicalId: string;
  reason: string;
};

/**
 * Reconcile the games.unavailable_reason column against the current
 * availability snapshot: flag the given games, clear every other flag.
 * The snapshot is authoritative — an empty list clears all flags.
 */
export const reconcileUnavailableReasons = (
  db: DatabaseSync,
  flagged: UnavailableFlag[],
): { flagged: number; cleared: number } => {
  const setStmt = db.prepare(
    `
    UPDATE games SET unavailable_reason = ?
    WHERE canonical_id = ?
      AND COALESCE(unavailable_reason, '') != ?
    `,
  );
  const clearStmt = db.prepare(
    'UPDATE games SET unavailable_reason = NULL WHERE unavailable_reason IS NOT NULL',
  );
  const clearExcludedStmt = db.prepare(
    `UPDATE games SET unavailable_reason = NULL
     WHERE unavailable_reason IS NOT NULL
       AND canonical_id NOT IN (${flagged.map(() => '?').join(', ')})`,
  );

  db.exec('BEGIN');
  try {
    const cleared = Number(
      (flagged.length > 0
        ? clearExcludedStmt.run(...flagged.map((flag) => flag.canonicalId))
        : clearStmt.run()
      ).changes,
    );
    let flagCount = 0;
    for (const flag of flagged) {
      const result = setStmt.run(flag.reason, flag.canonicalId, flag.reason);
      flagCount += Number(result.changes);
    }
    db.exec('COMMIT');
    return { flagged: flagCount, cleared };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

export const getGame = (
  db: DatabaseSync,
  canonicalId: string,
): UnifiedGame | undefined => {
  const row = db
    .prepare('SELECT * FROM games WHERE canonical_id = ?')
    .get(canonicalId) as GameRow | undefined;
  return row ? fromRow(row) : undefined;
};

export const listGames = (db: DatabaseSync): UnifiedGame[] => {
  const rows = db
    .prepare('SELECT * FROM games ORDER BY name COLLATE NOCASE')
    .all() as unknown as GameRow[];
  return rows.map(fromRow);
};

export const rebuildGamesFts = (db: DatabaseSync): number => {
  db.exec('DELETE FROM games_fts');
  db.exec(
    'INSERT INTO games_fts (canonical_id, name) SELECT canonical_id, name FROM games',
  );
  const row = db.prepare('SELECT COUNT(*) AS c FROM games').get() as {
    c: number;
  };
  return row.c;
};

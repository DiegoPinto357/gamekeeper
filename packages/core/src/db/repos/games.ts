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
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
};

const UPSERT_SQL = `
  INSERT INTO games (
    canonical_id, name, primary_source, owned_sources, steam_app_id,
    playtime_hours, last_played_at, cover_image_url, release_date,
    interest, proton_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(canonical_id) DO UPDATE SET
    name = excluded.name,
    primary_source = excluded.primary_source,
    owned_sources = excluded.owned_sources,
    steam_app_id = excluded.steam_app_id,
    playtime_hours = excluded.playtime_hours,
    last_played_at = excluded.last_played_at,
    cover_image_url = excluded.cover_image_url,
    release_date = excluded.release_date,
    interest = excluded.interest,
    proton_json = excluded.proton_json,
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

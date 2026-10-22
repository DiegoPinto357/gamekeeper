import type { DatabaseSync } from 'node:sqlite';
import type { Source } from '../../types/game';

const MIN_SPACING = 1e-9;

export type StatusEntry = {
  key: string;
  label: string;
  color: string;
  position: number;
};

export type LibraryGame = {
  canonicalId: string;
  name: string;
  coverImageUrl: string | null;
  playtimeHours: number | null;
  primarySource: Source;
  ownedSources: Source[];
  status: string | null;
  position: number | null;
};

export type SetStatusResult = {
  canonicalId: string;
  status: string;
  position: number;
};

export class UnknownStatusError extends Error {
  constructor(readonly status: string) {
    super(`Unknown status: ${status}`);
    this.name = 'UnknownStatusError';
  }
}

export class UnknownGameError extends Error {
  constructor(readonly canonicalId: string) {
    super(`Unknown game: ${canonicalId}`);
    this.name = 'UnknownGameError';
  }
}

export const listStatuses = (db: DatabaseSync): StatusEntry[] => {
  const rows = db
    .prepare(
      'SELECT key, label, color, position FROM statuses ORDER BY position',
    )
    .all() as unknown as StatusEntry[];
  return rows;
};

export const getLibraryGames = (db: DatabaseSync): LibraryGame[] => {
  const rows = db
    .prepare(
      `
      SELECT
        g.canonical_id,
        g.name,
        g.cover_image_url,
        g.playtime_hours,
        g.primary_source,
        g.owned_sources,
        gs.status,
        gs.position
      FROM games g
      LEFT JOIN game_status gs ON gs.canonical_id = g.canonical_id
      ORDER BY
        COALESCE(gs.status, 'backlog'),
        (gs.position IS NULL),
        gs.position,
        COALESCE(g.last_played_at, g.created_at) DESC,
        g.name ASC
      `,
    )
    .all() as unknown as {
    canonical_id: string;
    name: string;
    cover_image_url: string | null;
    playtime_hours: number | null;
    primary_source: Source;
    owned_sources: string;
    status: string | null;
    position: number | null;
  }[];

  return rows.map((row) => ({
    canonicalId: row.canonical_id,
    name: row.name,
    coverImageUrl: row.cover_image_url,
    playtimeHours: row.playtime_hours,
    primarySource: row.primary_source,
    ownedSources: JSON.parse(row.owned_sources) as Source[],
    status: row.status,
    position: row.position,
  }));
};

export const materializeBacklog = (db: DatabaseSync): number => {
  const pending = db
    .prepare(
      `
      SELECT g.canonical_id
      FROM games g
      LEFT JOIN game_status gs ON gs.canonical_id = g.canonical_id
      WHERE gs.canonical_id IS NULL
      ORDER BY COALESCE(g.last_played_at, g.created_at) DESC, g.name ASC
      `,
    )
    .all() as unknown as { canonical_id: string }[];
  if (pending.length === 0) return 0;

  const maxRow = db
    .prepare(
      "SELECT COALESCE(MAX(position), 0) AS m FROM game_status WHERE status = 'backlog'",
    )
    .get() as { m: number };

  const insert = db.prepare(
    "INSERT INTO game_status (canonical_id, status, position) VALUES (?, 'backlog', ?)",
  );
  db.exec('BEGIN');
  try {
    let position = maxRow.m;
    for (const row of pending) {
      position += 1;
      insert.run(row.canonical_id, position);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return pending.length;
};

const statusExists = (db: DatabaseSync, status: string): boolean => {
  const row = db
    .prepare('SELECT 1 FROM statuses WHERE key = ?')
    .get(status);
  return row !== undefined;
};

const gameExists = (db: DatabaseSync, canonicalId: string): boolean => {
  const row = db
    .prepare('SELECT 1 FROM games WHERE canonical_id = ?')
    .get(canonicalId);
  return row !== undefined;
};

const getStatusRow = (
  db: DatabaseSync,
  canonicalId: string,
): { status: string; position: number | null } | undefined =>
  db
    .prepare('SELECT status, position FROM game_status WHERE canonical_id = ?')
    .get(canonicalId) as
    | { status: string; position: number | null }
    | undefined;

const maxColumnPosition = (
  db: DatabaseSync,
  status: string,
): number => {
  const row = db
    .prepare(
      'SELECT COALESCE(MAX(position), 0) AS m FROM game_status WHERE status = ?',
    )
    .get(status) as { m: number };
  return row.m;
};

const reindexColumn = (db: DatabaseSync, status: string): void => {
  const rows = db
    .prepare(
      `
      SELECT canonical_id FROM game_status
      WHERE status = ?
      ORDER BY (position IS NULL), position, canonical_id
      `,
    )
    .all(status) as unknown as { canonical_id: string }[];
  const update = db.prepare(
    'UPDATE game_status SET position = ? WHERE canonical_id = ?',
  );
  db.exec('BEGIN');
  try {
    rows.forEach((row, index) => {
      update.run(index + 1, row.canonical_id);
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

const needsReindex = (prev: number, next: number): boolean => {
  const mid = (prev + next) / 2;
  return next - prev < MIN_SPACING || !(mid > prev && mid < next);
};

const upsertGameStatus = (
  db: DatabaseSync,
  canonicalId: string,
  status: string,
  position: number,
): void => {
  db.prepare(
    `
    INSERT INTO game_status (canonical_id, status, position) VALUES (?, ?, ?)
    ON CONFLICT(canonical_id) DO UPDATE SET
      status = excluded.status,
      position = excluded.position
    `,
  ).run(canonicalId, status, position);
};

export const setGameStatus = (
  db: DatabaseSync,
  canonicalId: string,
  status: string,
  neighbors: { beforeId?: string | null; afterId?: string | null } = {},
): SetStatusResult => {
  if (!statusExists(db, status)) throw new UnknownStatusError(status);
  if (!gameExists(db, canonicalId)) throw new UnknownGameError(canonicalId);

  const current = getStatusRow(db, canonicalId);
  if (
    status === 'backlog' ||
    current == null ||
    current.status === 'backlog'
  ) {
    materializeBacklog(db);
  }

  const resolveNeighbor = (id: string | null | undefined) => {
    if (!id || id === canonicalId) return null;
    const row = getStatusRow(db, id);
    if (!row || row.status !== status || row.position == null) return null;
    return row.position;
  };

  const prev = resolveNeighbor(neighbors.beforeId);
  const next = resolveNeighbor(neighbors.afterId);

  let position: number;
  if (prev != null && next != null) {
    if (needsReindex(prev, next)) {
      reindexColumn(db, status);
      const prev2 = resolveNeighbor(neighbors.beforeId);
      const next2 = resolveNeighbor(neighbors.afterId);
      position =
        prev2 != null && next2 != null
          ? (prev2 + next2) / 2
          : prev2 != null
            ? prev2 + 1
            : next2 != null
              ? next2 - 1
              : maxColumnPosition(db, status) + 1;
    } else {
      position = (prev + next) / 2;
    }
  } else if (prev != null) {
    position = prev + 1;
  } else if (next != null) {
    position = next - 1;
  } else {
    position = maxColumnPosition(db, status) + 1;
  }

  upsertGameStatus(db, canonicalId, status, position);
  return { canonicalId, status, position };
};

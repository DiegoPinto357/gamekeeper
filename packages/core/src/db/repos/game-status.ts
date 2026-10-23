import type { DatabaseSync } from 'node:sqlite';
import type { Source } from '../../types/game';

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
  pinned: boolean;
  unavailableReason: string | null;
};

export type SetStatusResult = {
  canonicalId: string;
  status: string;
  /** null for cross-column moves (the game joins the auto flow). */
  position: number | null;
};

export type UnpinResult = {
  canonicalId: string;
  status: string;
  pinned: false;
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

type BoardRow = {
  canonical_id: string;
  name: string;
  cover_image_url: string | null;
  playtime_hours: number | null;
  primary_source: Source;
  owned_sources: string;
  unavailable_reason: string | null;
  last_played_at: string | null;
  created_at: string | null;
  status: string | null;
  position: number | null;
  pinned: number;
};

const BOARD_SELECT = `
  SELECT
    g.canonical_id,
    g.name,
    g.cover_image_url,
    g.playtime_hours,
    g.primary_source,
    g.owned_sources,
    g.unavailable_reason,
    g.last_played_at,
    g.created_at,
    gs.status,
    gs.position,
    gs.pinned
  FROM games g
  LEFT JOIN game_status gs ON gs.canonical_id = g.canonical_id
`;

const readBoardRows = (db: DatabaseSync): BoardRow[] =>
  db.prepare(BOARD_SELECT).all() as unknown as BoardRow[];

/**
 * Merge a column's rows into display order (P2.2a).
 *
 * Unpinned rows flow live by `COALESCE(last_played_at, created_at) DESC,
 * name ASC`. Pinned rows anchor at their stored display rank
 * (`round(position)`); auto cards fill the slots around them. A pinned
 * rank past the end of the column (or with auto cards exhausted) simply
 * appends — merge never crashes on stale ranks.
 */
const mergeColumn = <T extends {
  canonical_id: string;
  name: string;
  position: number | null;
  pinned: number;
  last_played_at?: string | null;
  created_at?: string | null;
}>(
  rows: T[],
): T[] => {
  const auto = rows
    .filter((row) => !row.pinned)
    .sort((a, b) => {
      const ka = a.last_played_at ?? a.created_at ?? '';
      const kb = b.last_played_at ?? b.created_at ?? '';
      if (ka !== kb) return ka < kb ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  const pinnedRows = rows
    .filter((row) => row.pinned)
    .sort((a, b) => {
      const pa = a.position ?? Number.MAX_SAFE_INTEGER;
      const pb = b.position ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return a.canonical_id.localeCompare(b.canonical_id);
    });

  const merged: T[] = [];
  let autoIndex = 0;
  for (const pin of pinnedRows) {
    const want = Math.max(1, Math.round(pin.position ?? pinnedRows.length + auto.length));
    while (merged.length + 1 < want && autoIndex < auto.length) {
      merged.push(auto[autoIndex++]);
    }
    merged.push(pin);
  }
  while (autoIndex < auto.length) {
    merged.push(auto[autoIndex++]);
  }
  return merged;
};

export const getLibraryGames = (db: DatabaseSync): LibraryGame[] => {
  const rows = readBoardRows(db);

  // merge per column; columns render independently (the client picks order
  // per status key), so the flatten order across columns is irrelevant
  const byColumn = new Map<string, BoardRow[]>();
  for (const row of rows) {
    const column = row.status ?? 'backlog';
    const list = byColumn.get(column);
    if (list) list.push(row);
    else byColumn.set(column, [row]);
  }

  const ordered: BoardRow[] = [];
  for (const columnRows of byColumn.values()) {
    ordered.push(...mergeColumn(columnRows));
  }

  return ordered.map((row) => ({
    canonicalId: row.canonical_id,
    name: row.name,
    coverImageUrl: row.cover_image_url,
    playtimeHours: row.playtime_hours,
    primarySource: row.primary_source,
    ownedSources: JSON.parse(row.owned_sources) as Source[],
    unavailableReason: row.unavailable_reason,
    status: row.status,
    position: row.position,
    pinned: row.pinned === 1,
  }));
};

const statusExists = (db: DatabaseSync, status: string): boolean => {
  const row = db.prepare('SELECT 1 FROM statuses WHERE key = ?').get(status);
  return row !== undefined;
};

const gameExists = (db: DatabaseSync, canonicalId: string): boolean => {
  const row = db.prepare('SELECT 1 FROM games WHERE canonical_id = ?').get(canonicalId);
  return row !== undefined;
};

const getStatusRow = (
  db: DatabaseSync,
  canonicalId: string,
): { status: string; position: number | null; pinned: number; notes: string | null } | undefined =>
  db
    .prepare(
      'SELECT status, position, pinned, notes FROM game_status WHERE canonical_id = ?',
    )
    .get(canonicalId) as
    | { status: string; position: number | null; pinned: number; notes: string | null }
    | undefined;

const upsertGameStatus = (
  db: DatabaseSync,
  canonicalId: string,
  status: string,
  position: number | null,
  pinned: number,
): void => {
  db.prepare(
    `
    INSERT INTO game_status (canonical_id, status, position, pinned) VALUES (?, ?, ?, ?)
    ON CONFLICT(canonical_id) DO UPDATE SET
      status = excluded.status,
      position = excluded.position,
      pinned = excluded.pinned
    `,
  ).run(canonicalId, status, position, pinned);
};

/**
 * Move a game to a status (P2.2a).
 *
 * Same-column moves (reorder within the current status, incl. drops on
 * default-backlog no-row games) PIN the game at the drop slot: the
 * column's display order is computed with the moving game excluded,
 * `beforeId`/`afterId` are display neighbors, and pinned rows are
 * reindexed to their new ranks.
 *
 * Cross-column moves never pin: the game joins the target column's auto
 * flow (pinned=0, position NULL — ordered live by last played) and the
 * neighbors are ignored.
 */
export const setGameStatus = (
  db: DatabaseSync,
  canonicalId: string,
  status: string,
  neighbors: { beforeId?: string | null; afterId?: string | null } = {},
): SetStatusResult => {
  if (!statusExists(db, status)) throw new UnknownStatusError(status);
  if (!gameExists(db, canonicalId)) throw new UnknownGameError(canonicalId);

  const current = getStatusRow(db, canonicalId);
  const fromColumn = current?.status ?? 'backlog';
  if (fromColumn !== status) {
    upsertGameStatus(db, canonicalId, status, null, 0);
    return { canonicalId, status, position: null };
  }

  const columnRows = readBoardRows(db).filter(
    (row) =>
      row.canonical_id !== canonicalId && (row.status ?? 'backlog') === status,
  );
  const display = mergeColumn(columnRows);
  const rank = new Map(display.map((row, index) => [row.canonical_id, index + 1]));

  const beforeRank =
    neighbors.beforeId != null ? rank.get(neighbors.beforeId) : undefined;
  const afterRank =
    neighbors.afterId != null ? rank.get(neighbors.afterId) : undefined;

  let slot: number;
  if (beforeRank != null) {
    slot = beforeRank + 1;
  } else if (afterRank != null) {
    slot = Math.max(1, afterRank - 1);
  } else {
    slot = display.length + 1;
  }

  const newDisplay = [...display];
  newDisplay.splice(Math.min(slot - 1, newDisplay.length), 0, {
    canonical_id: canonicalId,
    position: slot,
    pinned: 1,
  } as BoardRow);
  const position = newDisplay.findIndex((row) => row.canonical_id === canonicalId) + 1;

  db.exec('BEGIN');
  try {
    upsertGameStatus(db, canonicalId, status, position, 1);
    const updatePinned = db.prepare(
      'UPDATE game_status SET position = ? WHERE canonical_id = ? AND pinned = 1',
    );
    for (let index = 0; index < newDisplay.length; index++) {
      const row = newDisplay[index];
      if (row.canonical_id === canonicalId) continue;
      if (!row.pinned) continue;
      updatePinned.run(index + 1, row.canonical_id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { canonicalId, status, position };
};

/**
 * Return a game to the auto flow (P2.2a). Backlog rows are deleted
 * (the lazy no-row backlog order takes over, notes preserved by keeping
 * the row unpinned); other statuses keep their row with pinned=0.
 */
export const unpinGame = (
  db: DatabaseSync,
  canonicalId: string,
): UnpinResult => {
  if (!gameExists(db, canonicalId)) throw new UnknownGameError(canonicalId);

  const row = getStatusRow(db, canonicalId);
  if (!row) {
    return { canonicalId, status: 'backlog', pinned: false };
  }

  if (row.status === 'backlog' && row.notes == null) {
    db.prepare('DELETE FROM game_status WHERE canonical_id = ?').run(canonicalId);
  } else {
    db.prepare(
      'UPDATE game_status SET pinned = 0, position = NULL WHERE canonical_id = ?',
    ).run(canonicalId);
  }

  return { canonicalId, status: row.status, pinned: false };
};

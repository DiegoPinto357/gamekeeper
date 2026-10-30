import type { DatabaseSync } from 'node:sqlite';
import type { ForceMergeRule } from '../../types/overrides';
import { normalizeGameName } from '../../core/normalize';
import { rebuildGamesFts } from './games';

export type ForceMergeOptions = {
  /** What happens when winner and loser both have a status row and they differ. */
  statusConflict?: 'winner' | 'loser';
  dryRun?: boolean;
  /** Only apply the rule whose canonicalName matches this value. */
  rule?: string;
};

export type StatusAction = 'none' | 'kept-winner' | 'copied-loser' | 'overwrote-winner';

export type ForceMergeRuleReport = {
  canonicalName: string;
  winnerId: string | null;
  mergedIds: string[];
  skipped: boolean;
  skipReason?: string;
  statusAction: StatusAction;
};

export type ForceMergeReport = {
  rules: ForceMergeRuleReport[];
  merged: number;
  dryRun: boolean;
};

type Row = Record<string, string | number | null>;

type StatusRow = {
  status: string;
  position: number | null;
  pinned: number;
  notes: string | null;
  updated_at: string;
};

const STATUS_ACTION_RANK: Record<StatusAction, number> = {
  none: 0,
  'kept-winner': 1,
  'copied-loser': 2,
  'overwrote-winner': 3,
};

const coalesce = (winner: string | null, loser: string | null): string | null =>
  winner ?? loser;

const maxStr = (
  a: string | null,
  b: string | null,
): string | null => (a === null || b === null ? a ?? b : a >= b ? a : b);

const minStr = (
  a: string | null,
  b: string | null,
): string | null => (a === null || b === null ? a ?? b : a <= b ? a : b);

const sumHours = (
  winner: number | null,
  loser: number | null,
): number | null => {
  if (winner === null && loser === null) return null;
  return (winner ?? 0) + (loser ?? 0);
};

const unionSources = (winnerJson: string | null, loserJson: string | null): string[] => {
  const parse = (json: string | null): string[] => {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  };
  const merged = parse(winnerJson);
  for (const source of parse(loserJson)) {
    if (!merged.includes(source)) merged.push(source);
  }
  return merged;
};

const mergeRows = (winner: Row, loser: Row): Row => ({
  owned_sources: JSON.stringify(
    unionSources(
      winner.owned_sources as string | null,
      loser.owned_sources as string | null,
    ),
  ),
  steam_app_id: winner.steam_app_id ?? loser.steam_app_id,
  playtime_hours: sumHours(
    winner.playtime_hours as number | null,
    loser.playtime_hours as number | null,
  ),
  last_played_at: maxStr(
    winner.last_played_at as string | null,
    loser.last_played_at as string | null,
  ),
  cover_image_url: coalesce(
    winner.cover_image_url as string | null,
    loser.cover_image_url as string | null,
  ),
  release_date: coalesce(
    winner.release_date as string | null,
    loser.release_date as string | null,
  ),
  interest: coalesce(winner.interest as string | null, loser.interest as string | null),
  proton_json: coalesce(
    winner.proton_json as string | null,
    loser.proton_json as string | null,
  ),
  created_at: minStr(
    winner.created_at as string | null,
    loser.created_at as string | null,
  ),
  updated_at: maxStr(
    winner.updated_at as string | null,
    loser.updated_at as string | null,
  ),
  raw_json: coalesce(winner.raw_json as string | null, loser.raw_json as string | null),
  igdb_id: winner.igdb_id ?? loser.igdb_id,
  meta_source: coalesce(
    winner.meta_source as string | null,
    loser.meta_source as string | null,
  ),
  enriched_at: coalesce(
    winner.enriched_at as string | null,
    loser.enriched_at as string | null,
  ),
  igdb_enriched_at: coalesce(
    winner.igdb_enriched_at as string | null,
    loser.igdb_enriched_at as string | null,
  ),
  unavailable_reason: coalesce(
    winner.unavailable_reason as string | null,
    loser.unavailable_reason as string | null,
  ),
  description: coalesce(
    winner.description as string | null,
    loser.description as string | null,
  ),
  developer: coalesce(
    winner.developer as string | null,
    loser.developer as string | null,
  ),
  publisher: coalesce(
    winner.publisher as string | null,
    loser.publisher as string | null,
  ),
});

const getStatusRow = (db: DatabaseSync, canonicalId: string): StatusRow | undefined =>
  db
    .prepare(
      `SELECT status, position, pinned, notes, updated_at
       FROM game_status WHERE canonical_id = ?`,
    )
    .get(canonicalId) as StatusRow | undefined;

const insertStatusRow = (db: DatabaseSync, canonicalId: string, row: StatusRow): void => {
  db.prepare(
    `INSERT INTO game_status (canonical_id, status, position, pinned, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(canonical_id) DO UPDATE SET
       status = excluded.status, position = excluded.position,
       pinned = excluded.pinned, notes = excluded.notes,
       updated_at = excluded.updated_at`,
  ).run(canonicalId, row.status, row.position, row.pinned, row.notes, row.updated_at);
};

const decideStatusAction = (
  winnerStatus: StatusRow | undefined,
  loserStatus: StatusRow | undefined,
  conflict: 'winner' | 'loser',
): StatusAction => {
  if (!loserStatus) return 'none';
  if (!winnerStatus) return 'copied-loser';
  if (winnerStatus.status === loserStatus.status) return 'kept-winner';
  return conflict === 'loser' ? 'overwrote-winner' : 'kept-winner';
};

const applyStatus = (
  db: DatabaseSync,
  winnerId: string,
  loserId: string,
  conflict: 'winner' | 'loser',
): StatusAction => {
  const winnerStatus = getStatusRow(db, winnerId);
  const loserStatus = getStatusRow(db, loserId);
  const action = decideStatusAction(winnerStatus, loserStatus, conflict);
  if (!loserStatus) return action;
  if (action === 'copied-loser') {
    insertStatusRow(db, winnerId, loserStatus!);
    db.prepare('DELETE FROM game_status WHERE canonical_id = ?').run(loserId);
    return action;
  }
  if (action === 'overwrote-winner') {
    db.prepare('DELETE FROM game_status WHERE canonical_id = ?').run(winnerId);
    insertStatusRow(db, winnerId, loserStatus!);
    db.prepare('DELETE FROM game_status WHERE canonical_id = ?').run(loserId);
    return action;
  }
  db.prepare('DELETE FROM game_status WHERE canonical_id = ?').run(loserId);
  return action;
};

const repointReferences = (
  db: DatabaseSync,
  winnerId: string,
  loserId: string,
): void => {
  db.prepare(
    `INSERT OR IGNORE INTO game_genres (canonical_id, genre_id)
     SELECT ?, genre_id FROM game_genres WHERE canonical_id = ?`,
  ).run(winnerId, loserId);
  db.prepare(
    `INSERT OR IGNORE INTO game_tags (canonical_id, tag_id)
     SELECT ?, tag_id FROM game_tags WHERE canonical_id = ?`,
  ).run(winnerId, loserId);
  db.prepare('DELETE FROM game_genres WHERE canonical_id = ?').run(loserId);
  db.prepare('DELETE FROM game_tags WHERE canonical_id = ?').run(loserId);

  db.prepare(
    'DELETE FROM similar_games WHERE canonical_id = ? AND similar_canonical_id = ?',
  ).run(winnerId, loserId);
  db.prepare(
    'UPDATE OR IGNORE similar_games SET similar_canonical_id = ? WHERE similar_canonical_id = ?',
  ).run(winnerId, loserId);
  db.prepare('DELETE FROM similar_games WHERE similar_canonical_id = ?').run(loserId);

  db.prepare('UPDATE interests SET canonical_id = ? WHERE canonical_id = ?').run(
    winnerId,
    loserId,
  );

  db.prepare(
    `DELETE FROM owned_games
     WHERE canonical_id = ? AND EXISTS (SELECT 1 FROM owned_games WHERE canonical_id = ?)`,
  ).run(loserId, winnerId);
  db.prepare('UPDATE owned_games SET canonical_id = ? WHERE canonical_id = ?').run(
    winnerId,
    loserId,
  );
};

const mergeGameRow = (
  db: DatabaseSync,
  winnerId: string,
  loserId: string,
): void => {
  const winner = db
    .prepare('SELECT * FROM games WHERE canonical_id = ?')
    .get(winnerId) as Row | undefined;
  const loser = db
    .prepare('SELECT * FROM games WHERE canonical_id = ?')
    .get(loserId) as Row | undefined;
  if (!winner || !loser) return;

  const merged = mergeRows(winner, loser);
  const columns = Object.keys(merged);
  const assignments = columns.map((c) => `${c} = ?`).join(', ');
  db.prepare(
    `UPDATE games SET ${assignments} WHERE canonical_id = ?`,
  ).run(...columns.map((c) => merged[c]), winnerId);
};

const skipReport = (
  canonicalName: string,
  winnerId: string | null,
  skipReason: string,
): ForceMergeRuleReport => ({
  canonicalName,
  winnerId,
  mergedIds: [],
  skipped: true,
  skipReason,
  statusAction: 'none',
});

/**
 * Apply force-merge override rules to the database: pick each rule's
 * canonical row as winner, fold every other matching row's data into it,
 * and delete the losers. Merges are unions/sums (owned sources, playtime,
 * links) with winner-preferred scalar metadata; statuses follow
 * `statusConflict`. The FTS index is rebuilt once after any real merge.
 */
export const applyForceMerge = (
  db: DatabaseSync,
  rules: ForceMergeRule[],
  options: ForceMergeOptions = {},
): ForceMergeReport => {
  const { statusConflict = 'winner', dryRun = false, rule } = options;
  const selected = rule
    ? rules.filter((r) => r.canonicalName === rule)
    : rules;

  const allNames = db
    .prepare('SELECT canonical_id, name FROM games')
    .all() as unknown as { canonical_id: string; name: string }[];

  const reports: ForceMergeRuleReport[] = [];
  let merged = 0;

  const run = (): void => {
    for (const forceRule of selected) {
      const canonicalName = forceRule.canonicalName?.trim();
      if (!canonicalName) {
        reports.push(skipReport('', null, 'rule has no canonicalName'));
        continue;
      }
      const wanted = new Set(forceRule.games.map(normalizeGameName));
      const canonicalKey = normalizeGameName(canonicalName);
      wanted.add(canonicalKey);

      const matches = allNames.filter((g) => wanted.has(normalizeGameName(g.name)));
      const winner = matches.find((g) => normalizeGameName(g.name) === canonicalKey);
      if (!winner) {
        reports.push(skipReport(canonicalName, null, 'canonical row not found'));
        continue;
      }
      const losers = matches.filter((g) => g.canonical_id !== winner.canonical_id);
      if (losers.length === 0) {
        reports.push(
          skipReport(canonicalName, winner.canonical_id, 'no duplicate rows to merge'),
        );
        continue;
      }

      const report: ForceMergeRuleReport = {
        canonicalName,
        winnerId: winner.canonical_id,
        mergedIds: [],
        skipped: false,
        statusAction: 'none',
      };
      for (const loser of losers) {
        if (!dryRun) {
          repointReferences(db, winner.canonical_id, loser.canonical_id);
          const action = applyStatus(
            db,
            winner.canonical_id,
            loser.canonical_id,
            statusConflict,
          );
          if (STATUS_ACTION_RANK[action] > STATUS_ACTION_RANK[report.statusAction]) {
            report.statusAction = action;
          }
          mergeGameRow(db, winner.canonical_id, loser.canonical_id);
          db.prepare('DELETE FROM games WHERE canonical_id = ?').run(loser.canonical_id);
        } else {
          const action = decideStatusAction(
            getStatusRow(db, winner.canonical_id),
            getStatusRow(db, loser.canonical_id),
            statusConflict,
          );
          if (STATUS_ACTION_RANK[action] > STATUS_ACTION_RANK[report.statusAction]) {
            report.statusAction = action;
          }
        }
        report.mergedIds.push(loser.canonical_id);
      }
      merged += losers.length;
      reports.push(report);
    }
  };

  if (dryRun) {
    run();
  } else {
    db.exec('BEGIN');
    try {
      run();
      if (merged > 0) rebuildGamesFts(db);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return { rules: reports, merged, dryRun };
};

import type { DatabaseSync } from 'node:sqlite';
import type { GameOverrides } from '../../types/overrides';

export type ForceMergeRuleEntry = {
  id: number;
  games: string[];
  canonicalName?: string;
};

export type ForceMergeRuleInput = {
  games: string[];
  canonicalName?: string;
};

export class UnknownForceMergeRuleError extends Error {
  constructor(readonly ruleId: number) {
    super(`Unknown force-merge rule: ${ruleId}`);
    this.name = 'UnknownForceMergeRuleError';
  }
}

const RULE_COLUMNS = 'id, match_names, canonical_name';

type RuleRow = {
  id: number;
  match_names: string;
  canonical_name: string | null;
};

const toEntry = (row: RuleRow): ForceMergeRuleEntry => {
  const entry: ForceMergeRuleEntry = {
    id: row.id,
    games: JSON.parse(row.match_names) as string[],
  };
  if (row.canonical_name != null) entry.canonicalName = row.canonical_name;
  return entry;
};

const normalizeInput = (input: ForceMergeRuleInput): {
  games: string[];
  canonicalName: string | null;
} => {
  if (!Array.isArray(input.games) || input.games.length === 0) {
    throw new Error('games must be a non-empty list');
  }
  const games = input.games.map(game => {
    if (typeof game !== 'string' || !game.trim()) {
      throw new Error('games must be a non-empty list');
    }
    return game.trim();
  });
  const canonicalName =
    typeof input.canonicalName === 'string' && input.canonicalName.trim()
      ? input.canonicalName.trim()
      : null;
  return { games, canonicalName };
};

/**
 * Read the user's force-merge rules and property overrides from SQLite
 * (P0B §6). Shape matches the legacy `overrides.json` so `shouldForceMerge`
 * and friends keep working off the in-memory cache.
 */
export const loadGameOverrides = (db: DatabaseSync): GameOverrides => {
  const ruleRows = db
    .prepare(
      'SELECT match_names, canonical_name FROM force_merge_rules ORDER BY position, id',
    )
    .all() as unknown as {
    match_names: string;
    canonical_name: string | null;
  }[];

  const propertyRows = db
    .prepare(
      'SELECT match_id, match_name, properties FROM property_overrides ORDER BY id',
    )
    .all() as unknown as {
    match_id: string | null;
    match_name: string | null;
    properties: string;
  }[];

  return {
    forceMerge: ruleRows.map(row => {
      const rule: { games: string[]; canonicalName?: string } = {
        games: JSON.parse(row.match_names) as string[],
      };
      if (row.canonical_name != null) rule.canonicalName = row.canonical_name;
      return rule;
    }),
    propertyOverrides: propertyRows.map(row => ({
      match: row.match_name ?? row.match_id ?? '',
      properties: JSON.parse(row.properties) as Record<string, unknown>,
    })),
  };
};

export const listForceMergeRules = (db: DatabaseSync): ForceMergeRuleEntry[] => {
  const rows = db
    .prepare(
      `SELECT ${RULE_COLUMNS} FROM force_merge_rules ORDER BY position, id`,
    )
    .all() as unknown as RuleRow[];
  return rows.map(toEntry);
};

export const addForceMergeRule = (
  db: DatabaseSync,
  input: ForceMergeRuleInput,
): ForceMergeRuleEntry => {
  const { games, canonicalName } = normalizeInput(input);
  const next = db
    .prepare(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM force_merge_rules',
    )
    .get() as { next: number };

  const result = db
    .prepare(
      'INSERT INTO force_merge_rules (match_names, canonical_name, position) VALUES (?, ?, ?)',
    )
    .run(JSON.stringify(games), canonicalName, next.next);

  return { id: Number(result.lastInsertRowid), games, ...(canonicalName != null && { canonicalName }) };
};

export const updateForceMergeRule = (
  db: DatabaseSync,
  ruleId: number,
  input: ForceMergeRuleInput,
): ForceMergeRuleEntry => {
  const existing = db
    .prepare(`SELECT ${RULE_COLUMNS} FROM force_merge_rules WHERE id = ?`)
    .get(ruleId) as RuleRow | undefined;
  if (!existing) throw new UnknownForceMergeRuleError(ruleId);

  const { games, canonicalName } = normalizeInput(input);
  db.prepare(
    'UPDATE force_merge_rules SET match_names = ?, canonical_name = ? WHERE id = ?',
  ).run(JSON.stringify(games), canonicalName, ruleId);

  return {
    id: ruleId,
    games,
    ...(canonicalName != null && { canonicalName }),
  };
};

export const deleteForceMergeRule = (
  db: DatabaseSync,
  ruleId: number,
): boolean =>
  Number(
    db.prepare('DELETE FROM force_merge_rules WHERE id = ?').run(ruleId).changes,
  ) > 0;

import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { GameOverrides } from '../types/overrides';
import { manualId } from './manual-id';

export type LegacyImportCounts = {
  interests: number;
  owned: number;
  forceMergeRules: number;
  propertyOverrides: number;
};

const ZERO: LegacyImportCounts = {
  interests: 0,
  owned: 0,
  forceMergeRules: 0,
  propertyOverrides: 0,
};

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
};

const tableCount = (db: DatabaseSync, table: string): number => {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as {
    c: number;
  };
  return row.c;
};

const uniqueManualId = (
  db: DatabaseSync,
  table: string,
  column: string,
  name: string,
  used: Set<string>,
): string => {
  let id = manualId(name);
  let n = 2;
  while (used.has(id) || db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ?`).get(id)) {
    id = `${manualId(name)}-${n++}`;
  }
  used.add(id);
  return id;
};

const inTransaction = (db: DatabaseSync, fn: () => void): void => {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

/**
 * One-time legacy import (P0B §6): copy the hand-edited JSON user data into
 * SQLite on first open. Per table: only runs when the table is empty and the
 * JSON file exists. JSON files are never written — they stay on disk as a
 * backup until untracked in P6.
 */
export const importLegacyUserData = (
  db: DatabaseSync,
  dataDir: string,
): LegacyImportCounts => {
  const counts: LegacyImportCounts = { ...ZERO };

  if (tableCount(db, 'interests') === 0) {
    const data = readJson<{ wantToPlay?: string[] }>(
      path.join(dataDir, 'gamepass-interests.json'),
    );
    const titles = data?.wantToPlay ?? [];
    if (titles.length > 0) {
      const usedIds = new Set<string>();
      const seenTitles = new Set<string>();
      const stmt = db.prepare(
        'INSERT INTO interests (catalog_product_id, title) VALUES (?, ?)',
      );
      inTransaction(db, () => {
        for (const title of titles) {
          if (seenTitles.has(title)) continue;
          seenTitles.add(title);
          const result = stmt.run(
            uniqueManualId(db, 'interests', 'catalog_product_id', title, usedIds),
            title,
          );
          counts.interests += Number(result.changes);
        }
      });
    }
  }

  if (tableCount(db, 'owned_games') === 0) {
    const data = readJson<{ ownedGames?: string[] }>(
      path.join(dataDir, 'owned-xbox-games.json'),
    );
    const names = data?.ownedGames ?? [];
    if (names.length > 0) {
      const usedIds = new Set<string>();
      const seenNames = new Set<string>();
      const stmt = db.prepare(
        'INSERT INTO owned_games (canonical_id, name, platform) VALUES (?, ?, ?)',
      );
      inTransaction(db, () => {
        for (const name of names) {
          if (seenNames.has(name)) continue;
          seenNames.add(name);
          const result = stmt.run(
            uniqueManualId(db, 'owned_games', 'canonical_id', name, usedIds),
            name,
            'xbox',
          );
          counts.owned += Number(result.changes);
        }
      });
    }
  }

  if (tableCount(db, 'force_merge_rules') === 0) {
    const data = readJson<GameOverrides>(path.join(dataDir, 'overrides.json'));
    const rules = data?.forceMerge ?? [];
    if (rules.length > 0) {
      const stmt = db.prepare(
        'INSERT INTO force_merge_rules (match_ids, match_names, canonical_name, position) VALUES (?, ?, ?, ?)',
      );
      inTransaction(db, () => {
        rules.forEach((rule, index) => {
          const result = stmt.run(
            '[]',
            JSON.stringify(rule.games),
            rule.canonicalName ?? null,
            index + 1,
          );
          counts.forceMergeRules += Number(result.changes);
        });
      });
    }
  }

  if (tableCount(db, 'property_overrides') === 0) {
    const data = readJson<GameOverrides>(path.join(dataDir, 'overrides.json'));
    const overrides = data?.propertyOverrides ?? [];
    if (overrides.length > 0) {
      const stmt = db.prepare(
        'INSERT INTO property_overrides (match_name, properties) VALUES (?, ?)',
      );
      inTransaction(db, () => {
        for (const override of overrides) {
          const result = stmt.run(
            override.match,
            JSON.stringify(override.properties),
          );
          counts.propertyOverrides += Number(result.changes);
        }
      });
    }
  }

  return counts;
};

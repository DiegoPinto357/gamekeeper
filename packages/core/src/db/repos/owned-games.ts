import type { DatabaseSync } from 'node:sqlite';
import { manualId } from '../manual-id';

export type OwnedGame = {
  canonicalId: string;
  name: string;
  platform: string;
  notes: string | null;
};

const ROWS =
  'SELECT canonical_id AS canonicalId, name, platform, notes FROM owned_games';

export const listOwnedGames = (db: DatabaseSync): OwnedGame[] =>
  db
    .prepare(`${ROWS} ORDER BY name, canonical_id`)
    .all() as unknown as OwnedGame[];

export const listOwnedGameNames = (db: DatabaseSync): string[] =>
  (db.prepare('SELECT name FROM owned_games ORDER BY name, canonical_id').all() as {
    name: string;
  }[]).map(row => row.name);

const findById = (db: DatabaseSync, canonicalId: string): OwnedGame | undefined =>
  db.prepare(`${ROWS} WHERE canonical_id = ?`).get(canonicalId) as
    | OwnedGame
    | undefined;

const findByName = (db: DatabaseSync, name: string): OwnedGame | undefined =>
  db.prepare(`${ROWS} WHERE name = ?`).get(name) as OwnedGame | undefined;

const uniqueId = (db: DatabaseSync, base: string): string => {
  let id = base;
  let n = 2;
  while (findById(db, id)) {
    id = `${base}-${n++}`;
  }
  return id;
};

export const addOwnedGame = (
  db: DatabaseSync,
  input: {
    name: string;
    platform?: string;
    notes?: string | null;
    canonicalId?: string;
  },
): { added: boolean; game: OwnedGame } => {
  const name = input.name.trim();
  if (!name) throw new Error('name is required');

  if (input.canonicalId) {
    const existing = findById(db, input.canonicalId);
    if (existing) return { added: false, game: existing };
  }

  const existingByName = findByName(db, name);
  if (existingByName) return { added: false, game: existingByName };

  const canonicalId = input.canonicalId
    ? input.canonicalId
    : uniqueId(db, manualId(name));
  const platform = input.platform ?? 'xbox';
  const notes = input.notes ?? null;

  db.prepare(
    'INSERT INTO owned_games (canonical_id, name, platform, notes) VALUES (?, ?, ?, ?)',
  ).run(canonicalId, name, platform, notes);

  return {
    added: true,
    game: { canonicalId, name, platform, notes },
  };
};

export const removeOwnedGame = (db: DatabaseSync, canonicalId: string): boolean =>
  Number(
    db.prepare('DELETE FROM owned_games WHERE canonical_id = ?').run(canonicalId)
      .changes,
  ) > 0;

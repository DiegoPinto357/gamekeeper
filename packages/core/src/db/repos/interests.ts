import type { DatabaseSync } from 'node:sqlite';
import { manualId } from '../manual-id';

export type InterestEntry = {
  id: string;
  title: string;
};

const ENTRY_COLUMNS =
  'SELECT catalog_product_id AS id, title FROM interests';

export const listInterestEntries = (db: DatabaseSync): InterestEntry[] =>
  db
    .prepare(`${ENTRY_COLUMNS} ORDER BY rowid`)
    .all() as unknown as InterestEntry[];

export const listInterestTitles = (db: DatabaseSync): string[] =>
  listInterestEntries(db).map(entry => entry.title);

const findById = (db: DatabaseSync, id: string): InterestEntry | undefined =>
  db.prepare(`${ENTRY_COLUMNS} WHERE catalog_product_id = ?`).get(id) as
    | InterestEntry
    | undefined;

const findByTitle = (db: DatabaseSync, title: string): InterestEntry | undefined =>
  db.prepare(`${ENTRY_COLUMNS} WHERE title = ?`).get(title) as
    | InterestEntry
    | undefined;

const uniqueId = (
  db: DatabaseSync,
  base: string,
): string => {
  let id = base;
  let n = 2;
  while (findById(db, id)) {
    id = `${base}-${n++}`;
  }
  return id;
};

export const addInterest = (
  db: DatabaseSync,
  title: string,
  catalogProductId?: string,
): { added: boolean; entry: InterestEntry } => {
  const trimmed = title.trim();
  if (!trimmed) throw new Error('title is required');

  if (catalogProductId) {
    const existing = findById(db, catalogProductId);
    if (existing) return { added: false, entry: existing };
  }

  const existingByTitle = findByTitle(db, trimmed);
  if (existingByTitle) return { added: false, entry: existingByTitle };

  const id = catalogProductId
    ? catalogProductId
    : uniqueId(db, manualId(trimmed));

  db.prepare('INSERT INTO interests (catalog_product_id, title) VALUES (?, ?)').run(
    id,
    trimmed,
  );
  return { added: true, entry: { id, title: trimmed } };
};

export const removeInterestByTitle = (
  db: DatabaseSync,
  title: string,
): boolean =>
  Number(
    db.prepare('DELETE FROM interests WHERE title = ?').run(title).changes,
  ) > 0;

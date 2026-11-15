import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type Db } from '../connection';
import {
  addInterest,
  listInterestEntries,
  listInterestTitles,
  removeInterestByTitle,
} from './interests';

const dbs: Db[] = [];
const dirs: string[] = [];

const makeDb = (): Db => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-interests-'));
  dirs.push(dir);
  const db = openDb(path.join(dir, 'lib.db'));
  dbs.push(db);
  return db;
};

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('interests repo', () => {
  it('adds an interest with a generated manual id and lists entries in order', () => {
    const db = makeDb();

    const first = addInterest(db.raw, 'Starfield');
    const second = addInterest(db.raw, 'Hi-Fi RUSH');

    expect(first).toEqual({
      added: true,
      entry: { id: 'manual:starfield', title: 'Starfield' },
    });
    expect(second.entry.id).toBe('manual:hi-fi-rush');
    expect(listInterestTitles(db.raw)).toEqual(['Starfield', 'Hi-Fi RUSH']);
    expect(listInterestEntries(db.raw)).toEqual([
      { id: 'manual:starfield', title: 'Starfield' },
      { id: 'manual:hi-fi-rush', title: 'Hi-Fi RUSH' },
    ]);
  });

  it('stores a provided catalog product id verbatim', () => {
    const db = makeDb();

    const result = addInterest(db.raw, 'Starfield', '9NBLGGH4R4NH');

    expect(result).toEqual({
      added: true,
      entry: { id: '9NBLGGH4R4NH', title: 'Starfield' },
    });
  });

  it('is a no-op for a duplicate title', () => {
    const db = makeDb();
    addInterest(db.raw, 'Starfield');

    const again = addInterest(db.raw, 'Starfield');

    expect(again.added).toBe(false);
    expect(listInterestTitles(db.raw)).toEqual(['Starfield']);
  });

  it('returns the existing row when the catalog id is already listed', () => {
    const db = makeDb();
    addInterest(db.raw, 'Starfield', '9NBLGGH4R4NH');

    const again = addInterest(db.raw, 'Starfield (other display)', '9NBLGGH4R4NH');

    expect(again.added).toBe(false);
    expect(again.entry).toEqual({ id: '9NBLGGH4R4NH', title: 'Starfield' });
    expect(listInterestEntries(db.raw)).toHaveLength(1);
  });

  it('suffixes manual id collisions across different titles', () => {
    const db = makeDb();
    addInterest(db.raw, 'Hollow Knight');
    addInterest(db.raw, 'Hollow_Knight');

    const ids = listInterestEntries(db.raw).map(e => e.id);
    expect(ids).toEqual(['manual:hollow-knight', 'manual:hollow-knight-2']);
  });

  it('rejects an empty title', () => {
    const db = makeDb();

    expect(() => addInterest(db.raw, '   ')).toThrow('title is required');
  });

  it('removes by title and reports whether a row was deleted', () => {
    const db = makeDb();
    addInterest(db.raw, 'Starfield');

    expect(removeInterestByTitle(db.raw, 'Starfield')).toBe(true);
    expect(removeInterestByTitle(db.raw, 'Starfield')).toBe(false);
    expect(listInterestTitles(db.raw)).toEqual([]);
  });
});

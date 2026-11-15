import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type Db } from './connection';
import { importLegacyUserData } from './legacy-import';
import { manualId } from './manual-id';

const tmpDir = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-legacy-'));

const writeJson = (dir: string, name: string, data: unknown): void => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2));
};

const countRows = (db: Db, table: string): number => {
  const row = db.raw.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as {
    c: number;
  };
  return row.c;
};

const dirs: string[] = [];
const dbs: Db[] = [];

const makeDb = (dir: string): Db => {
  const db = openDb(path.join(dir, 'gamekeeper.db'));
  dbs.push(db);
  return db;
};

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('manualId', () => {
  it('slugifies a title into a manual: id', () => {
    expect(manualId('Halo Infinite')).toBe('manual:halo-infinite');
    expect(manualId("Assassin's Creed® Mirage")).toBe(
      'manual:assassin-s-creed-mirage',
    );
  });

  it('falls back to untitled when nothing alphanumeric remains', () => {
    expect(manualId('!!!')).toBe('manual:untitled');
  });
});

describe('importLegacyUserData', () => {
  it('imports interests, owned games, and overrides from a data dir', () => {
    const dir = tmpDir();
    dirs.push(dir);
    const db = makeDb(dir);
    writeJson(dir, 'gamepass-interests.json', {
      wantToPlay: ['Starfield', 'Hi-Fi RUSH'],
      _instructions: 'ignored',
    });
    writeJson(dir, 'owned-xbox-games.json', {
      ownedGames: ['Halo Infinite'],
      _instructions: 'ignored',
    });
    writeJson(dir, 'overrides.json', {
      $schema: '../src/types/overrides.schema.json',
      forceMerge: [
        { games: ['Disco Elysium', 'Disco Elysium - The Final Cut'], canonicalName: 'Disco Elysium' },
        { games: ['Kerbal Space Program', 'Kerbal Space Program Enhanced Edition'] },
      ],
      propertyOverrides: [{ match: 'FUEL', properties: { steamAppId: 40100 } }],
    });

    const counts = importLegacyUserData(db.raw, dir);

    expect(counts).toEqual({
      interests: 2,
      owned: 1,
      forceMergeRules: 2,
      propertyOverrides: 1,
    });

    const interests = db.raw
      .prepare('SELECT catalog_product_id, title FROM interests ORDER BY title')
      .all() as { catalog_product_id: string; title: string }[];
    expect(interests).toEqual([
      { catalog_product_id: 'manual:hi-fi-rush', title: 'Hi-Fi RUSH' },
      { catalog_product_id: 'manual:starfield', title: 'Starfield' },
    ]);

    const owned = db.raw
      .prepare('SELECT canonical_id, name, platform FROM owned_games')
      .all() as { canonical_id: string; name: string; platform: string }[];
    expect(owned).toEqual([
      { canonical_id: 'manual:halo-infinite', name: 'Halo Infinite', platform: 'xbox' },
    ]);

    const rules = db.raw
      .prepare(
        'SELECT match_ids, match_names, canonical_name, position FROM force_merge_rules ORDER BY position',
      )
      .all() as {
      match_ids: string;
      match_names: string;
      canonical_name: string | null;
      position: number;
    }[];
    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({
      match_ids: '[]',
      match_names: JSON.stringify([
        'Disco Elysium',
        'Disco Elysium - The Final Cut',
      ]),
      canonical_name: 'Disco Elysium',
      position: 1,
    });
    expect(rules[1].canonical_name).toBeNull();
    expect(JSON.parse(rules[1].match_names)).toEqual([
      'Kerbal Space Program',
      'Kerbal Space Program Enhanced Edition',
    ]);

    const props = db.raw
      .prepare('SELECT match_name, match_id, properties FROM property_overrides')
      .all() as {
      match_name: string | null;
      match_id: string | null;
      properties: string;
    }[];
    expect(props).toEqual([
      { match_name: 'FUEL', match_id: null, properties: '{"steamAppId":40100}' },
    ]);
  });

  it('is idempotent: a second import reports zeros and changes nothing', () => {
    const dir = tmpDir();
    dirs.push(dir);
    const db = makeDb(dir);
    writeJson(dir, 'gamepass-interests.json', { wantToPlay: ['Starfield'] });
    writeJson(dir, 'owned-xbox-games.json', { ownedGames: ['Halo Infinite'] });

    const first = importLegacyUserData(db.raw, dir);
    const second = importLegacyUserData(db.raw, dir);

    expect(first.interests).toBe(1);
    expect(first.owned).toBe(1);
    expect(second).toEqual({
      interests: 0,
      owned: 0,
      forceMergeRules: 0,
      propertyOverrides: 0,
    });
    expect(countRows(db, 'interests')).toBe(1);
    expect(countRows(db, 'owned_games')).toBe(1);
  });

  it('imports only the tables whose JSON files exist', () => {
    const dir = tmpDir();
    dirs.push(dir);
    const db = makeDb(dir);
    writeJson(dir, 'owned-xbox-games.json', { ownedGames: ['Alan Wake 2'] });

    const counts = importLegacyUserData(db.raw, dir);

    expect(counts).toEqual({
      interests: 0,
      owned: 1,
      forceMergeRules: 0,
      propertyOverrides: 0,
    });
    expect(countRows(db, 'interests')).toBe(0);
    expect(countRows(db, 'force_merge_rules')).toBe(0);
  });

  it('reports zeros when no legacy files exist', () => {
    const dir = tmpDir();
    dirs.push(dir);
    const db = makeDb(dir);

    expect(importLegacyUserData(db.raw, dir)).toEqual({
      interests: 0,
      owned: 0,
      forceMergeRules: 0,
      propertyOverrides: 0,
    });
  });

  it('skips malformed JSON files without throwing', () => {
    const dir = tmpDir();
    dirs.push(dir);
    const db = makeDb(dir);
    fs.writeFileSync(path.join(dir, 'gamepass-interests.json'), '{not json');
    writeJson(dir, 'owned-xbox-games.json', { ownedGames: ['Halo Infinite'] });

    const counts = importLegacyUserData(db.raw, dir);

    expect(counts.interests).toBe(0);
    expect(counts.owned).toBe(1);
  });

  it('deduplicates repeated titles and suffixes slug collisions', () => {
    const dir = tmpDir();
    dirs.push(dir);
    const db = makeDb(dir);
    writeJson(dir, 'gamepass-interests.json', {
      wantToPlay: ['Hollow Knight', 'Hollow Knight', 'Hollow_Knight'],
    });

    const counts = importLegacyUserData(db.raw, dir);

    expect(counts.interests).toBe(2);
    const rows = db.raw
      .prepare('SELECT catalog_product_id, title FROM interests ORDER BY title')
      .all() as { catalog_product_id: string; title: string }[];
    expect(rows.map(r => r.catalog_product_id)).toEqual([
      'manual:hollow-knight',
      'manual:hollow-knight-2',
    ]);
  });
});

describe('openDb legacy import hook', () => {
  it('auto-imports JSON files that sit beside the db file', () => {
    const dir = tmpDir();
    dirs.push(dir);
    writeJson(dir, 'gamepass-interests.json', { wantToPlay: ['Starfield'] });
    writeJson(dir, 'owned-xbox-games.json', { ownedGames: ['Halo Infinite'] });
    writeJson(dir, 'overrides.json', {
      forceMerge: [{ games: ['A', 'B'], canonicalName: 'A' }],
    });

    const db = makeDb(dir);

    expect(countRows(db, 'interests')).toBe(1);
    expect(countRows(db, 'owned_games')).toBe(1);
    expect(countRows(db, 'force_merge_rules')).toBe(1);
  });

  it('leaves tables empty when no JSON files sit beside the db file', () => {
    const dir = tmpDir();
    dirs.push(dir);

    const db = makeDb(dir);

    expect(countRows(db, 'interests')).toBe(0);
    expect(countRows(db, 'owned_games')).toBe(0);
    expect(countRows(db, 'force_merge_rules')).toBe(0);
    expect(countRows(db, 'property_overrides')).toBe(0);
  });

  it('does not touch the legacy JSON files', () => {
    const dir = tmpDir();
    dirs.push(dir);
    writeJson(dir, 'gamepass-interests.json', { wantToPlay: ['Starfield'] });
    const file = path.join(dir, 'gamepass-interests.json');
    const before = fs.readFileSync(file, 'utf-8');

    const db = makeDb(dir);

    expect(fs.readFileSync(file, 'utf-8')).toBe(before);
    expect(countRows(db, 'interests')).toBe(1);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type Db } from '../connection';
import {
  addForceMergeRule,
  deleteForceMergeRule,
  listForceMergeRules,
  loadGameOverrides,
  updateForceMergeRule,
  UnknownForceMergeRuleError,
} from './overrides';

const dbs: Db[] = [];
const dirs: string[] = [];

const makeDb = (): Db => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-overrides-'));
  dirs.push(dir);
  const db = openDb(path.join(dir, 'lib.db'));
  dbs.push(db);
  return db;
};

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('overrides repo', () => {
  it('returns empty overrides for empty tables', () => {
    const db = makeDb();

    expect(loadGameOverrides(db.raw)).toEqual({
      forceMerge: [],
      propertyOverrides: [],
    });
  });

  it('maps force-merge rules in position order and omits null canonical names', () => {
    const db = makeDb();
    db.raw
      .prepare(
        'INSERT INTO force_merge_rules (match_ids, match_names, canonical_name, position) VALUES (?, ?, ?, ?)',
      )
      .run('[]', JSON.stringify(['B1', 'B2']), 'B', 2);
    db.raw
      .prepare(
        'INSERT INTO force_merge_rules (match_ids, match_names, canonical_name, position) VALUES (?, ?, ?, ?)',
      )
      .run('[]', JSON.stringify(['A1', 'A2']), null, 1);

    const overrides = loadGameOverrides(db.raw);

    expect(overrides.forceMerge).toEqual([
      { games: ['A1', 'A2'] },
      { games: ['B1', 'B2'], canonicalName: 'B' },
    ]);
  });

  it('maps property overrides, preferring match_name over match_id', () => {
    const db = makeDb();
    db.raw
      .prepare(
        'INSERT INTO property_overrides (match_id, match_name, properties) VALUES (?, ?, ?)',
      )
      .run(null, 'FUEL', JSON.stringify({ steamAppId: 40100 }));
    db.raw
      .prepare(
        'INSERT INTO property_overrides (match_id, match_name, properties) VALUES (?, ?, ?)',
      )
      .run('steam:1', null, JSON.stringify({ proton: 'gold' }));

    const overrides = loadGameOverrides(db.raw);

    expect(overrides.propertyOverrides).toEqual([
      { match: 'FUEL', properties: { steamAppId: 40100 } },
      { match: 'steam:1', properties: { proton: 'gold' } },
    ]);
  });
});

describe('force-merge rule CRUD', () => {
  it('lists rules in position order with ids', () => {
    const db = makeDb();
    addForceMergeRule(db.raw, { games: ['B1', 'B2'], canonicalName: 'B' });
    addForceMergeRule(db.raw, { games: ['A1', 'A2'] });

    const rules = listForceMergeRules(db.raw);

    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({ id: expect.any(Number), games: ['B1', 'B2'], canonicalName: 'B' });
    expect(rules[1]).toEqual({ id: expect.any(Number), games: ['A1', 'A2'] });
    expect(rules[1].canonicalName).toBeUndefined();
    expect(rules[0].id).not.toBe(rules[1].id);
  });

  it('appends new rules after existing positions', () => {
    const db = makeDb();
    db.raw
      .prepare(
        'INSERT INTO force_merge_rules (match_names, canonical_name, position) VALUES (?, ?, ?)',
      )
      .run(JSON.stringify(['Old1', 'Old2']), 'Old', 5);

    const added = addForceMergeRule(db.raw, { games: ['New1', 'New2'] });
    const rules = listForceMergeRules(db.raw);

    expect(rules.map(r => r.games[0])).toEqual(['Old1', 'New1']);
    expect(added.id).toBeGreaterThan(0);
  });

  it('updates games and canonical name by id', () => {
    const db = makeDb();
    const rule = addForceMergeRule(db.raw, { games: ['X', 'Y'] });

    const updated = updateForceMergeRule(db.raw, rule.id, {
      games: ['X', 'Y', 'Z'],
      canonicalName: 'XYZ',
    });

    expect(updated).toEqual({ id: rule.id, games: ['X', 'Y', 'Z'], canonicalName: 'XYZ' });
    expect(listForceMergeRules(db.raw)).toEqual([updated]);
  });

  it('clears canonical name when omitted on update', () => {
    const db = makeDb();
    const rule = addForceMergeRule(db.raw, { games: ['X', 'Y'], canonicalName: 'XY' });

    const updated = updateForceMergeRule(db.raw, rule.id, { games: ['X', 'Y'] });

    expect(updated.canonicalName).toBeUndefined();
    expect(loadGameOverrides(db.raw).forceMerge).toEqual([{ games: ['X', 'Y'] }]);
  });

  it('deletes a rule by id', () => {
    const db = makeDb();
    const a = addForceMergeRule(db.raw, { games: ['A'] });
    addForceMergeRule(db.raw, { games: ['B'] });

    expect(deleteForceMergeRule(db.raw, a.id)).toBe(true);
    expect(listForceMergeRules(db.raw).map(r => r.games)).toEqual([['B']]);
    expect(deleteForceMergeRule(db.raw, a.id)).toBe(false);
  });

  it('rejects an empty games list', () => {
    const db = makeDb();

    expect(() => addForceMergeRule(db.raw, { games: [] })).toThrow(
      'games must be a non-empty list',
    );
    expect(() =>
      addForceMergeRule(db.raw, { games: ['  '] }),
    ).toThrow('games must be a non-empty list');
  });

  it('throws UnknownForceMergeRuleError for missing ids', () => {
    const db = makeDb();

    expect(() => updateForceMergeRule(db.raw, 999, { games: ['X'] })).toThrow(
      UnknownForceMergeRuleError,
    );
    expect(deleteForceMergeRule(db.raw, 999)).toBe(false);
  });

  it('keeps loadGameOverrides in sync after add and delete', () => {
    const db = makeDb();
    const rule = addForceMergeRule(db.raw, { games: ['Halo', 'Halo: CE'] });

    expect(loadGameOverrides(db.raw).forceMerge).toEqual([
      { games: ['Halo', 'Halo: CE'] },
    ]);

    deleteForceMergeRule(db.raw, rule.id);
    expect(loadGameOverrides(db.raw).forceMerge).toEqual([]);
  });
});

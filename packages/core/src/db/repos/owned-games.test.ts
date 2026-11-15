import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type Db } from '../connection';
import {
  addOwnedGame,
  listOwnedGameNames,
  listOwnedGames,
  removeOwnedGame,
} from './owned-games';

const dbs: Db[] = [];
const dirs: string[] = [];

const makeDb = (): Db => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-owned-'));
  dirs.push(dir);
  const db = openDb(path.join(dir, 'lib.db'));
  dbs.push(db);
  return db;
};

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('owned-games repo', () => {
  it('adds a game with platform xbox by default and lists ordered by name', () => {
    const db = makeDb();

    const first = addOwnedGame(db.raw, { name: 'Halo Infinite' });
    const second = addOwnedGame(db.raw, { name: 'Alan Wake 2' });

    expect(first).toEqual({
      added: true,
      game: {
        canonicalId: 'manual:halo-infinite',
        name: 'Halo Infinite',
        platform: 'xbox',
        notes: null,
      },
    });
    expect(second.game.canonicalId).toBe('manual:alan-wake-2');
    expect(listOwnedGameNames(db.raw)).toEqual(['Alan Wake 2', 'Halo Infinite']);
    expect(listOwnedGames(db.raw)).toHaveLength(2);
  });

  it('keeps explicit platform and notes', () => {
    const db = makeDb();

    const result = addOwnedGame(db.raw, {
      name: 'Zelda',
      platform: 'switch',
      notes: 'borrowed',
    });

    expect(result.game).toEqual({
      canonicalId: 'manual:zelda',
      name: 'Zelda',
      platform: 'switch',
      notes: 'borrowed',
    });
  });

  it('uses a provided canonical id when given', () => {
    const db = makeDb();

    const result = addOwnedGame(db.raw, {
      name: 'Halo Infinite',
      canonicalId: 'xbox:halo-infinite',
    });

    expect(result.game.canonicalId).toBe('xbox:halo-infinite');
  });

  it('is a no-op for a duplicate name', () => {
    const db = makeDb();
    addOwnedGame(db.raw, { name: 'Halo Infinite' });

    const again = addOwnedGame(db.raw, { name: 'Halo Infinite' });

    expect(again.added).toBe(false);
    expect(listOwnedGames(db.raw)).toHaveLength(1);
  });

  it('suffixes manual id collisions across different names', () => {
    const db = makeDb();
    addOwnedGame(db.raw, { name: 'Hollow Knight' });
    addOwnedGame(db.raw, { name: 'Hollow_Knight' });

    const ids = listOwnedGames(db.raw).map(g => g.canonicalId);
    expect(ids).toEqual(['manual:hollow-knight', 'manual:hollow-knight-2']);
  });

  it('rejects an empty name', () => {
    const db = makeDb();

    expect(() => addOwnedGame(db.raw, { name: '  ' })).toThrow('name is required');
  });

  it('removes by canonical id and reports whether a row was deleted', () => {
    const db = makeDb();
    const { game } = addOwnedGame(db.raw, { name: 'Halo Infinite' });

    expect(removeOwnedGame(db.raw, game.canonicalId)).toBe(true);
    expect(removeOwnedGame(db.raw, game.canonicalId)).toBe(false);
    expect(listOwnedGames(db.raw)).toEqual([]);
  });
});

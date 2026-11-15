import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, addOwnedGame, type Db } from '@gamekeeper/core';
import { buildApp } from '../app';

type OwnedGame = {
  canonicalId: string;
  name: string;
  platform: string;
  notes: string | null;
};

const getOwned = async (
  app: FastifyInstance,
): Promise<{ ownedGames: OwnedGame[] }> => {
  const res = await app.inject({ method: 'GET', url: '/api/owned-games' });
  expect(res.statusCode).toBe(200);
  return res.json() as { ownedGames: OwnedGame[] };
};

describe('owned-games routes', () => {
  let app: FastifyInstance;
  let seedDb: Db;
  let dbPath: string;
  let dataDir: string;

  beforeEach(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-owned-'));
    dataDir = path.join(root, 'data');
    dbPath = path.join(dataDir, 'gamekeeper.db');
    fs.mkdirSync(dataDir, { recursive: true });

    seedDb = openDb(dbPath);
    app = buildApp({
      dataDir,
      cacheDir: path.join(root, 'cache'),
      dbPath,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    seedDb.close();
    fs.rmSync(path.dirname(dataDir), { recursive: true, force: true });
  });

  it('returns an empty list on a fresh database', async () => {
    expect((await getOwned(app)).ownedGames).toEqual([]);
  });

  it('adds a game with platform xbox by default', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/owned-games',
      payload: { name: 'Halo Infinite' },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { ownedGames: OwnedGame[] }).ownedGames).toEqual([
      {
        canonicalId: 'manual:halo-infinite',
        name: 'Halo Infinite',
        platform: 'xbox',
        notes: null,
      },
    ]);
  });

  it('accepts platform, notes, and an explicit canonical id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/owned-games',
      payload: {
        name: 'Halo Infinite',
        platform: 'xbox',
        notes: 'Game Pass trial',
        canonicalId: 'xbox:halo-infinite',
      },
    });

    expect((res.json() as { ownedGames: OwnedGame[] }).ownedGames[0]).toEqual({
      canonicalId: 'xbox:halo-infinite',
      name: 'Halo Infinite',
      platform: 'xbox',
      notes: 'Game Pass trial',
    });
  });

  it('rejects a missing name with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/owned-games',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'name is required' });
  });

  it('ignores duplicate names', async () => {
    await app.inject({ method: 'POST', url: '/api/owned-games', payload: { name: 'Halo Infinite' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/owned-games',
      payload: { name: 'Halo Infinite' },
    });

    expect((res.json() as { ownedGames: OwnedGame[] }).ownedGames).toHaveLength(1);
  });

  it('deletes by canonical id and survives a second delete', async () => {
    addOwnedGame(seedDb.raw, { name: 'Halo Infinite' });

    const first = await app.inject({
      method: 'DELETE',
      url: `/api/owned-games/${encodeURIComponent('manual:halo-infinite')}`,
    });
    expect((first.json() as { ownedGames: OwnedGame[] }).ownedGames).toEqual([]);

    const second = await app.inject({
      method: 'DELETE',
      url: `/api/owned-games/${encodeURIComponent('manual:halo-infinite')}`,
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { ownedGames: OwnedGame[] }).ownedGames).toEqual([]);
  });

  it('lists games ordered by name after multiple adds', async () => {
    await app.inject({ method: 'POST', url: '/api/owned-games', payload: { name: 'Halo Infinite' } });
    await app.inject({ method: 'POST', url: '/api/owned-games', payload: { name: 'Alan Wake 2' } });

    const names = (await getOwned(app)).ownedGames.map(g => g.name);

    expect(names).toEqual(['Alan Wake 2', 'Halo Infinite']);
  });
});

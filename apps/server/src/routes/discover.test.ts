import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, upsertGames, rebuildGamesFts, type Db } from '@gamekeeper/core';
import type { DiscoverResponse, DiscoverFacets } from '@gamekeeper/shared';
import { buildApp } from '../app';

const base = {
  primarySource: 'steam' as const,
  ownedSources: ['steam' as const],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('discover routes', () => {
  let app: FastifyInstance;
  let seedDb: Db;

  beforeEach(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-discover-'));
    const dataDir = path.join(root, 'data');
    const dbPath = path.join(dataDir, 'gamekeeper.db');
    fs.mkdirSync(dataDir, { recursive: true });

    seedDb = openDb(dbPath);
    upsertGames(seedDb.raw, [
      {
        ...base,
        canonicalId: 'hades-ii',
        name: 'Hades II',
        genres: ['Action', 'Roguelike'],
        playtimeHours: 12.5,
        releaseDate: new Date('2024-05-06T00:00:00.000Z'),
        proton: { tier: 'gold', steamDeck: 'verified' },
      },
      {
        ...base,
        canonicalId: 'celeste',
        name: 'Celeste',
        primarySource: 'gog',
        ownedSources: ['gog', 'steam'],
        genres: ['Platformer'],
        proton: { tier: 'platinum', steamDeck: 'playable' },
      },
    ] as Parameters<typeof upsertGames>[1]);
    seedDb.raw
      .prepare(
        `INSERT INTO game_status (canonical_id, status, position)
         VALUES ('hades-ii', 'playing', NULL)`,
      )
      .run();
    rebuildGamesFts(seedDb.raw);

    app = buildApp({ dataDir, cacheDir: path.join(root, 'cache'), dbPath });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    seedDb.close();
  });

  const getGames = async (query = ''): Promise<DiscoverResponse> => {
    const res = await app.inject({ method: 'GET', url: `/api/games${query}` });
    expect(res.statusCode).toBe(200);
    return res.json() as DiscoverResponse;
  };

  const getFacets = async (query = ''): Promise<DiscoverFacets> => {
    const res = await app.inject({ method: 'GET', url: `/api/facets${query}` });
    expect(res.statusCode).toBe(200);
    return res.json() as DiscoverFacets;
  };

  it('GET /api/games returns all games ordered by name, status defaulted', async () => {
    const body = await getGames();
    expect(body.total).toBe(2);
    expect(body.games.map((g) => g.name)).toEqual(['Celeste', 'Hades II']);
    expect(body.games[0]).toMatchObject({
      canonicalId: 'celeste',
      status: 'backlog',
      deck: 'playable',
      protonTier: 'platinum',
      genres: ['Platformer'],
      ownedSources: ['gog', 'steam'],
    });
  });

  it('GET /api/games applies filter params', async () => {
    const byGenre = await getGames('?genre=Action');
    expect(byGenre.games.map((g) => g.name)).toEqual(['Hades II']);

    const byStatusAndSource = await getGames('?status=playing&source=gog');
    expect(byStatusAndSource.games).toEqual([]);

    const byDeck = await getGames('?deck=playable');
    expect(byDeck.games.map((g) => g.name)).toEqual(['Celeste']);

    const byQ = await getGames('?q=celes');
    expect(byQ.games.map((g) => g.name)).toEqual(['Celeste']);
  });

  it('GET /api/games ignores invalid params instead of erroring', async () => {
    const body = await getGames('?deck=quantum&playtimeMin=abc');
    expect(body.total).toBe(2);
  });

  it('GET /api/facets counts every dimension', async () => {
    const facets = await getFacets();
    expect(facets.genres).toEqual([
      { value: 'Action', count: 1 },
      { value: 'Platformer', count: 1 },
      { value: 'Roguelike', count: 1 },
    ]);
    expect(facets.sources).toEqual([
      { value: 'steam', count: 2 },
      { value: 'gog', count: 1 },
    ]);
    expect(facets.statuses).toEqual([
      { value: 'backlog', count: 1 },
      { value: 'playing', count: 1 },
    ]);
    expect(facets.years).toEqual([{ value: 2024, count: 1 }]);
  });

  it('GET /api/facets is contextual: each dimension against the other filters', async () => {
    const facets = await getFacets('?status=playing');
    expect(facets.genres).toEqual([
      { value: 'Action', count: 1 },
      { value: 'Roguelike', count: 1 },
    ]);
    // own dimension still shows the full picture
    expect(facets.statuses).toEqual([
      { value: 'backlog', count: 1 },
      { value: 'playing', count: 1 },
    ]);
  });
});

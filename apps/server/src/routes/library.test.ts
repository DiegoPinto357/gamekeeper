import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, upsertGames, type Db } from '@gamekeeper/core';
import type { LibraryResponse, GameStatusResult } from '@gamekeeper/shared';
import { buildApp } from '../app';

const makeGame = (canonicalId: string, name: string) => ({
  canonicalId,
  name,
  primarySource: 'steam' as const,
  ownedSources: ['steam' as const],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('library routes', () => {
  let app: FastifyInstance;
  let seedDb: Db;
  let dbPath: string;
  let dataDir: string;

  beforeEach(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-library-'));
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
  });

  const getLibrary = async (): Promise<LibraryResponse> => {
    const res = await app.inject({ method: 'GET', url: '/api/library' });
    expect(res.statusCode).toBe(200);
    return res.json() as LibraryResponse;
  };

  const patchStatus = (
    id: string,
    payload: Record<string, unknown>,
  ) =>
    app.inject({
      method: 'PATCH',
      url: `/api/games/${encodeURIComponent(id)}/status`,
      payload,
    });

  it('GET /api/library returns statuses in position order and library games', async () => {
    upsertGames(seedDb.raw, [
      makeGame('steam:1', 'Alpha'),
      makeGame('steam:2', 'Beta'),
    ]);

    const library = await getLibrary();
    expect(library.statuses.map(s => s.key)).toEqual([
      'backlog',
      'want_to_play',
      'queued_to_play',
      'trying',
      'recurrent',
      'playing',
      'paused',
      'completed',
      'dropped',
    ]);
    expect(library.statuses[0]).toMatchObject({ label: 'Backlog', position: 0 });
    expect(library.games).toHaveLength(2);
    expect(library.games[0]).toMatchObject({
      canonicalId: expect.any(String),
      name: expect.any(String),
      primarySource: 'steam',
      ownedSources: ['steam'],
      status: null,
      position: null,
    });
  });

  it('PATCH /api/games/:id/status moves the game and shows it in the new column on refetch', async () => {
    upsertGames(seedDb.raw, [
      makeGame('steam:1', 'Alpha'),
      makeGame('steam:2', 'Beta'),
    ]);

    const res = await patchStatus('steam:2', { status: 'playing' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as GameStatusResult;
    expect(body).toEqual({
      canonicalId: 'steam:2',
      status: 'playing',
      position: 1,
    });

    const library = await getLibrary();
    const moved = library.games.find(g => g.canonicalId === 'steam:2');
    const untouched = library.games.find(g => g.canonicalId === 'steam:1');
    expect(moved).toMatchObject({ status: 'playing', position: 1 });
    // moving out of default Backlog materialized the remaining no-status games
    expect(untouched).toMatchObject({ status: 'backlog', position: 1 });
  });

  it('PATCH respects neighbor ids (midpoint between beforeId and afterId)', async () => {
    upsertGames(seedDb.raw, [
      makeGame('steam:1', 'Alpha'),
      makeGame('steam:2', 'Beta'),
      makeGame('steam:3', 'Gamma'),
    ]);
    seedDb.raw
      .prepare(
        'INSERT INTO game_status (canonical_id, status, position) VALUES (?, ?, ?)',
      )
      .run('steam:1', 'playing', 1);
    seedDb.raw
      .prepare(
        'INSERT INTO game_status (canonical_id, status, position) VALUES (?, ?, ?)',
      )
      .run('steam:2', 'playing', 2);

    const res = await patchStatus('steam:3', {
      status: 'playing',
      beforeId: 'steam:1',
      afterId: 'steam:2',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'playing', position: 1.5 });

    const library = await getLibrary();
    expect(library.games.find(g => g.canonicalId === 'steam:3')).toMatchObject({
      status: 'playing',
      position: 1.5,
    });
  });

  it('re-PATCH same status is idempotent and recomputes position', async () => {
    upsertGames(seedDb.raw, [
      makeGame('steam:1', 'Alpha'),
      makeGame('steam:2', 'Beta'),
      makeGame('steam:3', 'Gamma'),
    ]);

    const first = await patchStatus('steam:3', { status: 'queued_to_play' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ status: 'queued_to_play', position: 1 });

    const second = await patchStatus('steam:3', {
      status: 'queued_to_play',
      beforeId: 'steam:1',
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ status: 'queued_to_play', position: 2 });
  });

  it('PATCH unknown game returns 404', async () => {
    const res = await patchStatus('steam:999', { status: 'playing' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: expect.any(String) });
  });

  it('PATCH unknown status returns 400', async () => {
    upsertGames(seedDb.raw, [makeGame('steam:1', 'Alpha')]);

    const res = await patchStatus('steam:1', { status: 'not_a_status' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: expect.any(String) });
  });

  it('PATCH without a status body returns 400', async () => {
    upsertGames(seedDb.raw, [makeGame('steam:1', 'Alpha')]);

    const res = await patchStatus('steam:1', {});
    expect(res.statusCode).toBe(400);
  });

  it('PATCH bumps updated_at via the trigger (not set by the repo)', async () => {
    upsertGames(seedDb.raw, [makeGame('steam:1', 'Alpha')]);
    seedDb.raw
      .prepare(
        'INSERT INTO game_status (canonical_id, status, position) VALUES (?, ?, ?)',
      )
      .run('steam:1', 'playing', 1);
    const before = seedDb.raw
      .prepare('SELECT updated_at FROM game_status WHERE canonical_id = ?')
      .get('steam:1') as { updated_at: string };

    await sleep(5);
    const res = await patchStatus('steam:1', { status: 'paused' });
    expect(res.statusCode).toBe(200);

    const after = seedDb.raw
      .prepare('SELECT updated_at FROM game_status WHERE canonical_id = ?')
      .get('steam:1') as { updated_at: string };
    expect(after.updated_at).toBeTruthy();
    expect(after.updated_at > before.updated_at).toBe(true);
  });
});

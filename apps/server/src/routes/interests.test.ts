import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, addInterest, type Db } from '@gamekeeper/core';
import type { InterestsResponse } from '@gamekeeper/shared';
import { buildApp } from '../app';

describe('interest routes', () => {
  let app: FastifyInstance;
  let seedDb: Db;
  let dbPath: string;
  let dataDir: string;

  beforeEach(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-interests-'));
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

  const getInterests = async (): Promise<InterestsResponse> => {
    const res = await app.inject({ method: 'GET', url: '/api/interests' });
    expect(res.statusCode).toBe(200);
    return res.json() as InterestsResponse;
  };

  it('returns an empty list on a fresh database', async () => {
    expect((await getInterests()).interests).toEqual([]);
  });

  it('adds an interest with a generated manual id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/interests',
      payload: { name: 'Starfield' },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as InterestsResponse).interests).toEqual([
      { id: 'manual:starfield', title: 'Starfield' },
    ]);
  });

  it('stores a provided catalog product id verbatim', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/interests',
      payload: { name: 'Starfield', id: '9NBLGGH4R4NH' },
    });

    expect((res.json() as InterestsResponse).interests).toEqual([
      { id: '9NBLGGH4R4NH', title: 'Starfield' },
    ]);
  });

  it('rejects a missing name with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/interests',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'name is required' });
  });

  it('ignores duplicate titles', async () => {
    await app.inject({ method: 'POST', url: '/api/interests', payload: { name: 'Starfield' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/interests',
      payload: { name: 'Starfield' },
    });

    expect((res.json() as InterestsResponse).interests).toHaveLength(1);
  });

  it('deletes by title and survives a second delete', async () => {
    addInterest(seedDb.raw, 'Starfield');

    const first = await app.inject({
      method: 'DELETE',
      url: `/api/interests/${encodeURIComponent('Starfield')}`,
    });
    expect((first.json() as InterestsResponse).interests).toEqual([]);

    const second = await app.inject({
      method: 'DELETE',
      url: `/api/interests/${encodeURIComponent('Starfield')}`,
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as InterestsResponse).interests).toEqual([]);
  });

  it('round-trips entries through GET after POST', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/interests',
      payload: { name: 'Hi-Fi RUSH', id: '9NBL8M9W1234' },
    });
    await app.inject({ method: 'POST', url: '/api/interests', payload: { name: 'TUNIC' } });

    const interests = (await getInterests()).interests;

    expect(interests).toEqual([
      { id: '9NBL8M9W1234', title: 'Hi-Fi RUSH' },
      { id: 'manual:tunic', title: 'TUNIC' },
    ]);
  });
});

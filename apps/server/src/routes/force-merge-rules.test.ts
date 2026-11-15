import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, type Db, loadGameOverrides } from '@gamekeeper/core';
import type { ForceMergeRulesResponse } from '@gamekeeper/shared';
import { buildApp } from '../app';

describe('force-merge rules routes', () => {
  let app: FastifyInstance;
  let seedDb: Db;
  let root: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-fm-rules-'));
    const dataDir = path.join(root, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    seedDb = openDb(path.join(dataDir, 'gamekeeper.db'));
    app = buildApp({
      dataDir,
      cacheDir: path.join(root, 'cache'),
      dbPath: path.join(dataDir, 'gamekeeper.db'),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    seedDb.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const getRules = async (): Promise<ForceMergeRulesResponse> => {
    const res = await app.inject({ method: 'GET', url: '/api/force-merge-rules' });
    expect(res.statusCode).toBe(200);
    return res.json() as ForceMergeRulesResponse;
  };

  it('returns an empty list on a fresh database', async () => {
    expect((await getRules()).rules).toEqual([]);
  });

  it('creates a rule and returns the full list', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/force-merge-rules',
      payload: { games: ['Halo', 'Halo: CE'], canonicalName: 'Halo' },
    });

    expect(res.statusCode).toBe(200);
    const { rules } = res.json() as ForceMergeRulesResponse;
    expect(rules).toEqual([
      { id: expect.any(Number), games: ['Halo', 'Halo: CE'], canonicalName: 'Halo' },
    ]);
    expect((await getRules()).rules).toEqual(rules);
  });

  it('updates a rule by id', async () => {
    const { rules } = await (async () => {
      await app.inject({
        method: 'POST',
        url: '/api/force-merge-rules',
        payload: { games: ['A', 'B'] },
      });
      return getRules();
    })();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/force-merge-rules/${rules[0].id}`,
      payload: { games: ['A', 'B', 'C'], canonicalName: 'ABC' },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as ForceMergeRulesResponse).rules).toEqual([
      { id: rules[0].id, games: ['A', 'B', 'C'], canonicalName: 'ABC' },
    ]);
  });

  it('deletes a rule by id', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/force-merge-rules',
      payload: { games: ['A'] },
    });
    const { rules } = await getRules();

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/force-merge-rules/${rules[0].id}`,
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as ForceMergeRulesResponse).rules).toEqual([]);
  });

  it('rejects a missing or empty games list with 400', async () => {
    for (const payload of [
      {},
      { games: [] },
      { games: 'Halo' },
      { games: ['  '] },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/force-merge-rules',
        payload: payload as object,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('rejects a malformed canonical name with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/force-merge-rules',
      payload: { games: ['A'], canonicalName: 42 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when patching or deleting an unknown id', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/force-merge-rules/999',
      payload: { games: ['A'] },
    });
    expect(patch.statusCode).toBe(404);
    expect(patch.json()).toEqual({ error: 'Unknown force-merge rule: 999' });

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/force-merge-rules/999',
    });
    expect(del.statusCode).toBe(404);
  });

  it('keeps loadGameOverrides in sync after route mutations', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/force-merge-rules',
      payload: { games: ['Disco Elysium', 'Disco Elysium - The Final Cut'] },
    });

    expect(loadGameOverrides(seedDb.raw).forceMerge).toEqual([
      { games: ['Disco Elysium', 'Disco Elysium - The Final Cut'] },
    ]);
  });
});

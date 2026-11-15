import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, listStatuses, type Db } from '@gamekeeper/core';
import type { StatusesResponse } from '@gamekeeper/shared';
import { buildApp } from '../app';

describe('status routes', () => {
  let app: FastifyInstance;
  let seedDb: Db;
  let root: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-statuses-'));
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

  const getStatuses = async (): Promise<StatusesResponse> => {
    const res = await app.inject({ method: 'GET', url: '/api/statuses' });
    expect(res.statusCode).toBe(200);
    return res.json() as StatusesResponse;
  };

  const payload = (statuses: unknown) => ({ statuses });

  it('returns the nine seeded statuses in position order', async () => {
    const { statuses } = await getStatuses();

    expect(statuses.map(s => s.key)).toEqual([
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
    expect(statuses.map(s => s.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('applies labels, colors and positions from a full-list PUT', async () => {
    const { statuses: before } = await getStatuses();
    const reordered = [...before].reverse().map(s => ({
      key: s.key,
      label: `${s.label}!`,
      color: '#000000',
    }));

    const res = await app.inject({
      method: 'PUT',
      url: '/api/statuses',
      payload: payload(reordered),
    });

    expect(res.statusCode).toBe(200);
    const { statuses } = res.json() as StatusesResponse;
    expect(statuses.map(s => s.key)).toEqual(reordered.map(r => r.key));
    expect(statuses.map(s => s.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(statuses.every(s => s.label.endsWith('!'))).toBe(true);
    expect(statuses.every(s => s.color === '#000000')).toBe(true);
  });

  it('persists changes across requests', async () => {
    const { statuses: before } = await getStatuses();
    const first = before[0];
    const second = before[1];

    await app.inject({
      method: 'PUT',
      url: '/api/statuses',
      payload: payload([
        { key: second.key, label: 'Now First', color: second.color },
        { key: first.key, label: first.label, color: first.color },
        ...before.slice(2).map(s => ({ key: s.key, label: s.label, color: s.color })),
      ]),
    });

    const { statuses } = await getStatuses();
    expect(statuses[0]).toEqual({ key: second.key, label: 'Now First', color: second.color, position: 0 });
    expect(statuses[1].key).toBe(first.key);
  });

  it('rejects an unknown key with 400', async () => {
    const { statuses: before } = await getStatuses();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/statuses',
      payload: payload([
        ...before.map(s => ({ key: s.key, label: s.label, color: s.color })),
        { key: 'shelved', label: 'Shelved', color: '#123456' },
      ]),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Unknown status: shelved' });
  });

  it('rejects an incomplete list with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/statuses',
      payload: payload([{ key: 'backlog', label: 'Backlog', color: '#64748b' }]),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Status list must include every status' });
  });

  it('rejects a duplicate key with 400', async () => {
    const { statuses: before } = await getStatuses();
    const list = before.map(s => ({ key: s.key, label: s.label, color: s.color }));
    list[1] = { ...list[1], key: list[0].key };

    const res = await app.inject({
      method: 'PUT',
      url: '/api/statuses',
      payload: payload(list),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: `Duplicate status: ${list[0].key}` });
  });

  it('rejects malformed payloads with 400', async () => {
    const cases: unknown[] = [
      {},
      { statuses: [] },
      { statuses: 'nope' },
      { statuses: [{ key: 'backlog', label: '', color: '#64748b' }] },
      { statuses: [{ key: 'backlog', label: 'Backlog' }] },
      { statuses: [null] },
    ];

    for (const body of cases) {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/statuses',
        payload: body as object,
      });
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('leaves status keys untouched so game_status references stay valid', async () => {
    const { statuses: before } = await getStatuses();
    const keysBefore = before.map(s => s.key).sort();

    await app.inject({
      method: 'PUT',
      url: '/api/statuses',
      payload: payload(
        [...before].reverse().map(s => ({ key: s.key, label: s.label, color: s.color })),
      ),
    });

    const keysAfter = listStatuses(seedDb.raw)
      .map(s => s.key)
      .sort();
    expect(keysAfter).toEqual(keysBefore);
  });
});

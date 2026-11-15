import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';

const roots: string[] = [];
let app: FastifyInstance | null = null;

const makeApp = async (legacyInterests?: string[]): Promise<FastifyInstance> => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-server-'));
  roots.push(root);
  const dataDir = path.join(root, 'data');
  const cacheDir = path.join(root, 'cache');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  if (legacyInterests) {
    fs.writeFileSync(
      path.join(dataDir, 'gamepass-interests.json'),
      JSON.stringify({ wantToPlay: legacyInterests, _instructions: 'ignored' }),
    );
  }
  app = buildApp({ dataDir, cacheDir });
  await app.ready();
  return app;
};

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('app', () => {
  it('auto-imports a legacy interests file that sits beside the db', async () => {
    const server = await makeApp(['Game A', 'Game B']);

    const res = await server.inject({ method: 'GET', url: '/api/interests' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      interests: [
        { id: 'manual:game-a', title: 'Game A' },
        { id: 'manual:game-b', title: 'Game B' },
      ],
    });
  });

  it('GET /api/interests returns an empty list on a fresh database', async () => {
    const server = await makeApp();

    const res = await server.inject({ method: 'GET', url: '/api/interests' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ interests: [] });
  });

  it('POST /api/interests adds a game and returns the updated list', async () => {
    const server = await makeApp(['Game A']);

    const res = await server.inject({
      method: 'POST',
      url: '/api/interests',
      payload: { name: 'Game B' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      interests: [
        { id: 'manual:game-a', title: 'Game A' },
        { id: 'manual:game-b', title: 'Game B' },
      ],
    });
  });

  it('POST /api/interests rejects a missing name', async () => {
    const server = await makeApp();

    const res = await server.inject({
      method: 'POST',
      url: '/api/interests',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('DELETE /api/interests/:name removes a game', async () => {
    const server = await makeApp(['Game A', 'Game B']);

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/interests/${encodeURIComponent('Game A')}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      interests: [{ id: 'manual:game-b', title: 'Game B' }],
    });
  });

  it('POST /api/interests is idempotent for a duplicate name', async () => {
    const server = await makeApp(['Game A']);

    const res = await server.inject({
      method: 'POST',
      url: '/api/interests',
      payload: { name: 'Game A' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      interests: [{ id: 'manual:game-a', title: 'Game A' }],
    });
  });
});

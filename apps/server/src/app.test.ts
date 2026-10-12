import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';

describe('app', () => {
  let dataDir: string;
  let cacheDir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-server-'));
    dataDir = path.join(root, 'data');
    cacheDir = path.join(root, 'cache');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    app = buildApp({ dataDir, cacheDir });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/interests returns interests from the data dir file', async () => {
    fs.writeFileSync(
      path.join(dataDir, 'gamepass-interests.json'),
      JSON.stringify({ wantToPlay: ['Game A', 'Game B'] }),
    );

    const res = await app.inject({ method: 'GET', url: '/api/interests' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ interests: ['Game A', 'Game B'] });
  });

  it('GET /api/interests returns empty list when the file is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/interests' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ interests: [] });
  });

  it('POST /api/interests adds a game and returns the updated list', async () => {
    fs.writeFileSync(
      path.join(dataDir, 'gamepass-interests.json'),
      JSON.stringify({ wantToPlay: ['Game A'] }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/interests',
      payload: { name: 'Game B' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ interests: ['Game A', 'Game B'] });
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'gamepass-interests.json'), 'utf-8'),
    );
    expect(onDisk.wantToPlay).toEqual(['Game A', 'Game B']);
  });

  it('POST /api/interests rejects a missing name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/interests',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('DELETE /api/interests/:name removes a game', async () => {
    fs.writeFileSync(
      path.join(dataDir, 'gamepass-interests.json'),
      JSON.stringify({ wantToPlay: ['Game A', 'Game B'] }),
    );

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/interests/${encodeURIComponent('Game A')}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ interests: ['Game B'] });
  });

  it('POST /api/interests is idempotent for a duplicate name', async () => {
    fs.writeFileSync(
      path.join(dataDir, 'gamepass-interests.json'),
      JSON.stringify({ wantToPlay: ['Game A'] }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/interests',
      payload: { name: 'Game A' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ interests: ['Game A'] });
  });
});

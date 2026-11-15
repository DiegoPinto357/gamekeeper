import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createGamePassAdapter } from '@gamekeeper/core';
import { buildApp } from '../app';

vi.mock('@gamekeeper/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@gamekeeper/core')>();
  return {
    ...actual,
    createGamePassAdapter: vi.fn(),
  };
});

const getCatalog = vi.fn();

describe('catalog routes', () => {
  let app: FastifyInstance;
  let root: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(createGamePassAdapter).mockReturnValue({
      getCatalog,
      isGameAvailable: vi.fn(),
      getAvailableTitles: vi.fn(),
    } as unknown as ReturnType<typeof createGamePassAdapter>);

    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gamekeeper-catalog-'));
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });

    app = buildApp({
      dataDir: path.join(root, 'data'),
      cacheDir: path.join(root, 'cache'),
      dbPath: path.join(root, 'data', 'gamekeeper.db'),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns the catalog as-is', async () => {
    getCatalog.mockResolvedValue([
      { id: '1', title: 'Starfield', available: true },
      { id: '2', title: 'TUNIC', available: true },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/catalog' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: '1', title: 'Starfield', available: true },
      { id: '2', title: 'TUNIC', available: true },
    ]);
  });

  it('dedupes games sharing the same title, keeping the first', async () => {
    getCatalog.mockResolvedValue([
      { id: '1', title: 'Starfield', available: true },
      { id: '2', title: 'Starfield', available: false },
      { id: '3', title: 'TUNIC', available: true },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/catalog' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: '1', title: 'Starfield', available: true },
      { id: '3', title: 'TUNIC', available: true },
    ]);
  });

  it('returns 500 when the catalog cannot be loaded', async () => {
    getCatalog.mockRejectedValue(new Error('network down'));

    const res = await app.inject({ method: 'GET', url: '/api/catalog' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Failed to load catalog' });
  });
});

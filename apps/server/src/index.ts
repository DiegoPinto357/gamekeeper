import './bootstrap';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createGamePassAdapter } from '@gamekeeper/core';
import fs from 'fs/promises';
import path from 'path';

const PORT = Number(process.env.PORT) || 3010;
const INTERESTS_FILE = path.join(process.cwd(), 'data/gamepass-interests.json');
const GAMEPASS_CACHE_DIR = path.join(process.cwd(), '.cache/gamepass');

const gamePassAdapter = createGamePassAdapter(GAMEPASS_CACHE_DIR, 7);

const server = Fastify({ logger: false });

await server.register(cors, {
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
});

/** GET /api/catalog — returns full Game Pass catalog with cover images */
server.get('/api/catalog', async (_req, reply) => {
  try {
    const catalog = await gamePassAdapter.getCatalog();
    return reply.send(catalog);
  } catch (error) {
    server.log.error(error);
    return reply.status(500).send({ error: 'Failed to load catalog' });
  }
});

/** GET /api/interests — returns the wantToPlay list */
server.get('/api/interests', async (_req, reply) => {
  try {
    const content = await fs.readFile(INTERESTS_FILE, 'utf-8');
    const data = JSON.parse(content);
    return reply.send({ interests: data.wantToPlay ?? [] });
  } catch {
    return reply.send({ interests: [] });
  }
});

/** POST /api/interests — add a game { name: string } */
server.post<{ Body: { name: string } }>(
  '/api/interests',
  async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return reply.status(400).send({ error: 'name is required' });

    const data = await readInterests();
    if (!data.wantToPlay.includes(name)) {
      data.wantToPlay.push(name);
      await writeInterests(data);
    }
    return reply.send({ interests: data.wantToPlay });
  },
);

/** DELETE /api/interests/:name — remove a game from interests */
server.delete<{ Params: { name: string } }>(
  '/api/interests/:name',
  async (req, reply) => {
    const name = decodeURIComponent(req.params.name);
    const data = await readInterests();
    data.wantToPlay = data.wantToPlay.filter((n: string) => n !== name);
    await writeInterests(data);
    return reply.send({ interests: data.wantToPlay });
  },
);

// ── helpers ──────────────────────────────────────────────────────────────────

async function readInterests(): Promise<{
  wantToPlay: string[];
  [k: string]: unknown;
}> {
  try {
    const content = await fs.readFile(INTERESTS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { wantToPlay: [] };
  }
}

async function writeInterests(data: object): Promise<void> {
  const tmp = INTERESTS_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, INTERESTS_FILE);
}

// ── start ─────────────────────────────────────────────────────────────────────

await server.listen({ port: PORT, host: '0.0.0.0' });
console.log(`🎮 GameKeeper server running at http://localhost:${PORT}`);

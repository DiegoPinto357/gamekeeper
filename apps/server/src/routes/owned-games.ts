import type { FastifyInstance } from 'fastify';
import {
  addOwnedGame,
  listOwnedGames,
  removeOwnedGame,
  type Db,
} from '@gamekeeper/core';

export interface OwnedGamesRouteOptions {
  db: Db;
}

export const registerOwnedGamesRoutes = (
  app: FastifyInstance,
  opts: OwnedGamesRouteOptions,
): void => {
  const respond = (reply: { send: (payload: unknown) => unknown }) =>
    reply.send({ ownedGames: listOwnedGames(opts.db.raw) });

  app.get('/api/owned-games', async (_req, reply) => respond(reply));

  app.post<{
    Body: {
      name?: string;
      platform?: string;
      notes?: string;
      canonicalId?: string;
    };
  }>('/api/owned-games', async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return reply.status(400).send({ error: 'name is required' });

    const platform =
      typeof req.body?.platform === 'string' && req.body.platform.trim()
        ? req.body.platform.trim()
        : undefined;
    const notes =
      typeof req.body?.notes === 'string' ? req.body.notes : undefined;
    const canonicalId =
      typeof req.body?.canonicalId === 'string' && req.body.canonicalId.trim()
        ? req.body.canonicalId.trim()
        : undefined;

    addOwnedGame(opts.db.raw, { name, platform, notes, canonicalId });
    return respond(reply);
  });

  app.delete<{ Params: { canonicalId: string } }>(
    '/api/owned-games/:canonicalId',
    async (req, reply) => {
      removeOwnedGame(opts.db.raw, decodeURIComponent(req.params.canonicalId));
      return respond(reply);
    },
  );
};

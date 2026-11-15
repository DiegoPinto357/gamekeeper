import type { FastifyInstance } from 'fastify';
import {
  addInterest,
  listInterestEntries,
  removeInterestByTitle,
  type Db,
} from '@gamekeeper/core';

export interface InterestRouteOptions {
  db: Db;
}

export const registerInterestRoutes = (
  app: FastifyInstance,
  opts: InterestRouteOptions,
): void => {
  const respond = (reply: { send: (payload: unknown) => unknown }) =>
    reply.send({ interests: listInterestEntries(opts.db.raw) });

  app.get('/api/interests', async (_req, reply) => respond(reply));

  app.post<{ Body: { name?: string; id?: string } }>(
    '/api/interests',
    async (req, reply) => {
      const name = req.body?.name?.trim();
      if (!name) return reply.status(400).send({ error: 'name is required' });

      const id =
        typeof req.body?.id === 'string' && req.body.id.trim()
          ? req.body.id.trim()
          : undefined;

      addInterest(opts.db.raw, name, id);
      return respond(reply);
    },
  );

  app.delete<{ Params: { name: string } }>(
    '/api/interests/:name',
    async (req, reply) => {
      const name = decodeURIComponent(req.params.name);
      removeInterestByTitle(opts.db.raw, name);
      return respond(reply);
    },
  );
};

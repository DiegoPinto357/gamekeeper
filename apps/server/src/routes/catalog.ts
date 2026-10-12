import { createGamePassAdapter } from '@gamekeeper/core';
import type { FastifyInstance } from 'fastify';

export interface CatalogRouteOptions {
  cacheDir: string;
}

export const registerCatalogRoutes = (
  app: FastifyInstance,
  opts: CatalogRouteOptions,
): void => {
  const gamePassAdapter = createGamePassAdapter(opts.cacheDir, 7);

  app.get('/api/catalog', async (_req, reply) => {
    try {
      const catalog = await gamePassAdapter.getCatalog();
      const seen = new Set<string>();
      const deduped = catalog.filter(({ title }) => {
        if (seen.has(title)) return false;
        seen.add(title);
        return true;
      });
      return reply.send(deduped);
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Failed to load catalog' });
    }
  });
};

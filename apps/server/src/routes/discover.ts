import type { FastifyInstance } from 'fastify';
import {
  parseDiscoverFilters,
  queryGames,
  getFacets,
  type Db,
} from '@gamekeeper/core';
import type { DiscoverResponse, DiscoverFacets } from '@gamekeeper/shared';

export type DiscoverRouteOptions = {
  db: Db;
};

export const registerDiscoverRoutes = (
  app: FastifyInstance,
  opts: DiscoverRouteOptions,
): void => {
  const { db } = opts;

  app.get('/api/games', async (req): Promise<DiscoverResponse> => {
    const filters = parseDiscoverFilters(
      req.query as Record<string, string | string[] | undefined>,
    );
    const { games, total } = queryGames(db.raw, filters);
    return { games, total };
  });

  app.get('/api/facets', async (req): Promise<DiscoverFacets> => {
    const filters = parseDiscoverFilters(
      req.query as Record<string, string | string[] | undefined>,
    );
    return getFacets(db.raw, filters);
  });
};

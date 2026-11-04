import type { FastifyInstance } from 'fastify';
import {
  parseDiscoverFilters,
  queryGames,
  getFacets,
  suggestPick,
  suggestShelves,
  type Db,
} from '@gamekeeper/core';
import type {
  DiscoverResponse,
  DiscoverFacets,
  SuggestResponse,
  HubResponse,
} from '@gamekeeper/shared';

export type DiscoverRouteOptions = {
  db: Db;
};

type Query = Record<string, string | string[] | undefined>;

/** `exclude=id1,id2` (comma lists and repeated keys both work). */
const parseExclude = (query: Query): string[] => {
  const raw = query.exclude;
  const entries = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return entries
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
};

/** `seed=N` for reproducible shelves; anything unparseable → fresh random. */
const parseSeed = (query: Query): number | undefined => {
  const raw = query.seed;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;
  const seed = Number(value);
  return Number.isFinite(seed) ? Math.floor(seed) : undefined;
};

export const registerDiscoverRoutes = (
  app: FastifyInstance,
  opts: DiscoverRouteOptions,
): void => {
  const { db } = opts;

  app.get('/api/games', async (req): Promise<DiscoverResponse> => {
    const filters = parseDiscoverFilters(req.query as Query);
    const { games, total } = queryGames(db.raw, filters);
    return { games, total };
  });

  app.get('/api/facets', async (req): Promise<DiscoverFacets> => {
    const filters = parseDiscoverFilters(req.query as Query);
    return getFacets(db.raw, filters);
  });

  app.get('/api/suggest', async (req): Promise<SuggestResponse> => {
    const query = req.query as Query;
    const filters = parseDiscoverFilters(query);
    const pick = suggestPick(db.raw, filters, { exclude: parseExclude(query) });
    return pick
      ? { game: pick.game, reasons: pick.reasons }
      : { game: null, reasons: [] };
  });

  app.get('/api/hub', async (req): Promise<HubResponse> => {
    const query = req.query as Query;
    const filters = parseDiscoverFilters(query);
    const shelves = suggestShelves(db.raw, filters, {
      seed: parseSeed(query),
    });
    return { shelves };
  });
};

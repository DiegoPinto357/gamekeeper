import type { FastifyInstance } from 'fastify';
import {
  InvalidStatusListError,
  listStatuses,
  replaceStatuses,
  type Db,
  type StatusInput,
} from '@gamekeeper/core';
import type { StatusesResponse } from '@gamekeeper/shared';

export interface StatusesRouteOptions {
  db: Db;
}

export const registerStatusesRoutes = (
  app: FastifyInstance,
  opts: StatusesRouteOptions,
): void => {
  app.get('/api/statuses', async (_req, reply) => {
    const response: StatusesResponse = { statuses: listStatuses(opts.db.raw) };
    return reply.send(response);
  });

  app.put<{ Body: { statuses?: unknown } }>(
    '/api/statuses',
    async (req, reply) => {
      const list = req.body?.statuses;
      if (!Array.isArray(list) || list.length === 0) {
        return reply
          .status(400)
          .send({ error: 'statuses must be a non-empty array' });
      }

      for (const item of list) {
        const candidate = item as {
          key?: unknown;
          label?: unknown;
          color?: unknown;
        };
        if (
          !candidate ||
          typeof candidate.key !== 'string' ||
          !candidate.key ||
          typeof candidate.label !== 'string' ||
          !candidate.label ||
          typeof candidate.color !== 'string' ||
          !candidate.color
        ) {
          return reply
            .status(400)
            .send({ error: 'each status needs key, label and color' });
        }
      }

      try {
        const statuses = replaceStatuses(
          opts.db.raw,
          list as StatusInput[],
        );
        const response: StatusesResponse = { statuses };
        return reply.send(response);
      } catch (err) {
        if (err instanceof InvalidStatusListError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );
};

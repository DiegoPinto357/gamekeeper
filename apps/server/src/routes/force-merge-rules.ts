import type { FastifyInstance } from 'fastify';
import {
  addForceMergeRule,
  deleteForceMergeRule,
  listForceMergeRules,
  updateForceMergeRule,
  UnknownForceMergeRuleError,
  type Db,
  type ForceMergeRuleInput,
} from '@gamekeeper/core';
import type { ForceMergeRulesResponse } from '@gamekeeper/shared';

export interface ForceMergeRulesRouteOptions {
  db: Db;
}

const parseBody = (body: unknown): ForceMergeRuleInput | null => {
  if (!body || typeof body !== 'object') return null;
  const { games, canonicalName } = body as {
    games?: unknown;
    canonicalName?: unknown;
  };
  if (!Array.isArray(games)) return null;
  if (
    canonicalName !== undefined &&
    (typeof canonicalName !== 'string' || !canonicalName.trim())
  ) {
    return null;
  }
  if (games.some(game => typeof game !== 'string' || !game.trim())) return null;
  return {
    games: games as string[],
    ...(canonicalName != null && { canonicalName: canonicalName as string }),
  };
};

export const registerForceMergeRulesRoutes = (
  app: FastifyInstance,
  opts: ForceMergeRulesRouteOptions,
): void => {
  const respond = (reply: { send: (payload: unknown) => unknown }) => {
    const response: ForceMergeRulesResponse = {
      rules: listForceMergeRules(opts.db.raw),
    };
    return reply.send(response);
  };

  app.get('/api/force-merge-rules', async (_req, reply) => respond(reply));

  app.post('/api/force-merge-rules', async (req, reply) => {
    const input = parseBody(req.body);
    if (!input) {
      return reply.status(400).send({ error: 'games must be a non-empty list' });
    }
    try {
      addForceMergeRule(opts.db.raw, input);
      return respond(reply);
    } catch (err) {
      if (err instanceof Error && err.message === 'games must be a non-empty list') {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>(
    '/api/force-merge-rules/:id',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        return reply.status(404).send({ error: 'Unknown force-merge rule' });
      }
      const input = parseBody(req.body);
      if (!input) {
        return reply
          .status(400)
          .send({ error: 'games must be a non-empty list' });
      }
      try {
        updateForceMergeRule(opts.db.raw, id, input);
        return respond(reply);
      } catch (err) {
        if (err instanceof UnknownForceMergeRuleError) {
          return reply.status(404).send({ error: err.message });
        }
        if (err instanceof Error && err.message === 'games must be a non-empty list') {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/force-merge-rules/:id',
    async (req, reply) => {
      const id = Number(req.params.id);
      const deleted =
        Number.isInteger(id) && deleteForceMergeRule(opts.db.raw, id);
      if (!deleted) {
        return reply
          .status(404)
          .send({ error: `Unknown force-merge rule: ${req.params.id}` });
      }
      return respond(reply);
    },
  );
};

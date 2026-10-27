import type { FastifyInstance } from 'fastify';
import {
  getLibraryGames,
  listStatuses,
  setGameStatus,
  unpinGame,
  UnknownGameError,
  UnknownStatusError,
  type Db,
  type LibraryGame as CoreLibraryGame,
} from '@gamekeeper/core';
import type {
  LibraryGame,
  LibraryResponse,
  GameStatusResult,
  UnpinResult,
} from '@gamekeeper/shared';

export type LibraryRouteOptions = {
  db: Db;
};

type PatchBody = {
  status?: unknown;
  beforeId?: unknown;
  afterId?: unknown;
};

/** Bridge core's row-shaped LibraryGame (nullable) to shared's API shape. */
const toLibraryGame = (game: CoreLibraryGame): LibraryGame => ({
  canonicalId: game.canonicalId,
  name: game.name,
  coverImageUrl: game.coverImageUrl ?? undefined,
  playtimeHours: game.playtimeHours ?? undefined,
  primarySource: game.primarySource,
  ownedSources: game.ownedSources,
  status: game.status,
  position: game.position,
  pinned: game.pinned,
  unavailableReason: game.unavailableReason ?? undefined,
  proton: game.proton ?? undefined,
});

const optionalId = (value: unknown): string | null | undefined => {
  if (value == null) return value === undefined ? undefined : null;
  return typeof value === 'string' ? value : undefined;
};

export const registerLibraryRoutes = (
  app: FastifyInstance,
  opts: LibraryRouteOptions,
): void => {
  const { db } = opts;

  app.get('/api/library', async (): Promise<LibraryResponse> => ({
    statuses: listStatuses(db.raw),
    games: getLibraryGames(db.raw).map(toLibraryGame),
  }));

  app.patch<{ Params: { id: string }; Body: PatchBody }>(
    '/api/games/:id/status',
    async (req, reply) => {
      const { id } = req.params;
      const body = req.body ?? {};

      if (typeof body.status !== 'string' || body.status.length === 0) {
        return reply
          .status(400)
          .send({ error: 'body.status (string) is required' });
      }
      const beforeId = optionalId(body.beforeId);
      const afterId = optionalId(body.afterId);
      if (beforeId === undefined && body.beforeId != null) {
        return reply
          .status(400)
          .send({ error: 'beforeId must be a string or null' });
      }
      if (afterId === undefined && body.afterId != null) {
        return reply
          .status(400)
          .send({ error: 'afterId must be a string or null' });
      }

      try {
        const result: GameStatusResult = setGameStatus(
          db.raw,
          id,
          body.status,
          { beforeId, afterId },
        );
        return reply.send(result);
      } catch (err) {
        if (err instanceof UnknownGameError) {
          return reply.status(404).send({ error: `unknown game: ${id}` });
        }
        if (err instanceof UnknownStatusError) {
          return reply
            .status(400)
            .send({ error: `unknown status: ${body.status}` });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/library/games/:id/unpin',
    async (req, reply) => {
      const { id } = req.params;
      try {
        const result: UnpinResult = unpinGame(db.raw, id);
        return reply.send(result);
      } catch (err) {
        if (err instanceof UnknownGameError) {
          return reply.status(404).send({ error: `unknown game: ${id}` });
        }
        throw err;
      }
    },
  );
};

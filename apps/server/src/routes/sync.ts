import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { SyncRunManager } from '../sync/run-manager';

export interface SyncRouteOptions {
  manager: SyncRunManager;
}

const writeFrame = (stream: Readable, payload: unknown): void => {
  stream.push(`data: ${JSON.stringify(payload)}\n\n`);
};

export const registerSyncRoutes = (
  app: FastifyInstance,
  opts: SyncRouteOptions,
): void => {
  const { manager } = opts;

  app.post<{ Body: { skipNotion?: boolean } }>(
    '/api/sync',
    async (req, reply) => {
      // Notion is opt-in over the API: skipped unless explicitly disabled
      const skipNotion = req.body?.skipNotion !== false;
      const result = manager.start(skipNotion);

      if (!result.ok) {
        return reply
          .status(409)
          .send({ error: 'sync already in progress', runId: result.runId });
      }
      return reply.send({ runId: result.runId });
    },
  );

  app.get('/api/sync/events', (req: FastifyRequest, reply) => {
    const stream = new Readable({
      read: () => {},
    });

    writeFrame(stream, manager.snapshot());

    const unsubscribe = manager.subscribe(event => writeFrame(stream, event));

    let cleanedUp = false;
    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      unsubscribe();
      stream.push(null);
    };
    req.raw.on('close', cleanup);
    stream.on('close', cleanup);

    return reply
      .header('Content-Type', 'text/event-stream')
      .header('Cache-Control', 'no-cache')
      .header('Connection', 'keep-alive')
      .send(stream);
  });
};

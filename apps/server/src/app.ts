import Fastify from 'fastify';
import cors from '@fastify/cors';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, type Db } from '@gamekeeper/core';
import { registerCatalogRoutes } from './routes/catalog';
import { registerInterestRoutes } from './routes/interests';
import { registerOwnedGamesRoutes } from './routes/owned-games';
import { registerSyncRoutes } from './routes/sync';
import { registerLibraryRoutes } from './routes/library';
import { registerDiscoverRoutes } from './routes/discover';
import { registerStatusesRoutes } from './routes/statuses';
import { registerForceMergeRulesRoutes } from './routes/force-merge-rules';
import { createSyncRunManager } from './sync/run-manager';
import type { RunSyncFn } from './sync/run-manager';

export interface AppOptions {
  dataDir?: string;
  cacheDir?: string;
  /** injectable orchestrator for tests; defaults to core's runSync */
  runSync?: RunSyncFn;
  /** injectable sqlite path for tests; defaults to GAMEKEEPER_DB or <dataDir>/gamekeeper.db */
  dbPath?: string;
}

export const buildApp = (opts: AppOptions = {}): FastifyInstance => {
  const dataDir = opts.dataDir ?? path.join(process.cwd(), 'data');
  const cacheDir = opts.cacheDir ?? path.join(process.cwd(), '.cache/gamepass');
  const dbPath =
    opts.dbPath ??
    process.env.GAMEKEEPER_DB ??
    path.join(dataDir, 'gamekeeper.db');

  const app = Fastify({ logger: false });

  app.register(cors, {
    origin: [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5174',
    ],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  const db: Db = openDb(dbPath);
  app.addHook('onClose', async () => {
    db.close();
  });

  registerCatalogRoutes(app, { cacheDir });
  registerInterestRoutes(app, { db });
  registerOwnedGamesRoutes(app, { db });
  registerLibraryRoutes(app, { db });
  registerDiscoverRoutes(app, { db });
  registerStatusesRoutes(app, { db });
  registerForceMergeRulesRoutes(app, { db });

  const syncManager = createSyncRunManager({ runSync: opts.runSync });
  registerSyncRoutes(app, { manager: syncManager });

  return app;
};

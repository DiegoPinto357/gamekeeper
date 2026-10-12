import Fastify from 'fastify';
import cors from '@fastify/cors';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { registerCatalogRoutes } from './routes/catalog';
import { registerInterestRoutes } from './routes/interests';

export interface AppOptions {
  dataDir?: string;
  cacheDir?: string;
}

export const buildApp = (opts: AppOptions = {}): FastifyInstance => {
  const dataDir = opts.dataDir ?? path.join(process.cwd(), 'data');
  const cacheDir = opts.cacheDir ?? path.join(process.cwd(), '.cache/gamepass');

  const app = Fastify({ logger: false });

  app.register(cors, {
    origin: [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5174',
    ],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  });

  registerCatalogRoutes(app, { cacheDir });
  registerInterestRoutes(app, {
    interestsFile: path.join(dataDir, 'gamepass-interests.json'),
  });

  return app;
};

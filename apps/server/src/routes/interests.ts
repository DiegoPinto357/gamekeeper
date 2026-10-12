import fs from 'fs/promises';
import type { FastifyInstance } from 'fastify';

export interface InterestRouteOptions {
  interestsFile: string;
}

interface InterestsData {
  wantToPlay: string[];
  [k: string]: unknown;
}

export const registerInterestRoutes = (
  app: FastifyInstance,
  opts: InterestRouteOptions,
): void => {
  const readInterests = async (): Promise<InterestsData> => {
    try {
      const content = await fs.readFile(opts.interestsFile, 'utf-8');
      return JSON.parse(content) as InterestsData;
    } catch {
      return { wantToPlay: [] };
    }
  };

  const writeInterests = async (data: object): Promise<void> => {
    const tmp = opts.interestsFile + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmp, opts.interestsFile);
  };

  app.get('/api/interests', async (_req, reply) => {
    try {
      const data = await readInterests();
      return reply.send({ interests: data.wantToPlay ?? [] });
    } catch {
      return reply.send({ interests: [] });
    }
  });

  app.post<{ Body: { name: string } }>('/api/interests', async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return reply.status(400).send({ error: 'name is required' });

    const data = await readInterests();
    if (!data.wantToPlay.includes(name)) {
      data.wantToPlay.push(name);
      await writeInterests(data);
    }
    return reply.send({ interests: data.wantToPlay });
  });

  app.delete<{ Params: { name: string } }>(
    '/api/interests/:name',
    async (req, reply) => {
      const name = decodeURIComponent(req.params.name);
      const data = await readInterests();
      data.wantToPlay = data.wantToPlay.filter((n: string) => n !== name);
      await writeInterests(data);
      return reply.send({ interests: data.wantToPlay });
    },
  );
};

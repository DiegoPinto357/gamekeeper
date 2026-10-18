import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';
import { buildApp } from '../app';
import { createSyncRunManager } from '../sync/run-manager';
import type {
  SyncEvent,
  SyncSummary,
  SyncOptions,
  SyncDeps,
} from '@gamekeeper/core';

const makeSummary = (overrides: Partial<SyncSummary> = {}): SyncSummary => ({
  added: 0,
  updated: 0,
  removed: 0,
  skipped: 0,
  errors: 0,
  duration: 42,
  ...overrides,
});

const configStepEvents: SyncEvent[] = [
  { type: 'step:start', key: 'config', label: 'Configuration loaded' },
  { type: 'step:done', key: 'config', label: 'Configuration loaded', detail: 'ok' },
];

type FakeRunSync = {
  fn: (options: SyncOptions, deps: SyncDeps) => Promise<SyncSummary>;
  calls: Array<{ options: SyncOptions; deps: SyncDeps }>;
  setManual: (manual: boolean) => void;
  release: () => Promise<void>;
};

const makeFakeRunSync = (): FakeRunSync => {
  const calls: Array<{ options: SyncOptions; deps: SyncDeps }> = [];
  let manual = false;
  let releaseRun: (() => void) | null = null;

  const fn = async (options: SyncOptions, deps: SyncDeps) => {
    calls.push({ options, deps });
    for (const event of configStepEvents) deps.emit(event);
    if (!manual) {
      const summary = makeSummary({ updated: 698 });
      deps.emit({ type: 'summary', summary });
      return summary;
    }
    await new Promise<void>(resolve => {
      releaseRun = resolve;
    });
    const summary = makeSummary({ updated: 698, duration: 99 });
    deps.emit({ type: 'summary', summary });
    return summary;
  };

  return {
    fn,
    calls,
    setManual: value => {
      manual = value;
    },
    release: async () => {
      releaseRun?.();
      releaseRun = null;
      // let the released run's promise chain (summary push + manager catch) settle
      await new Promise(resolve => setTimeout(resolve, 0));
    },
  };
};

const parseSseFrames = (stream: Readable): Array<Record<string, unknown>> => {
  const frames: Array<Record<string, unknown>> = [];
  let buffer = '';
  stream.on('data', chunk => {
    buffer += chunk.toString('utf-8');
    let index: number;
    while ((index = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const dataLine = frame.split('\n').find(line => line.startsWith('data: '));
      if (dataLine) frames.push(JSON.parse(dataLine.slice('data: '.length)));
    }
  });
  return frames;
};

const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

describe('sync routes', () => {
  let app: FastifyInstance;
  let fake: FakeRunSync;
  const openStreams: Readable[] = [];

  const openSse = async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sync/events',
      payloadAsStream: true,
    });
    const stream = res.stream();
    openStreams.push(stream);
    return { res, frames: parseSseFrames(stream) };
  };

  beforeEach(async () => {
    fake = makeFakeRunSync();
    app = buildApp({
      dataDir: '/tmp/gamekeeper-sync-tests',
      cacheDir: '/tmp/gamekeeper-sync-tests-cache',
      runSync: fake.fn,
    });
    await app.ready();
  });

  afterEach(async () => {
    for (const stream of openStreams.splice(0)) stream.destroy();
    await app.close();
  });

  it('POST /api/sync starts a run and returns a runId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync',
      payload: { skipNotion: false },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.runId).toBe('string');
    expect(body.runId.length).toBeGreaterThan(0);
    await waitFor(() => fake.calls.length === 1, 'runSync call');
    expect(fake.calls[0].options).toEqual({ skipNotion: false });
    expect(fake.calls[0].deps.logger).toBeDefined();
    expect(typeof fake.calls[0].deps.emit).toBe('function');
  });

  it('POST /api/sync skips Notion unless explicitly disabled', async () => {
    await app.inject({ method: 'POST', url: '/api/sync' });
    await waitFor(() => fake.calls.length === 1, 'runSync call');
    expect(fake.calls[0].options.skipNotion).toBe(true);
  });

  it('second POST during a run returns 409 with the active runId; retry works after completion', async () => {
    fake.setManual(true);

    const first = await app.inject({
      method: 'POST',
      url: '/api/sync',
      payload: { skipNotion: true },
    });
    expect(first.statusCode).toBe(200);
    const activeRunId = first.json().runId;

    const second = await app.inject({
      method: 'POST',
      url: '/api/sync',
      payload: { skipNotion: true },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({
      error: 'sync already in progress',
      runId: activeRunId,
    });
    expect(fake.calls).toHaveLength(1);

    await fake.release();

    const third = await app.inject({
      method: 'POST',
      url: '/api/sync',
      payload: { skipNotion: true },
    });
    expect(third.statusCode).toBe(200);
    expect(third.json().runId).not.toBe(activeRunId);
    await fake.release();
  });

  it('GET /api/sync/events sends an idle snapshot first', async () => {
    const { frames } = await openSse();

    await waitFor(() => frames.length >= 1, 'snapshot frame');
    expect(frames[0]).toEqual({
      type: 'snapshot',
      status: 'idle',
      runId: null,
      events: [],
      summary: null,
    });
  });

  it('streams live events for a run started after connecting, then a summary', async () => {
    const { frames } = await openSse();
    await waitFor(() => frames.length >= 1, 'snapshot frame');

    await app.inject({
      method: 'POST',
      url: '/api/sync',
      payload: { skipNotion: true },
    });
    await waitFor(() => frames.length >= 3, 'step events');
    expect(frames.slice(1, 3)).toEqual(configStepEvents);

    await fake.release();
    await waitFor(
      () => frames.some(frame => frame.type === 'summary'),
      'summary frame',
    );
    const summaryFrame = frames.find(frame => frame.type === 'summary') as {
      summary: SyncSummary;
    };
    expect(summaryFrame.summary.updated).toBe(698);
  });

  it('a client connecting mid-run gets a snapshot with events so far', async () => {
    fake.setManual(true);
    const post = await app.inject({
      method: 'POST',
      url: '/api/sync',
      payload: { skipNotion: true },
    });
    const activeRunId = post.json().runId;
    await waitFor(() => fake.calls.length === 1, 'run start');

    const { frames } = await openSse();
    await waitFor(() => frames.length >= 1, 'mid-run snapshot');
    const snapshot = frames[0] as { status: string; runId: string; events: SyncEvent[] };
    expect(snapshot.status).toBe('running');
    expect(snapshot.runId).toBe(activeRunId);
    expect(snapshot.events).toEqual(configStepEvents);

    await fake.release();
    await waitFor(
      () => frames.some(frame => frame.type === 'summary'),
      'summary for mid-run client',
    );
  });

  it('a client connecting after completion gets the last run snapshot with summary', async () => {
    await app.inject({ method: 'POST', url: '/api/sync' });
    await waitFor(() => fake.calls.length === 1, 'run completion');
    await new Promise(resolve => setTimeout(resolve, 20));

    const { frames } = await openSse();
    await waitFor(() => frames.length >= 1, 'done snapshot');
    const snapshot = frames[0] as {
      status: string;
      runId: string | null;
      summary: SyncSummary | null;
      events: SyncEvent[];
    };
    expect(snapshot.status).toBe('done');
    expect(snapshot.runId).toEqual(expect.any(String));
    expect(snapshot.summary).toMatchObject({ updated: 698 });
    expect(snapshot.events.at(-1)).toMatchObject({ type: 'summary' });
  });
});

describe('createSyncRunManager', () => {
  it('bounds the event ring, keeping the newest events including summary', async () => {
    const emitted: SyncEvent[] = [];
    const manager = createSyncRunManager({
      maxEvents: 3,
      runSync: async (_options, deps) => {
        for (let i = 1; i <= 4; i++) {
          const event: SyncEvent = {
            type: 'progress',
            key: 'protondb',
            current: i,
            total: 4,
          };
          deps.emit(event);
          emitted.push(event);
        }
        const summary = makeSummary({ duration: 5 });
        deps.emit({ type: 'summary', summary });
        return summary;
      },
    });

    const result = manager.start(true);
    expect(result.ok).toBe(true);
    await waitFor(() => manager.snapshot().summary !== null, 'manager summary');

    const snapshot = manager.snapshot();
    expect(snapshot.events).toHaveLength(3);
    expect(snapshot.events.at(-1)).toMatchObject({ type: 'summary' });
    expect(snapshot.events).not.toContainEqual(emitted[0]);
    expect(snapshot.status).toBe('done');
  });

  it('notifies subscribers of live events and unsubscribes cleanly', async () => {
    const seen: SyncEvent[] = [];
    const manager = createSyncRunManager({
      runSync: async (_options, deps) => {
        for (const event of configStepEvents) deps.emit(event);
        const summary = makeSummary();
        deps.emit({ type: 'summary', summary });
        return summary;
      },
    });

    const unsubscribe = manager.subscribe(event => seen.push(event));
    const started = manager.start(true);
    expect(started.ok).toBe(true);
    await waitFor(() => seen.some(event => event.type === 'summary'), 'subscriber summary');

    unsubscribe();
    const seenAfterUnsubscribe = seen.length;
    const second = manager.start(true);
    expect(second.ok).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(seen).toHaveLength(seenAfterUnsubscribe);
  });

  it('allows a new run only after the previous run settles', async () => {
    let release: (() => void) | null = null;
    const manager = createSyncRunManager({
      runSync: (_options, deps) =>
        new Promise<SyncSummary>(resolve => {
          release = () => {
            const summary = makeSummary();
            deps.emit({ type: 'summary', summary });
            resolve(summary);
          };
        }),
    });

    const first = manager.start(true);
    expect(first.ok).toBe(true);
    const conflict = manager.start(true);
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.runId).toBe(first.ok ? first.runId : '');

    release!();
    await waitFor(() => manager.snapshot().status === 'done', 'run settle');
    const next = manager.start(true);
    expect(next.ok).toBe(true);
  });
});

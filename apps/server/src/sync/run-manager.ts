import { randomUUID } from 'node:crypto';
import {
  runSync as defaultRunSync,
  silentLogger,
  type Logger,
  type SyncEvent,
  type SyncOptions,
  type SyncDeps,
  type SyncSummary,
} from '@gamekeeper/core';

export type RunSyncFn = (
  options: SyncOptions,
  deps: SyncDeps,
) => Promise<SyncSummary>;

export type RunStatus = 'idle' | 'running' | 'done' | 'error';

export interface SyncSnapshot {
  type: 'snapshot';
  status: RunStatus;
  runId: string | null;
  events: SyncEvent[];
  summary: SyncSummary | null;
}

export const MAX_RUN_EVENTS = 1000;

export type StartResult =
  | { ok: true; runId: string }
  | { ok: false; runId: string };

export interface SyncRunManager {
  start(skipNotion: boolean): StartResult;
  snapshot(): SyncSnapshot;
  subscribe(listener: (event: SyncEvent) => void): () => void;
}

export interface SyncRunManagerOptions {
  runSync?: RunSyncFn;
  logger?: Logger;
  maxEvents?: number;
}

export const createSyncRunManager = (
  opts: SyncRunManagerOptions = {},
): SyncRunManager => {
  const runSync = opts.runSync ?? defaultRunSync;
  const logger = opts.logger ?? silentLogger;
  const maxEvents = opts.maxEvents ?? MAX_RUN_EVENTS;

  let status: RunStatus = 'idle';
  let runId: string | null = null;
  let events: SyncEvent[] = [];
  let summary: SyncSummary | null = null;
  const listeners = new Set<(event: SyncEvent) => void>();

  const push = (event: SyncEvent): void => {
    events.push(event);
    if (events.length > maxEvents) {
      events.splice(0, events.length - maxEvents);
    }
    if (event.type === 'summary') {
      summary = event.summary;
      status = 'done';
    }
    for (const listener of listeners) listener(event);
  };

  return {
    start(skipNotion: boolean): StartResult {
      // the summary event flips status synchronously, so this guard also
      // covers the microtask window before the runSync promise settles
      if (status === 'running' && runId) return { ok: false, runId };

      runId = randomUUID();
      status = 'running';
      events = [];
      summary = null;
      const thisRunId = runId;

      void runSync({ skipNotion }, { logger, emit: push })
        .catch(() => {
          // runSync always emits a terminal summary before rethrowing;
          // only mark error if that somehow never happened
          if (runId === thisRunId && !summary) status = 'error';
        });

      return { ok: true, runId };
    },

    snapshot(): SyncSnapshot {
      return {
        type: 'snapshot',
        status,
        runId,
        events: [...events],
        summary,
      };
    },

    subscribe(listener: (event: SyncEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSync } from './orchestrator';
import type { SyncEvent, SyncSummary, SyncIO, SyncAdapters } from './types';
import { silentLogger } from '../logger';
import { ConfigSchema, type RawGameData, type UnifiedGame } from '../types/game';
import type { GamePassGame } from '../adapters/gamepass.adapter';
import type { SyncOperations } from '../notion/sync-logger';

const makeConfig = () =>
  ConfigSchema.parse({
    steam: { apiKey: 'steam-key', userId: 'steam-user' },
    notion: { apiKey: 'notion-key', databaseId: 'db-id' },
    protondb: {},
    heroic: { storeCachePath: '/tmp/heroic-store-cache' },
  });

const makeCatalog = (): GamePassGame[] => [
  { id: 'gp-hades', title: 'Hades', available: true },
  { id: 'gp-celeste', title: 'Celeste', available: true },
  { id: 'gp-removed', title: 'Old Game', available: false },
];

const makeRawGames = (): RawGameData[] => [
  { source: 'steam', externalId: 's1', name: 'Portal', steamAppId: 400, playtimeHours: 5 },
  { source: 'steam', externalId: 's2', name: 'Hades', steamAppId: 1145360 },
  { source: 'gog', externalId: 'g1', name: 'Celeste' },
];

const makeEmptyOps = (): SyncOperations => ({
  added: [],
  updated: [],
  removed: [],
  skippedCount: 0,
  errorCount: 0,
});

type Harness = {
  io: SyncIO;
  events: SyncEvent[];
  adapters: {
    notion: { verifyDatabase: ReturnType<typeof vi.fn>; syncGames: ReturnType<typeof vi.fn> };
    igdb: { findSteamAppId: ReturnType<typeof vi.fn>; getCacheStats: ReturnType<typeof vi.fn> };
    protonDb: { init: ReturnType<typeof vi.fn>; fetchCompatibility: ReturnType<typeof vi.fn> };
    fetchSteamGames: ReturnType<typeof vi.fn>;
    loadLibrarySources: ReturnType<typeof vi.fn>;
    gamePass: { getCatalog: ReturnType<typeof vi.fn>; isGameAvailable: ReturnType<typeof vi.fn> };
  };
  ioSpies: {
    loadConfig: ReturnType<typeof vi.fn>;
    loadOverrides: ReturnType<typeof vi.fn>;
    initAdapters: ReturnType<typeof vi.fn>;
    loadInterests: ReturnType<typeof vi.fn>;
    saveMergeSuggestions: ReturnType<typeof vi.fn>;
    saveLibrarySnapshot: ReturnType<typeof vi.fn>;
    writeGamesToDb: ReturnType<typeof vi.fn>;
    processGamePassAvailability: ReturnType<typeof vi.fn>;
    saveUnavailableGames: ReturnType<typeof vi.fn>;
    persistAvailability: ReturnType<typeof vi.fn>;
  };
};

const makeHarness = (overrides: Partial<SyncIO> = {}): Harness => {
  const events: SyncEvent[] = [];

  const notion = {
    verifyDatabase: vi.fn().mockResolvedValue(true),
    syncGames: vi
      .fn()
      .mockImplementation(
        async (
          games: UnifiedGame[],
          _titles?: Set<string>,
          onProgress?: (p: { current: number; total: number }) => void,
        ) => {
          onProgress?.({ current: games.length, total: games.length });
          const ops = makeEmptyOps();
          ops.removed.push('Gone Game');
          ops.skippedCount = 2;
          return ops;
        },
      ),
  };
  const igdb = {
    initialize: vi.fn().mockResolvedValue(undefined),
    findSteamAppId: vi.fn().mockResolvedValue(504230),
    getCacheStats: vi.fn().mockReturnValue({
      totalEntries: 10,
      foundEntries: 7,
      notFoundEntries: 3,
      retriableEntries: 0,
    }),
  };
  const protonDb = {
    init: vi.fn().mockResolvedValue(undefined),
    fetchCompatibility: vi.fn().mockResolvedValue(null),
  };
  const gamePass = {
    getCatalog: vi.fn().mockResolvedValue(makeCatalog()),
    isGameAvailable: vi.fn().mockResolvedValue(true),
  };
  const fetchSteamGames = vi.fn().mockResolvedValue(makeRawGames());
  const loadLibrarySources = vi.fn().mockResolvedValue([]);

  const adapters: SyncAdapters = {
    protonDb,
    igdb,
    gamePass,
    notion,
    fetchSteamGames,
    loadLibrarySources,
  };

  const ioSpies = {
    loadConfig: vi.fn().mockReturnValue(makeConfig()),
    loadOverrides: vi.fn().mockResolvedValue({
      forceMerge: [{ games: ['A', 'B'], canonicalName: 'A' }],
      propertyOverrides: [],
    }),
    initAdapters: vi.fn().mockResolvedValue(adapters),
    loadInterests: vi.fn().mockResolvedValue(['Celeste']),
    saveMergeSuggestions: vi.fn().mockResolvedValue(undefined),
    saveLibrarySnapshot: vi.fn().mockResolvedValue(undefined),
    writeGamesToDb: vi.fn().mockResolvedValue({ path: '/tmp/gamekeeper.db', added: 2, updated: 1 }),
    processGamePassAvailability: vi.fn().mockResolvedValue({
      unavailable: [{ name: 'Old Game', reason: 'left-catalog' as const }],
      returned: ['hades'],
    }),
    saveUnavailableGames: vi.fn().mockResolvedValue(undefined),
    persistAvailability: vi.fn().mockResolvedValue({ flagged: 1, cleared: 0 }),
  };

  const io: SyncIO = { ...ioSpies, ...overrides } as SyncIO;
  return { io, events, adapters: { notion, igdb, protonDb, fetchSteamGames, loadLibrarySources, gamePass }, ioSpies };
};

const run = (h: Harness, options: Parameters<typeof runSync>[0] = {}) =>
  runSync(options, {
    logger: silentLogger,
    emit: event => h.events.push(event),
    io: h.io,
  });

type StepEvent = Extract<SyncEvent, { label: string }>;

const eventKeys = (events: SyncEvent[]) =>
  events.map(e => ('key' in e ? `${e.type}:${e.key}` : e.type));

const findStep = (
  events: SyncEvent[],
  type: 'step:start' | 'step:done' | 'step:skip' | 'step:error',
  key: string,
): StepEvent | undefined =>
  events.find(
    (e): e is StepEvent => e.type === type && 'key' in e && e.key === key,
  );

describe('runSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits the full happy-path event sequence with progress and summary', async () => {
    const h = makeHarness();
    const summary = await run(h);

    expect(eventKeys(h.events)).toEqual([
      'step:start:config',
      'step:done:config',
      'step:start:overrides',
      'step:done:overrides',
      'step:start:adapters',
      'step:done:adapters',
      'step:start:notion-verify',
      'step:done:notion-verify',
      'step:start:steam',
      'step:done:steam',
      'step:start:gamepass-catalog',
      'step:done:gamepass-catalog',
      'step:start:interests',
      'step:done:interests',
      'step:start:library',
      'step:done:library',
      'step:start:interest-games',
      'step:done:interest-games',
      'step:start:dedupe',
      'step:done:dedupe',
      'step:start:suggestions',
      'step:done:suggestions',
      'step:start:igdb-lookup',
      'progress:igdb-lookup',
      'step:done:igdb-lookup',
      'step:start:protondb',
      'progress:protondb',
      'step:done:protondb',
      'step:start:notion',
      'progress:notion',
      'step:done:notion',
      'step:start:snapshot',
      'step:done:snapshot',
      'step:start:db-write',
      'step:done:db-write',
      'step:start:availability',
      'step:done:availability',
      'summary',
    ]);

    expect(h.events.at(-1)).toEqual({ type: 'summary', summary });
    expect(summary.added).toBe(2);
    expect(summary.updated).toBe(1);
    expect(summary.removed).toBe(1);
    expect(summary.skipped).toBe(2);
    expect(summary.errors).toBe(0);
    expect(summary.duration).toBeGreaterThanOrEqual(0);
  });

  it('emits step details for counts', async () => {
    const h = makeHarness();
    await run(h);

    const detail = (type: 'step:start' | 'step:done' | 'step:skip' | 'step:error', key: string) =>
      findStep(h.events, type, key)?.detail;

    expect(detail('step:done', 'overrides')).toBe('1 rules');
    expect(detail('step:done', 'steam')).toBe('3 games');
    expect(detail('step:done', 'gamepass-catalog')).toBe('3 games');
    expect(detail('step:done', 'interests')).toBe('1 games');
    expect(detail('step:done', 'dedupe')).toBe('3 unique');
    expect(detail('step:done', 'db-write')).toBe('2 added, 1 updated');
    expect(detail('step:done', 'notion')).toBe('0 added, 0 updated');
  });

  it('emits progress events with current/total', async () => {
    const h = makeHarness();
    await run(h);

    const progress = h.events.filter(
      (e): e is Extract<SyncEvent, { type: 'progress' }> => e.type === 'progress',
    );

    expect(progress).toContainEqual({ type: 'progress', key: 'igdb-lookup', current: 1, total: 1 });
    expect(progress).toContainEqual({ type: 'progress', key: 'protondb', current: 3, total: 3 });
    expect(progress).toContainEqual({ type: 'progress', key: 'notion', current: 3, total: 3 });
  });

  it('skipNotion skips notion-verify and notion steps and never calls syncGames', async () => {
    const h = makeHarness();
    const summary = await run(h, { skipNotion: true });

    const skips = h.events.filter(e => e.type === 'step:skip');
    expect(skips.map(e => ('key' in e ? e.key : ''))).toEqual(['notion-verify', 'notion']);
    expect(h.adapters.notion.verifyDatabase).not.toHaveBeenCalled();
    expect(h.adapters.notion.syncGames).not.toHaveBeenCalled();
    expect(summary.removed).toBe(0);
    expect(summary.skipped).toBe(0);
  });

  it('passes dryRun through to adapters via config', async () => {
    const h = makeHarness();
    await run(h, { dryRun: true });

    const config = h.ioSpies.initAdapters.mock.calls[0][0];
    expect(config.dryRun).toBe(true);
  });

  it('continues after a non-fatal Steam failure and reports the error', async () => {
    const h = makeHarness({
      // fetchSteamGames lives on adapters, not io — override via initAdapters
    });
    h.adapters.fetchSteamGames.mockRejectedValue(new Error('steam down'));

    const summary = await run(h);

    const steamError = findStep(h.events, 'step:error', 'steam');
    expect(steamError).toBeDefined();
    expect(summary.errors).toBe(1);
    // run still completes through db-write + summary
    expect(eventKeys(h.events)).toContain('step:done:db-write');
    expect(eventKeys(h.events).at(-1)).toBe('summary');
  });

  it('continues after a non-fatal library failure', async () => {
    const h = makeHarness();
    h.adapters.loadLibrarySources.mockRejectedValue(new Error('heroic missing'));

    const summary = await run(h);

    expect(findStep(h.events, 'step:error', 'library')).toBeDefined();
    expect(summary.errors).toBe(1);
    // interest-games still runs (interests are loaded independently)
    expect(eventKeys(h.events)).toContain('step:done:interest-games');
    expect(eventKeys(h.events).at(-1)).toBe('summary');
    // availability is skipped (libraryOk=false) — never touch DB flags
    expect(eventKeys(h.events)).toContain('step:skip:availability');
    expect(h.ioSpies.persistAvailability).not.toHaveBeenCalled();
  });

  it('persists availability to the DB keyed by canonical id (even when empty)', async () => {
    const h = makeHarness();
    await run(h);

    expect(h.ioSpies.persistAvailability).toHaveBeenCalledTimes(1);
    expect(h.ioSpies.persistAvailability).toHaveBeenCalledWith([
      { name: 'Old Game', reason: 'left-catalog' },
    ]);
    expect(h.ioSpies.saveUnavailableGames).toHaveBeenCalledWith([
      { name: 'Old Game', reason: 'left-catalog' },
    ]);
  });

  it('clears DB availability flags when everything is available again', async () => {
    const h = makeHarness({
      processGamePassAvailability: vi.fn().mockResolvedValue({
        unavailable: [],
        returned: ['hades'],
      }),
    });
    h.ioSpies.persistAvailability.mockResolvedValue({ flagged: 0, cleared: 3 });

    await run(h);

    expect(h.ioSpies.persistAvailability).toHaveBeenCalledWith([]);
    expect(h.ioSpies.saveUnavailableGames).not.toHaveBeenCalled();
  });

  it('aborts on Notion verify failure: step:error, summary emitted, then throws', async () => {
    const h = makeHarness();
    h.adapters.notion.verifyDatabase.mockResolvedValue(false);

    await expect(run(h)).rejects.toThrow(/Cannot access Notion database/);

    const errorEvent = findStep(h.events, 'step:error', 'notion-verify');
    expect(errorEvent).toBeDefined();
    const last = h.events.at(-1)!;
    expect(last.type).toBe('summary');
    expect((last as { summary: SyncSummary }).summary.errors).toBe(1);
    // nothing after verify ran
    expect(eventKeys(h.events)).not.toContain('step:start:steam');
  });

  it('aborts on db-write failure with summary before rethrowing', async () => {
    const h = makeHarness();
    h.ioSpies.writeGamesToDb.mockRejectedValue(new Error('disk full'));

    await expect(run(h)).rejects.toThrow(/disk full/);

    expect(findStep(h.events, 'step:error', 'db-write')).toBeDefined();
    expect(h.events.at(-1)!.type).toBe('summary');
    expect(eventKeys(h.events)).not.toContain('step:start:availability');
  });

  it('early-exits with a summary when no games are found from any source', async () => {
    const h = makeHarness({ loadInterests: vi.fn().mockResolvedValue(null) });
    h.adapters.fetchSteamGames.mockRejectedValue(new Error('steam down'));
    h.adapters.loadLibrarySources.mockRejectedValue(new Error('heroic down'));

    const summary = await run(h);

    expect(eventKeys(h.events)).not.toContain('step:start:dedupe');
    expect(summary.added).toBe(0);
    expect(summary.errors).toBe(2);
    expect(h.events.at(-1)!.type).toBe('summary');
  });

  it('marks interests as skipped when the interests file is missing', async () => {
    const h = makeHarness({ loadInterests: vi.fn().mockResolvedValue(null) });
    await run(h);

    const skip = findStep(h.events, 'step:skip', 'interests');
    expect(skip).toBeDefined();
  });

  it('adds interest games not already played and merges them during dedupe', async () => {
    const h = makeHarness();
    const summary = await run(h);

    const interestDone = findStep(h.events, 'step:done', 'interest-games');
    // "Celeste" is in the catalog and already in the library (gog) — still listed
    // as an interest, so it is added (merge target) rather than skipped
    expect(interestDone?.detail).toBe('1 games added');
    expect(summary.added + summary.updated).toBe(3);
  });

  it('restores the previous logger after the run', async () => {
    const before = silentLogger;
    const h = makeHarness();
    await run(h);
    const { getLogger } = await import('../logger');
    expect(getLogger()).toBe(before);
  });
});

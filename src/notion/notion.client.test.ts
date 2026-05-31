import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNotionClient } from './notion.client';

// ── Hoisted mocks (must be defined before vi.mock calls) ──────────────────────

const { mockCreate, mockUpdate, mockQuery, mockRetrieve } = vi.hoisted(() => ({
  mockCreate: vi.fn().mockResolvedValue({}),
  mockUpdate: vi.fn().mockResolvedValue({}),
  mockQuery: vi.fn(),
  mockRetrieve: vi.fn().mockResolvedValue({}),
}));

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('@notionhq/client', () => ({
  Client: vi.fn().mockImplementation(function () {
    return {
      pages: { create: mockCreate, update: mockUpdate },
      databases: { query: mockQuery, retrieve: mockRetrieve },
    };
  }),
}));

vi.mock('../config', () => ({
  getConfig: () => ({ logLevel: 'info' }),
}));

vi.mock('../core/overrides', () => ({
  getCanonicalNameFromVariant: () => null,
}));

vi.mock('./sync-logger', () => ({
  default: {
    createSyncTracker: () => ({
      operations: {
        added: [],
        updated: [],
        removed: [],
        skippedCount: 0,
        errorCount: 0,
      },
      startTime: Date.now(),
    }),
    trackAdded: vi.fn(),
    trackUpdated: vi.fn(),
    trackSkipped: vi.fn(),
    trackRemoved: vi.fn(),
    trackError: vi.fn(),
    printSyncSummary: vi.fn(),
    saveSyncLog: vi.fn().mockResolvedValue('/tmp/sync.log'),
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

const makeNotionPage = (
  title: string,
  libraryStatus?: string,
): { id: string; properties: any } => ({
  id: `page-${title.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
  properties: {
    Name: { title: [{ text: { content: title } }] },
    'Canonical ID': { rich_text: [] },
    'Library Status': {
      select: libraryStatus ? { name: libraryStatus } : null,
    },
    'Primary Source': { select: { name: 'Game Pass' } },
    'Owned On': { multi_select: [{ name: 'Game Pass' }] },
    'Steam App ID': { number: null },
    'Playtime (hours)': { number: null },
    'Last Played': { date: null },
    'Proton Tier': { select: null },
    'Steam Deck': { select: null },
    'Cover Image': { url: null },
  },
});

const mockQueryResponse = (pages: ReturnType<typeof makeNotionPage>[]) => {
  mockQuery.mockResolvedValue({
    results: pages,
    next_cursor: null,
    has_more: false,
  });
};

const syncProperties = {
  canonicalId: true,
  primarySource: true,
  ownedOn: true,
  steamAppId: true,
  playtime: true,
  lastPlayed: true,
  protonTier: true,
  steamDeck: true,
  coverImage: true,
  libraryStatus: true,
};

const makeClient = () =>
  createNotionClient('fake-key', 'fake-db', 'Name', syncProperties);

const makeDryRunClient = () =>
  createNotionClient('fake-key', 'fake-db', 'Name', syncProperties, true);

const makeUnifiedGame = (
  name: string,
  overrides: Partial<ReturnType<typeof Object.assign>> = {},
) => ({
  canonicalId: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
  name,
  primarySource: 'steam' as const,
  ownedSources: ['steam' as const],
  playtimeHours: 10,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('notion.client - markRemovedGames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT mark a page removed when game is removed from interests but still in Game Pass catalog', async () => {
    mockQueryResponse([makeNotionPage('Starfield')]);

    const catalogTitles = new Set(['starfield']); // still in catalog
    await makeClient().syncGames([], catalogTitles); // not in sync (removed from interests)

    const removedCalls = mockUpdate.mock.calls.filter(
      (args: any[]) =>
        args[0]?.properties?.['Library Status']?.select?.name === '⚠️ Removed',
    );
    expect(removedCalls).toHaveLength(0);
  });

  it('marks a page removed when game left the Game Pass catalog', async () => {
    mockQueryResponse([makeNotionPage('Starfield')]);

    const catalogTitles = new Set<string>(); // game not in catalog
    await makeClient().syncGames([], catalogTitles);

    const removedCalls = mockUpdate.mock.calls.filter(
      (args: any[]) =>
        args[0]?.properties?.['Library Status']?.select?.name === '⚠️ Removed',
    );
    expect(removedCalls).toHaveLength(1);
    expect(removedCalls[0][0].page_id).toBe('page-starfield');
  });

  it('clears removed status when a previously-removed game returns to the Game Pass catalog', async () => {
    mockQueryResponse([makeNotionPage('Starfield', '⚠️ Removed')]);

    const catalogTitles = new Set(['starfield']); // game back in catalog
    await makeClient().syncGames([], catalogTitles);

    const clearCalls = mockUpdate.mock.calls.filter(
      (args: any[]) => args[0]?.properties?.['Library Status']?.select === null,
    );
    expect(clearCalls).toHaveLength(1);
    expect(clearCalls[0][0].page_id).toBe('page-starfield');
  });

  it('marks a page removed when no Game Pass catalog is provided (fallback to original behaviour)', async () => {
    mockQueryResponse([makeNotionPage('Starfield')]);

    await makeClient().syncGames([], undefined); // no catalog info

    const removedCalls = mockUpdate.mock.calls.filter(
      (args: any[]) =>
        args[0]?.properties?.['Library Status']?.select?.name === '⚠️ Removed',
    );
    expect(removedCalls).toHaveLength(1);
  });

  it('uses normalisation when matching game titles against the catalog', async () => {
    // Notion page title has trademark symbol; catalog Set uses normalized form
    mockQueryResponse([makeNotionPage('Hi-Fi RUSH™')]);

    const catalogTitles = new Set(['hi fi rush']); // normalized form
    await makeClient().syncGames([], catalogTitles);

    const removedCalls = mockUpdate.mock.calls.filter(
      (args: any[]) =>
        args[0]?.properties?.['Library Status']?.select?.name === '⚠️ Removed',
    );
    expect(removedCalls).toHaveLength(0);
  });
});

// ── Dry-run tests ──────────────────────────────────────────────────────────────

describe('notion.client - dry-run mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not create a page for a new game', async () => {
    mockQueryResponse([]); // Notion is empty

    await makeDryRunClient().syncGames([makeUnifiedGame('Starfield')]);

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does not update a page when a game has changed properties', async () => {
    const page = {
      ...makeNotionPage('Starfield'),
      properties: {
        ...makeNotionPage('Starfield').properties,
        'Playtime (hours)': { number: 5 }, // old playtime
      },
    };
    mockQueryResponse([page]);

    // Same game but with updated playtime — would trigger an update in normal mode
    await makeDryRunClient().syncGames([
      makeUnifiedGame('Starfield', { playtimeHours: 20 }),
    ]);

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not mark a removed game as removed', async () => {
    mockQueryResponse([makeNotionPage('Starfield')]); // exists in Notion

    // Sync with empty list — Starfield is no longer in the library
    await makeDryRunClient().syncGames([], new Set());

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not restore the status of a Game Pass game that returned to the catalog', async () => {
    mockQueryResponse([makeNotionPage('Starfield', '⚠️ Removed')]);

    const catalogTitles = new Set(['starfield']); // back in catalog
    await makeDryRunClient().syncGames([], catalogTitles);

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('makes no write calls at all across a mixed batch', async () => {
    // One existing game with no changes, one with changes, one brand new
    const existingUnchanged = {
      ...makeNotionPage('Elden Ring'),
      properties: {
        ...makeNotionPage('Elden Ring').properties,
        'Primary Source': { select: { name: 'Steam' } },
        'Owned On': { multi_select: [{ name: 'Steam' }] },
        'Playtime (hours)': { number: 10 },
      },
    };
    const existingChanged = {
      ...makeNotionPage('The Witcher 3'),
      properties: {
        ...makeNotionPage('The Witcher 3').properties,
        'Playtime (hours)': { number: 1 }, // outdated
      },
    };
    mockQueryResponse([existingUnchanged, existingChanged]);

    await makeDryRunClient().syncGames([
      makeUnifiedGame('Elden Ring'), // unchanged → skipped
      makeUnifiedGame('The Witcher 3', { playtimeHours: 50 }), // changed → would update
      makeUnifiedGame('Cyberpunk 2077'), // new → would create
      // 'Starfield' not included → would be removed
    ]);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ── Title normalisation lookup tests ──────────────────────────────────────────

describe('notion.client - title normalisation in lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds an existing Notion page when game title uses a different apostrophe variant', async () => {
    // Notion page stored with U+0027 straight apostrophe (e.g. created via GOG source)
    const existingPage = makeNotionPage(
      'Shadowrun: Dragonfall - Director\u0027s Cut',
    );
    mockQueryResponse([existingPage]);

    // Game arriving from Epic source with U+2019 curly apostrophe
    const game = makeUnifiedGame(
      'Shadowrun: Dragonfall - Director\u2019s Cut',
      {
        ownedSources: ['epic' as const],
        primarySource: 'epic' as const,
        playtimeHours: undefined,
      },
    );

    const client = makeClient();
    await client.syncGames([game]);

    // Should UPDATE (not create) because the normalised title lookup should match
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does not flag a game for removal when its title uses a different apostrophe variant', async () => {
    // Same scenario — existing page has straight apostrophe, game has curly apostrophe
    const existingPage = makeNotionPage(
      'Shadowrun: Dragonfall - Director\u0027s Cut',
    );
    mockQueryResponse([existingPage]);

    const game = makeUnifiedGame(
      'Shadowrun: Dragonfall - Director\u2019s Cut',
      {
        ownedSources: ['epic' as const],
        primarySource: 'epic' as const,
        playtimeHours: undefined,
      },
    );

    const client = makeClient();
    await client.syncGames([game]);

    // The existing page should be considered processed — NOT marked as removed
    const updateCalls = mockUpdate.mock.calls;
    const removedCalls = updateCalls.filter(
      ([_id, body]) =>
        body?.properties?.['Library Status']?.select?.name === '⚠️ Removed',
    );
    expect(removedCalls).toHaveLength(0);
  });
});

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

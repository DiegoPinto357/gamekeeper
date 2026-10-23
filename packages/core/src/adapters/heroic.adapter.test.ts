import { describe, it, expect, vi, beforeEach } from 'vitest';
import { heroicAdapter } from './heroic.adapter';

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: { readFile: mockReadFile },
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────

const makeGogLibrary = (games: object[]) =>
  JSON.stringify({ games, __timestamp: 0 });

const makeEpicLibrary = (games: object[]) =>
  JSON.stringify({ library: games, __timestamp: 0 });

const makeAmazonLibrary = (games: object[]) =>
  JSON.stringify({ library: games, __timestamp: 0 });

const makeGogApiInfo = (entries: Record<string, unknown>) =>
  JSON.stringify({ ...entries, __timestamp: 0 });

const gogGame = (overrides = {}) => ({
  app_name: 'gog-123',
  title: 'Fallout 2',
  runner: 'gog',
  art_cover: 'https://example.com/cover.jpg',
  install: { is_dlc: false },
  extra: { genres: ['RPG'] },
  ...overrides,
});

const epicGame = (overrides = {}) => ({
  app_name: 'epic-abc',
  title: 'Mortal Shell',
  runner: 'epic',
  art_cover: 'https://example.com/epic.jpg',
  install: { is_dlc: false },
  extra: {},
  ...overrides,
});

const amazonGame = (overrides = {}) => ({
  app_name: 'amzn1.adg.product.xxx',
  title: 'Grime',
  runner: 'nile',
  art_cover: 'https://example.com/amzn.jpg',
  install: {},
  extra: { genres: ['Action'], releaseDate: '2021-08-02T00:00:00Z' },
  ...overrides,
});

const CACHE_PATH = '/fake/heroic/store_cache';

// Helper: make readFile return different content per path
const mockLibraries = ({
  gog = [gogGame()],
  epic = [epicGame()],
  amazon = [amazonGame()],
  gogApiInfo,
}: {
  gog?: object[];
  epic?: object[];
  amazon?: object[];
  gogApiInfo?: Record<string, unknown>;
} = {}) => {
  mockReadFile.mockImplementation((filePath: string) => {
    if (filePath.endsWith('gog_library.json'))
      return Promise.resolve(makeGogLibrary(gog));
    if (filePath.endsWith('legendary_library.json'))
      return Promise.resolve(makeEpicLibrary(epic));
    if (filePath.endsWith('nile_library.json'))
      return Promise.resolve(makeAmazonLibrary(amazon));
    if (filePath.endsWith('gog_api_info.json'))
      return gogApiInfo !== undefined
        ? Promise.resolve(makeGogApiInfo(gogApiInfo))
        : Promise.reject(
            Object.assign(new Error('Not found'), { code: 'ENOENT' }),
          );
    return Promise.reject(
      Object.assign(new Error('Not found'), { code: 'ENOENT' }),
    );
  });
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('heroicAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('field mapping', () => {
    it('maps GOG game fields correctly', async () => {
      mockLibraries({ epic: [], amazon: [] });

      const games = await heroicAdapter.loadAllLibraries(CACHE_PATH);

      expect(games).toHaveLength(1);
      expect(games[0]).toMatchObject({
        source: 'gog',
        externalId: 'gog-123',
        name: 'Fallout 2',
        coverImageUrl: 'https://example.com/cover.jpg',
        genres: ['RPG'],
      });
    });

    it('maps Epic game fields correctly', async () => {
      mockLibraries({ gog: [], amazon: [] });

      const games = await heroicAdapter.loadAllLibraries(CACHE_PATH);

      expect(games).toHaveLength(1);
      expect(games[0]).toMatchObject({
        source: 'epic',
        externalId: 'epic-abc',
        name: 'Mortal Shell',
        coverImageUrl: 'https://example.com/epic.jpg',
      });
    });

    it('maps Amazon game fields correctly including releaseDate', async () => {
      mockLibraries({ gog: [], epic: [] });

      const games = await heroicAdapter.loadAllLibraries(CACHE_PATH);

      expect(games).toHaveLength(1);
      expect(games[0]).toMatchObject({
        source: 'amazon',
        externalId: 'amzn1.adg.product.xxx',
        name: 'Grime',
        genres: ['Action'],
      });
      expect(games[0].releaseDate).toBeInstanceOf(Date);
      expect(games[0].releaseDate?.getFullYear()).toBe(2021);
    });

    it('sets genres to undefined when extra.genres is absent', async () => {
      mockLibraries({ gog: [gogGame({ extra: {} })], epic: [], amazon: [] });

      const games = await heroicAdapter.loadAllLibraries(CACHE_PATH);

      expect(games[0].genres).toBeUndefined();
    });

    it('sets releaseDate to undefined when extra.releaseDate is absent', async () => {
      mockLibraries({
        gog: [],
        epic: [],
        amazon: [amazonGame({ extra: { genres: [] } })],
      });

      const games = await heroicAdapter.loadAllLibraries(CACHE_PATH);

      expect(games[0].releaseDate).toBeUndefined();
    });

    it('never includes playtimeHours or lastPlayedAt', async () => {
      mockLibraries();

      const games = await heroicAdapter.loadAllLibraries(CACHE_PATH);

      for (const game of games) {
        expect(game.playtimeHours).toBeUndefined();
        expect(game.lastPlayedAt).toBeUndefined();
      }
    });
  });

  describe('local metadata harvest (P3.1)', () => {
    it('maps GOG description from extra.about.description', async () => {
      mockLibraries({
        gog: [
          gogGame({
            extra: {
              about: { description: 'A turn-based tactical Western RPG.' },
            },
          }),
        ],
        epic: [],
        amazon: [],
      });

      const games = await heroicAdapter.loadAllLibraries(CACHE_PATH);

      expect(games[0].description).toBe('A turn-based tactical Western RPG.');
    });

    it('merges GOG genres/developer/publisher/releaseDate from gog_api_info by id', async () => {
      mockLibraries({
        gog: [gogGame({ extra: {} })],
        epic: [],
        amazon: [],
        gogApiInfo: {
          'gog_gog-123': {
            first_release_date: '1998-09-30T00:00:00+0000',
            game: {
              genres: [
                { name: { '*': 'Role-playing (RPG)', 'en-US': 'Role-playing (RPG)' } },
              ],
              developers: [{ name: 'Black Isle Studios' }],
              publishers: [{ name: 'Interplay Entertainment' }],
            },
          },
          '__timestamp.gog_gog-123': 123,
        },
      });

      const games = await heroicAdapter.loadAllLibraries(CACHE_PATH);

      expect(games[0].genres).toEqual(['Role-playing (RPG)']);
      expect(games[0].developer).toBe('Black Isle Studios');
      expect(games[0].publisher).toBe('Interplay Entertainment');
      expect(games[0].releaseDate).toBeInstanceOf(Date);
      expect(games[0].releaseDate?.getFullYear()).toBe(1998);
    });

    it('falls back to library extra.genres when gog_api_info is absent', async () => {
      mockLibraries({
        gog: [gogGame({ extra: { genres: ['RPG'] } })],
        epic: [],
        amazon: [],
      });

      const games = await heroicAdapter.loadAllLibraries(CACHE_PATH);

      expect(games[0].genres).toEqual(['RPG']);
      expect(games[0].developer).toBeUndefined();
    });

    it('maps Epic developer and description from extra.about', async () => {
      mockLibraries({
        gog: [],
        epic: [
          epicGame({
            developer: 'Moon Studios',
            extra: {
              about: {
                description: 'A fast-action isometric roguelike.',
                shortDescription: '',
              },
            },
          }),
        ],
        amazon: [],
      });

      const games = await heroicAdapter.loadAllLibraries(CACHE_PATH);

      expect(games[0].developer).toBe('Moon Studios');
      expect(games[0].description).toBe('A fast-action isometric roguelike.');
    });

    it('maps Amazon description and developer', async () => {
      mockLibraries({
        gog: [],
        epic: [],
        amazon: [
          amazonGame({
            description: 'A hand-drawn action-adventure.',
            developer: 'Team Cherry',
          }),
        ],
      });

      const games = await heroicAdapter.loadAllLibraries(CACHE_PATH);

      expect(games[0].description).toBe('A hand-drawn action-adventure.');
      expect(games[0].developer).toBe('Team Cherry');
    });
  });

  describe('DLC filtering', () => {
    it('filters out GOG DLCs', async () => {
      mockLibraries({
        gog: [
          gogGame(),
          gogGame({
            app_name: 'gog-dlc',
            title: 'Fallout 2 DLC',
            install: { is_dlc: true },
          }),
        ],
        epic: [],
        amazon: [],
      });

      const games = await heroicAdapter.loadAllLibraries(CACHE_PATH);

      expect(games).toHaveLength(1);
      expect(games[0].name).toBe('Fallout 2');
    });

    it('filters out Epic DLCs', async () => {
      mockLibraries({
        gog: [],
        epic: [
          epicGame(),
          epicGame({
            app_name: 'epic-dlc',
            title: 'Season Pass',
            install: { is_dlc: true },
          }),
        ],
        amazon: [],
      });

      const games = await heroicAdapter.loadAllLibraries(CACHE_PATH);

      expect(games).toHaveLength(1);
      expect(games[0].name).toBe('Mortal Shell');
    });

    it('includes all Amazon entries (no DLC flag)', async () => {
      mockLibraries({
        gog: [],
        epic: [],
        amazon: [
          amazonGame(),
          amazonGame({ app_name: 'amzn2', title: 'Another Game' }),
        ],
      });

      const games = await heroicAdapter.loadAllLibraries(CACHE_PATH);

      expect(games).toHaveLength(2);
    });
  });

  describe('error handling', () => {
    it('returns empty array for a missing GOG library file', async () => {
      mockReadFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith('gog_library.json'))
          return Promise.reject(
            Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
          );
        if (filePath.endsWith('legendary_library.json'))
          return Promise.resolve(makeEpicLibrary([epicGame()]));
        if (filePath.endsWith('nile_library.json'))
          return Promise.resolve(makeAmazonLibrary([]));
      });

      const games = await heroicAdapter.loadAllLibraries(CACHE_PATH);

      expect(games).toHaveLength(1);
      expect(games[0].source).toBe('epic');
    });

    it('returns empty array for all stores when all files are missing', async () => {
      mockReadFile.mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      );

      const games = await heroicAdapter.loadAllLibraries(CACHE_PATH);

      expect(games).toHaveLength(0);
    });

    it('combines games from all three stores', async () => {
      mockLibraries();

      const games = await heroicAdapter.loadAllLibraries(CACHE_PATH);

      expect(games).toHaveLength(3);
      expect(games.map(g => g.source)).toEqual(
        expect.arrayContaining(['gog', 'epic', 'amazon']),
      );
    });
  });
});

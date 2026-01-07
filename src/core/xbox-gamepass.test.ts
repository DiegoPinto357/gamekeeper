import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadOwnedXboxGames,
  loadGamePassInterests,
  isOwnedOnXbox,
  isInInterests,
  isAvailableOnGamePass,
  processGamePassAvailability,
  resolveXboxSource,
  shouldSyncToNotion,
  getInterestGamesToSync,
} from './xbox-gamepass';
import { RawGameData, Source } from '../types/game';
import { GamePassGame } from '../adapters/gamepass.adapter';
import fs from 'fs/promises';

vi.mock('fs/promises');

const createGame = (
  name: string,
  source: Source,
  options: Partial<RawGameData> = {}
): RawGameData => ({
  name,
  source,
  externalId: `${source}-${name.toLowerCase().replace(/\s+/g, '-')}`,
  ...options,
});

const createGamePassGame = (
  title: string,
  available: boolean = true
): GamePassGame => ({
  id: title.toLowerCase().replace(/\s+/g, '-'),
  title,
  available,
});

describe('xbox-gamepass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadOwnedXboxGames', () => {
    it('loads and normalizes owned Xbox games', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          ownedGames: ['Halo Infinite', 'Forza Horizon 5'],
        })
      );

      const owned = await loadOwnedXboxGames();

      expect(owned.has('halo infinite')).toBe(true);
      expect(owned.has('forza horizon 5')).toBe(true);
    });

    it('returns empty set on file read error', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));

      const owned = await loadOwnedXboxGames();

      expect(owned.size).toBe(0);
    });
  });

  describe('loadGamePassInterests', () => {
    it('loads and normalizes interest games', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          wantToPlay: ['Starfield', 'Hi-Fi RUSH'],
        })
      );

      const interests = await loadGamePassInterests();

      expect(interests.has('starfield')).toBe(true);
      expect(interests.has('hi fi rush')).toBe(true);
    });

    it('returns empty set on file read error', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));

      const interests = await loadGamePassInterests();

      expect(interests.size).toBe(0);
    });
  });

  describe('isOwnedOnXbox', () => {
    it('returns true for owned games', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          ownedGames: ['Halo Infinite'],
        })
      );

      expect(await isOwnedOnXbox('Halo Infinite')).toBe(true);
    });

    it('returns false for non-owned games', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          ownedGames: ['Halo Infinite'],
        })
      );

      expect(await isOwnedOnXbox('Starfield')).toBe(false);
    });
  });

  describe('isAvailableOnGamePass', () => {
    it('finds games in catalog by normalized name', async () => {
      const catalog = [
        createGamePassGame('Hollow Knight'),
        createGamePassGame('Starfield'),
      ];

      expect(await isAvailableOnGamePass('Hollow Knight', catalog)).toBe(true);
      expect(await isAvailableOnGamePass('Forza', catalog)).toBe(false);
    });

    it('handles name normalization', async () => {
      const catalog = [createGamePassGame('Hi-Fi RUSH')];

      expect(await isAvailableOnGamePass('Hi Fi RUSH', catalog)).toBe(true);
    });
  });

  describe('resolveXboxSource', () => {
    it('returns xbox for owned games', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          ownedGames: ['Halo Infinite'],
        })
      );

      const catalog = [createGamePassGame('Halo Infinite')];
      const source = await resolveXboxSource('Halo Infinite', catalog);

      expect(source).toBe('xbox');
    });

    it('returns gamepass for non-owned available games', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          ownedGames: [],
        })
      );

      const catalog = [createGamePassGame('Starfield')];
      const source = await resolveXboxSource('Starfield', catalog);

      expect(source).toBe('gamepass');
    });

    it('returns xbox for non-owned unavailable games', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          ownedGames: [],
        })
      );

      const catalog: GamePassGame[] = [];
      const source = await resolveXboxSource('Old Game', catalog);

      expect(source).toBe('xbox');
    });
  });

  describe('shouldSyncToNotion', () => {
    it('always syncs non-Xbox/GamePass games', async () => {
      const game = createGame('Portal 2', 'steam');

      expect(await shouldSyncToNotion(game, [])).toBe(true);
    });

    it('syncs owned Xbox games even if not on Game Pass', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          ownedGames: ['Halo Infinite'],
        })
      );

      const game = createGame('Halo Infinite', 'xbox');

      expect(await shouldSyncToNotion(game, [])).toBe(true);
    });

    it('syncs Game Pass games if available', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          ownedGames: [],
        })
      );

      const game = createGame('Starfield', 'gamepass');
      const catalog = [createGamePassGame('Starfield')];

      expect(await shouldSyncToNotion(game, catalog)).toBe(true);
    });

    it('does not sync non-owned Xbox games not on Game Pass', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          ownedGames: [],
        })
      );

      const game = createGame('Old Game', 'xbox');

      expect(await shouldSyncToNotion(game, [])).toBe(false);
    });
  });

  describe('processGamePassAvailability', () => {
    it('identifies played games that left Game Pass', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          ownedGames: [],
          unavailableGames: [],
          wantToPlay: [],
        })
      );

      const playedGames = [createGame('Old Game', 'xbox')];
      const catalog: GamePassGame[] = [];

      const result = await processGamePassAvailability(playedGames, catalog);

      expect(result.unavailable).toHaveLength(1);
      expect(result.unavailable[0].name).toBe('Old Game');
      expect(result.unavailable[0].reason).toBe('left-catalog');
      expect(result.unavailable[0].wasPlayed).toBe(true);
    });

    it('identifies interest games not on Game Pass', async () => {
      vi.mocked(fs.readFile).mockImplementation(path => {
        if (path.toString().includes('interests')) {
          return Promise.resolve(
            JSON.stringify({
              wantToPlay: ['Future Game'],
            })
          );
        }
        return Promise.resolve(
          JSON.stringify({
            ownedGames: [],
            unavailableGames: [],
          })
        );
      });

      const result = await processGamePassAvailability([], []);

      expect(result.unavailable).toHaveLength(1);
      expect(result.unavailable[0].name).toBe('future game');
      expect(result.unavailable[0].reason).toBe('interest-unavailable');
      expect(result.unavailable[0].wasPlayed).toBe(false);
    });

    it('tracks returned games', async () => {
      vi.mocked(fs.readFile).mockImplementation(path => {
        if (path.toString().includes('interests')) {
          return Promise.resolve(
            JSON.stringify({
              wantToPlay: ['Returned Game'],
            })
          );
        }
        if (path.toString().includes('unavailable')) {
          return Promise.resolve(
            JSON.stringify({
              unavailableGames: [
                {
                  name: 'Returned Game',
                  reason: 'left-catalog',
                  wasPlayed: true,
                },
              ],
              lastUpdated: new Date().toISOString(),
            })
          );
        }
        return Promise.resolve(
          JSON.stringify({
            ownedGames: [],
          })
        );
      });

      const catalog = [createGamePassGame('Returned Game')];

      const result = await processGamePassAvailability([], catalog);

      expect(result.returned).toContain('returned game');
    });
  });

  describe('getInterestGamesToSync', () => {
    it('returns interest games available on Game Pass', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          wantToPlay: ['Starfield', 'Unavailable Game'],
        })
      );

      const catalog = [createGamePassGame('Starfield')];
      const played: RawGameData[] = [];

      const result = await getInterestGamesToSync(catalog, played);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Starfield');
    });

    it('includes interest games even if already played', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          wantToPlay: ['Starfield'],
        })
      );

      const catalog = [createGamePassGame('Starfield')];
      const played = [createGame('Starfield', 'gamepass')];

      const result = await getInterestGamesToSync(catalog, played);

      expect(result).toHaveLength(1);
    });

    it('excludes unavailable interest games', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          wantToPlay: ['Not Available'],
        })
      );

      const result = await getInterestGamesToSync([], []);

      expect(result).toHaveLength(0);
    });
  });

  describe('Integration: Xbox/Game Pass tagging scenarios', () => {
    it('owned Xbox game available on Game Pass gets Xbox tag only', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          ownedGames: ['Halo Infinite'],
        })
      );

      const catalog = [createGamePassGame('Halo Infinite')];
      const source = await resolveXboxSource('Halo Infinite', catalog);

      expect(source).toBe('xbox');
    });

    it('played but not owned game on Game Pass gets gamepass tag', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          ownedGames: [],
        })
      );

      const game = createGame('Starfield', 'xbox');
      const catalog = [createGamePassGame('Starfield')];

      const shouldSync = await shouldSyncToNotion(game, catalog);
      expect(shouldSync).toBe(true);
    });

    it('played game left Game Pass and not owned does not sync', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          ownedGames: [],
        })
      );

      const game = createGame('Old Game', 'xbox');
      const catalog: GamePassGame[] = [];

      const shouldSync = await shouldSyncToNotion(game, catalog);
      expect(shouldSync).toBe(false);
    });
  });
});

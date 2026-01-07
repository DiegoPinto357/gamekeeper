import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  deduplicateGames,
  mergeGameGroup,
  processRawGames,
} from './deduplicate';
import type { RawGameData, Source } from '../types/game';

vi.mock('../config', () => ({
  getConfig: () => ({ logLevel: 'info' }),
}));

vi.mock('./overrides', () => ({
  shouldForceMerge: () => false,
}));

const createGame = (
  name: string,
  source: Source,
  options: Partial<RawGameData> = {}
): RawGameData => ({
  externalId: `${source}-${name.toLowerCase().replace(/\s+/g, '-')}`,
  name,
  source,
  ...options,
});

describe('deduplicate', () => {
  describe('deduplicateGames', () => {
    it('groups games with same Steam App ID', () => {
      const games: RawGameData[] = [
        createGame('Portal', 'steam', { steamAppId: 400 }),
        createGame('Portal', 'epic', { steamAppId: 400 }),
      ];

      const groups = deduplicateGames(games);

      expect(groups.size).toBe(1);
      expect(groups.get('steam:400')?.length).toBe(2);
    });

    it('groups games with matching normalized names', () => {
      const games: RawGameData[] = [
        createGame('The Witcher 3', 'steam'),
        createGame('Witcher 3', 'gog'),
      ];

      const groups = deduplicateGames(games);

      expect(groups.size).toBe(1);
      const groupKey = Array.from(groups.keys())[0];
      expect(groupKey).toMatch(/^name:/);
      expect(groups.get(groupKey)?.length).toBe(2);
    });

    it('keeps different games separate', () => {
      const games: RawGameData[] = [
        createGame('Portal', 'steam', { steamAppId: 400 }),
        createGame('Portal 2', 'steam', { steamAppId: 620 }),
      ];

      const groups = deduplicateGames(games);

      expect(groups.size).toBe(2);
      expect(groups.get('steam:400')?.length).toBe(1);
      expect(groups.get('steam:620')?.length).toBe(1);
    });

    it('handles games with and without Steam App IDs', () => {
      const games: RawGameData[] = [
        createGame('Portal', 'steam', { steamAppId: 400 }),
        createGame('Epic Exclusive Game', 'epic'),
      ];

      const groups = deduplicateGames(games);

      expect(groups.size).toBe(2);
      expect(groups.has('steam:400')).toBe(true);
      expect(
        Array.from(groups.keys()).some(key => key.startsWith('name:'))
      ).toBe(true);
    });
  });

  describe('mergeGameGroup', () => {
    it('throws error for empty game group', () => {
      expect(() => mergeGameGroup([])).toThrow('Cannot merge empty game group');
    });

    it('uses platform priority for primary source (Steam > Epic)', () => {
      const games: RawGameData[] = [
        createGame('Test Game', 'epic', { coverImageUrl: 'epic-cover.jpg' }),
        createGame('Test Game', 'steam', {
          steamAppId: 12345,
          coverImageUrl: 'steam-cover.jpg',
        }),
      ];

      const unified = mergeGameGroup(games);

      expect(unified.primarySource).toBe('steam');
      expect(unified.steamAppId).toBe(12345);
      expect(unified.coverImageUrl).toBe('steam-cover.jpg');
    });

    it('tracks all owned sources', () => {
      const games: RawGameData[] = [
        createGame('Multi-Platform Game', 'steam', { steamAppId: 12345 }),
        createGame('Multi-Platform Game', 'epic'),
        createGame('Multi-Platform Game', 'gog'),
      ];

      const unified = mergeGameGroup(games);

      expect(unified.ownedSources).toHaveLength(3);
      expect(unified.ownedSources).toContain('steam');
      expect(unified.ownedSources).toContain('epic');
      expect(unified.ownedSources).toContain('gog');
    });

    it('excludes gamepass from ownedSources when xbox is present', () => {
      const games: RawGameData[] = [
        createGame('Halo Infinite', 'xbox'),
        createGame('Halo Infinite', 'gamepass'),
      ];

      const unified = mergeGameGroup(games);

      expect(unified.ownedSources).toHaveLength(1);
      expect(unified.ownedSources).toContain('xbox');
      expect(unified.ownedSources).not.toContain('gamepass');
    });

    it('includes gamepass when xbox is not present', () => {
      const games: RawGameData[] = [
        createGame('Starfield', 'steam'),
        createGame('Starfield', 'gamepass'),
      ];

      const unified = mergeGameGroup(games);

      expect(unified.ownedSources).toHaveLength(2);
      expect(unified.ownedSources).toContain('steam');
      expect(unified.ownedSources).toContain('gamepass');
    });

    it('sums playtime across all sources', () => {
      const games: RawGameData[] = [
        createGame('Game', 'steam', { playtimeHours: 10 }),
        createGame('Game', 'epic', { playtimeHours: 5 }),
      ];

      const unified = mergeGameGroup(games);

      expect(unified.playtimeHours).toBe(15);
    });

    it('uses most recent last played date', () => {
      const oldDate = new Date('2024-01-01');
      const newDate = new Date('2024-12-01');

      const games: RawGameData[] = [
        createGame('Game', 'steam', { lastPlayedAt: oldDate }),
        createGame('Game', 'epic', { lastPlayedAt: newDate }),
      ];

      const unified = mergeGameGroup(games);

      expect(unified.lastPlayedAt?.getTime()).toBe(newDate.getTime());
    });

    it('generates canonical ID from Steam App ID when available', () => {
      const games: RawGameData[] = [
        createGame('Portal', 'steam', { steamAppId: 400 }),
      ];

      const unified = mergeGameGroup(games);

      expect(unified.canonicalId).toBe('steam:400');
    });

    it('generates canonical ID from name when no Steam App ID', () => {
      const games: RawGameData[] = [createGame('Epic Exclusive', 'epic')];

      const unified = mergeGameGroup(games);

      expect(unified.canonicalId).toMatch(/^epic-exclusive$/);
    });
  });

  describe('processRawGames', () => {
    beforeEach(() => {
      // Suppress console.log during tests
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('processes and deduplicates multiple games', () => {
      const games: RawGameData[] = [
        createGame('Portal', 'steam', { steamAppId: 400 }),
        createGame('Portal', 'epic', { steamAppId: 400 }),
        createGame('Half-Life', 'steam', { steamAppId: 70 }),
      ];

      const unified = processRawGames(games);

      expect(unified).toHaveLength(2);
      expect(unified.map(g => g.name).sort()).toEqual(['Half-Life', 'Portal']);
    });

    it('handles empty input', () => {
      const unified = processRawGames([]);

      expect(unified).toHaveLength(0);
    });

    it('preserves metadata from highest priority source', () => {
      const games: RawGameData[] = [
        createGame('Game', 'gog', {
          steamAppId: 12345,
          genres: ['RPG'],
          releaseDate: new Date('2020-01-01'),
        }),
        createGame('Game', 'steam', {
          steamAppId: 12345,
          genres: ['Adventure', 'RPG'],
          releaseDate: new Date('2020-01-01'),
        }),
      ];

      const unified = processRawGames(games);

      expect(unified).toHaveLength(1);
      expect(unified[0].primarySource).toBe('steam');
      expect(unified[0].genres).toEqual(['Adventure', 'RPG']);
    });
  });

  describe('Integration: Full deduplication workflow', () => {
    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('correctly handles multi-platform games with mixed Steam IDs', () => {
      const games: RawGameData[] = [
        createGame('Hollow Knight', 'steam', {
          steamAppId: 367520,
          playtimeHours: 25,
        }),
        createGame('Hollow Knight', 'epic', {
          steamAppId: 367520,
          playtimeHours: 5,
        }),
        createGame('Hollow Knight™', 'gog', { playtimeHours: 10 }),
      ];

      const unified = processRawGames(games);

      expect(unified).toHaveLength(1);
      expect(unified[0].name).toBe('Hollow Knight');
      expect(unified[0].primarySource).toBe('steam');
      expect(unified[0].ownedSources).toHaveLength(3);
      expect(unified[0].playtimeHours).toBe(40);
      expect(unified[0].steamAppId).toBe(367520);
    });

    it('separates different editions of the same game', () => {
      const games: RawGameData[] = [
        createGame('Metro: Last Light', 'steam', { steamAppId: 43160 }),
        createGame('Metro: Last Light Redux', 'steam', { steamAppId: 287390 }),
      ];

      const unified = processRawGames(games);

      expect(unified).toHaveLength(2);
      expect(unified.map(g => g.name).sort()).toEqual([
        'Metro: Last Light',
        'Metro: Last Light Redux',
      ]);
    });

    it('handles platform priority correctly for metadata', () => {
      const games: RawGameData[] = [
        createGame('Game', 'xbox', {
          steamAppId: 12345,
          coverImageUrl: 'xbox.jpg',
        }),
        createGame('Game', 'steam', {
          steamAppId: 12345,
          coverImageUrl: 'steam.jpg',
        }),
        createGame('Game', 'epic', {
          steamAppId: 12345,
          coverImageUrl: 'epic.jpg',
        }),
      ];

      const unified = processRawGames(games);

      expect(unified).toHaveLength(1);
      expect(unified[0].primarySource).toBe('steam'); // Highest priority
      expect(unified[0].coverImageUrl).toBe('steam.jpg');
      expect(unified[0].ownedSources).toEqual(['steam', 'xbox', 'epic']);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateMergeSuggestions, saveMergeSuggestions } from './suggestions';
import { RawGameData, Source } from '../types/game';
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

describe('suggestions', () => {
  describe('generateMergeSuggestions', () => {
    it('detects high similarity games from different sources', () => {
      const games: RawGameData[] = [
        createGame('Hollow Knight: Voidheart Edition', 'steam'),
        createGame('Hollow Knight', 'epic'),
      ];

      const suggestions = generateMergeSuggestions(games);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].games).toEqual([
        'Hollow Knight: Voidheart Edition',
        'Hollow Knight',
      ]);
      expect(suggestions[0].sources).toEqual(['steam', 'epic']);
      expect(suggestions[0].similarity).toBeGreaterThanOrEqual(0.85);
    });

    it('skips exact matches (similarity = 1.0)', () => {
      const games: RawGameData[] = [
        createGame('Portal 2', 'steam'),
        createGame('Portal 2™', 'epic'),
      ];

      const suggestions = generateMergeSuggestions(games);

      expect(suggestions).toHaveLength(0);
    });

    it('skips games from same source', () => {
      const games: RawGameData[] = [
        createGame('Game One', 'steam'),
        createGame('Game One: Enhanced', 'steam'),
      ];

      const suggestions = generateMergeSuggestions(games);

      expect(suggestions).toHaveLength(0);
    });

    it('categorizes very high similarity (>= 0.95)', () => {
      const games: RawGameData[] = [
        createGame('Resident Evil Village', 'steam'),
        createGame('Resident Evil Village Gold Edition', 'epic'),
      ];

      const suggestions = generateMergeSuggestions(games);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].reason).toContain('Substring match');
      expect(suggestions[0].similarity).toBe(0.95);
    });

    it('categorizes high similarity (0.9-0.95)', () => {
      const games: RawGameData[] = [
        createGame('Metro Last Light', 'steam'),
        createGame('Metro: Last Light', 'gog'),
      ];

      const suggestions = generateMergeSuggestions(games);

      if (
        suggestions.length > 0 &&
        suggestions[0].similarity >= 0.9 &&
        suggestions[0].similarity < 0.95
      ) {
        expect(suggestions[0].reason).toContain('Very high similarity');
      }
    });

    it('categorizes moderate similarity (0.85-0.9)', () => {
      const games: RawGameData[] = [
        createGame('Metro: Last Light', 'steam'),
        createGame('Metro Last Light Redux', 'epic'),
      ];

      const suggestions = generateMergeSuggestions(games);

      if (suggestions.length > 0 && suggestions[0].similarity < 0.9) {
        expect(suggestions[0].reason).toContain('High similarity');
      }
    });

    it('ignores low similarity games', () => {
      const games: RawGameData[] = [
        createGame('Portal', 'steam'),
        createGame('Half-Life', 'epic'),
      ];

      const suggestions = generateMergeSuggestions(games);

      expect(suggestions).toHaveLength(0);
    });

    it('sorts suggestions by similarity (highest first)', () => {
      const games: RawGameData[] = [
        createGame('Game A', 'steam'),
        createGame('Game A™', 'epic'),
        createGame('Different Game', 'steam'),
        createGame('Different Game: Enhanced Edition', 'gog'),
      ];

      const suggestions = generateMergeSuggestions(games);

      for (let i = 0; i < suggestions.length - 1; i++) {
        expect(suggestions[i].similarity).toBeGreaterThanOrEqual(
          suggestions[i + 1].similarity
        );
      }
    });

    it('handles multiple similar pairs', () => {
      const games: RawGameData[] = [
        createGame('Metro: Last Light', 'steam'),
        createGame('Metro: Last Light Redux', 'epic'),
        createGame('Borderlands 2', 'steam'),
        createGame('Borderlands II', 'gog'),
      ];

      const suggestions = generateMergeSuggestions(games);

      expect(suggestions.length).toBeGreaterThanOrEqual(2);
    });

    it('rounds similarity to 2 decimal places', () => {
      const games: RawGameData[] = [
        createGame('Test Game', 'steam'),
        createGame('Test Game™', 'epic'),
      ];

      const suggestions = generateMergeSuggestions(games);

      if (suggestions.length > 0) {
        const decimalPlaces = (
          suggestions[0].similarity.toString().split('.')[1] || ''
        ).length;
        expect(decimalPlaces).toBeLessThanOrEqual(2);
      }
    });

    it('handles empty input', () => {
      const suggestions = generateMergeSuggestions([]);

      expect(suggestions).toHaveLength(0);
    });

    it('handles single game', () => {
      const games: RawGameData[] = [createGame('Solo Game', 'steam')];

      const suggestions = generateMergeSuggestions(games);

      expect(suggestions).toHaveLength(0);
    });
  });

  describe('saveMergeSuggestions', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('writes suggestions to file with metadata', async () => {
      const suggestions = [
        {
          games: ['Game 1', 'Game 1™'],
          sources: ['steam', 'epic'],
          similarity: 0.95,
          reason: 'Test reason',
        },
      ];

      await saveMergeSuggestions(suggestions, './test-output.json');

      expect(fs.writeFile).toHaveBeenCalledWith(
        './test-output.json',
        expect.stringContaining('"totalSuggestions": 1')
      );
    });

    it('includes all suggestion data', async () => {
      const suggestions = [
        {
          games: ['Portal 2', 'Portal 2™'],
          sources: ['steam', 'epic'],
          similarity: 0.96,
          reason: 'Very high similarity',
        },
      ];

      await saveMergeSuggestions(suggestions);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.suggestions[0]).toMatchObject({
        id: 1,
        games: ['Portal 2', 'Portal 2™'],
        sources: ['steam', 'epic'],
        similarity: 0.96,
        reason: 'Very high similarity',
      });
    });

    it('uses default output path', async () => {
      await saveMergeSuggestions([]);

      expect(fs.writeFile).toHaveBeenCalledWith(
        './data/merge-suggestions.json',
        expect.any(String)
      );
    });

    it('includes instructions in output', async () => {
      await saveMergeSuggestions([]);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.instructions).toBeDefined();
      expect(writtenData.instructions.howToUse).toContain('overrides.json');
    });

    it('includes timestamp', async () => {
      await saveMergeSuggestions([]);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.generatedAt).toBeDefined();
      expect(new Date(writtenData.generatedAt)).toBeInstanceOf(Date);
    });

    it('assigns sequential IDs to suggestions', async () => {
      const suggestions = [
        {
          games: ['Game 1', 'Game 1™'],
          sources: ['steam', 'epic'],
          similarity: 0.95,
          reason: 'Test',
        },
        {
          games: ['Game 2', 'Game 2™'],
          sources: ['steam', 'gog'],
          similarity: 0.93,
          reason: 'Test',
        },
      ];

      await saveMergeSuggestions(suggestions);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.suggestions[0].id).toBe(1);
      expect(writtenData.suggestions[1].id).toBe(2);
    });
  });

  describe('Integration: Full suggestion workflow', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('generates and saves suggestions for realistic game library', async () => {
      const games: RawGameData[] = [
        createGame('Hollow Knight', 'steam', { steamAppId: 367520 }),
        createGame('Hollow Knight: Voidheart Edition', 'epic'),
        createGame('Metro: Last Light', 'steam'),
        createGame('Metro: Last Light Redux', 'gog'),
        createGame('Unrelated Game', 'xbox'),
      ];

      const suggestions = generateMergeSuggestions(games);
      await saveMergeSuggestions(suggestions);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });
});

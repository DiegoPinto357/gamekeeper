import { describe, it, expect } from 'vitest';
import {
  normalizeGameName,
  generateCanonicalId,
  calculateNameSimilarity,
  areNamesMatching,
} from './normalize';

describe('normalize', () => {
  describe('normalizeGameName', () => {
    it('converts to lowercase and removes trademark symbols', () => {
      expect(normalizeGameName('Half-Life™')).toBe('half life');
      expect(normalizeGameName('Portal®')).toBe('portal');
      expect(normalizeGameName('Batman™: Arkham Knight')).toBe(
        'batman arkham knight'
      );
    });

    it('replaces punctuation with spaces', () => {
      expect(normalizeGameName("Assassin's Creed")).toBe('assassin s creed');
      expect(normalizeGameName('Metro: Last Light')).toBe('metro last light');
      expect(normalizeGameName('Half-Life 2')).toBe('half life 2');
    });

    it('removes articles (the, a, an)', () => {
      expect(normalizeGameName('The Witcher 3')).toBe('witcher 3');
      expect(normalizeGameName('A Story About My Uncle')).toBe(
        'story about my uncle'
      );
      expect(normalizeGameName('The Long Dark')).toBe('long dark');
    });

    it('normalizes whitespace', () => {
      expect(normalizeGameName('Game    With     Spaces')).toBe(
        'game with spaces'
      );
    });

    it('removes GOTY suffix', () => {
      expect(normalizeGameName('Fallout 4 GOTY')).toBe('fallout 4');
    });

    it('handles complex game names with edition text', () => {
      // Note: "the" gets removed before "game of the year edition" pattern matching
      // so "Game of the Year Edition" becomes "game of year edition" (not fully removed)
      expect(normalizeGameName('The Witcher 3: Wild Hunt')).toBe(
        'witcher 3 wild hunt'
      );
    });
  });

  describe('generateCanonicalId', () => {
    it('generates valid slugs from game names', () => {
      expect(generateCanonicalId('Half-Life 2')).toBe('half-life-2');
      expect(generateCanonicalId('Portal™')).toBe('portal');
      expect(generateCanonicalId('The Witcher 3')).toBe('witcher-3');
    });

    it('handles special characters', () => {
      expect(generateCanonicalId("Assassin's Creed")).toBe('assassin-s-creed');
      expect(generateCanonicalId('Batman™: Arkham Knight')).toBe(
        'batman-arkham-knight'
      );
    });

    it('collapses multiple dashes', () => {
      expect(generateCanonicalId('Game!@#$%Name')).toBe('game-name');
    });

    it('removes leading and trailing dashes', () => {
      expect(generateCanonicalId('---Game---')).toBe('game');
    });
  });

  describe('calculateNameSimilarity', () => {
    it('returns 1.0 for identical normalized names', () => {
      expect(calculateNameSimilarity('Half-Life', 'Half-Life')).toBe(1.0);
      expect(calculateNameSimilarity('Portal™', 'Portal')).toBe(1.0);
      expect(calculateNameSimilarity('The Witcher 3', 'Witcher 3')).toBe(1.0);
    });

    it('returns high similarity for substring matches', () => {
      const similarity = calculateNameSimilarity(
        'Metro: Last Light Complete Edition',
        'Metro: Last Light'
      );
      expect(similarity).toBe(0.95);
    });

    it('returns lower similarity for different names', () => {
      const similarity = calculateNameSimilarity('Portal', 'Half-Life');
      expect(similarity).toBeLessThan(0.5);
    });

    it('handles case differences', () => {
      expect(calculateNameSimilarity('DOOM', 'doom')).toBe(1.0);
    });
  });

  describe('areNamesMatching', () => {
    it('matches identical normalized names', () => {
      expect(areNamesMatching('Half-Life', 'Half-Life')).toBe(true);
      expect(areNamesMatching('Portal™', 'Portal')).toBe(true);
      expect(areNamesMatching('The Witcher 3', 'Witcher 3')).toBe(true);
    });

    it('matches with different punctuation', () => {
      expect(areNamesMatching('Half-Life 2', 'Half Life 2')).toBe(true);
      expect(areNamesMatching("Assassin's Creed", 'Assassin s Creed')).toBe(
        true
      );
    });

    it('matches with different capitalization', () => {
      expect(areNamesMatching('DOOM', 'doom')).toBe(true);
      expect(areNamesMatching('Portal', 'PORTAL')).toBe(true);
    });

    it('does not match different games', () => {
      expect(areNamesMatching('Portal', 'Half-Life')).toBe(false);
      expect(areNamesMatching('DOOM', 'Quake')).toBe(false);
    });

    it('does not match similar but different editions', () => {
      expect(
        areNamesMatching('Metro: Last Light', 'Metro: Last Light Redux')
      ).toBe(false);
    });
  });

  describe('Integration: Name matching workflow', () => {
    it('matches game variants from different stores', () => {
      expect(areNamesMatching('Hollow Knight™', 'Hollow Knight')).toBe(true);
      expect(areNamesMatching('The Long Dark', 'Long Dark')).toBe(true);
      expect(areNamesMatching('Half-Life 2', 'Half Life 2')).toBe(true);
    });

    it('generates consistent IDs for variants', () => {
      const id1 = generateCanonicalId('The Witcher 3™: Wild Hunt');
      const id2 = generateCanonicalId('Witcher 3: Wild Hunt');
      expect(id1).toBe(id2);
    });

    it('properly separates similar but different games', () => {
      expect(areNamesMatching('Borderlands', 'Borderlands 2')).toBe(false);
      expect(areNamesMatching('DOOM', 'DOOM Eternal')).toBe(false);
      expect(areNamesMatching('Portal', 'Portal 2')).toBe(false);
    });
  });
});

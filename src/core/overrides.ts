import fs from 'fs/promises';
import { GameOverrides } from '../types/overrides';
import { normalizeGameName } from './normalize';

let overrides: GameOverrides | null = null;

/**
 * Load overrides from JSON file
 */
export const loadOverrides = async (
  filePath: string = './data/overrides.json'
): Promise<GameOverrides> => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    overrides = JSON.parse(content);
    console.log('✅ Loaded manual overrides');
    return overrides!;
  } catch (error) {
    console.log('⚠️  No overrides file found, using defaults');
    overrides = { forceMerge: [], propertyOverrides: [] };
    return overrides;
  }
};

/**
 * Check if two games should be forced to merge
 * Returns the canonical name if they should merge, null otherwise
 */
export const shouldForceMerge = (
  name1: string,
  name2: string
): string | null => {
  if (!overrides?.forceMerge) return null;

  const norm1 = normalizeGameName(name1);
  const norm2 = normalizeGameName(name2);

  for (const rule of overrides.forceMerge) {
    const normalizedGames = rule.games.map(g => normalizeGameName(g));

    // Check if both games are in the same merge rule
    const has1 = normalizedGames.some(
      g => g === norm1 || norm1.includes(g) || g.includes(norm1)
    );
    const has2 = normalizedGames.some(
      g => g === norm2 || norm2.includes(g) || g.includes(norm2)
    );

    if (has1 && has2) {
      const canonical = rule.canonicalName || rule.games[0];
      return canonical;
    }
  }

  return null;
};

/**
 * Apply property overrides to a game
 */
export const applyPropertyOverrides = (game: any): any => {
  if (!overrides?.propertyOverrides) return game;

  const normalizedName = normalizeGameName(game.name);

  for (const override of overrides.propertyOverrides) {
    const matchNormalized = normalizeGameName(override.match);

    if (
      normalizedName === matchNormalized ||
      normalizedName.includes(matchNormalized) ||
      matchNormalized.includes(normalizedName)
    ) {
      return { ...game, ...override.properties };
    }
  }

  return game;
};

export const getOverrides = (): GameOverrides | null => overrides;

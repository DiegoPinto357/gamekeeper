import type { DatabaseSync } from 'node:sqlite';
import { loadGameOverrides } from '../db/repos/overrides';
import { type GameOverrides } from '../types/overrides';
import { normalizeGameName } from './normalize';
import { log } from '../logger';

let overrides: GameOverrides | null = null;

/**
 * Load overrides from SQLite (P0B) into the module cache that
 * shouldForceMerge / applyPropertyOverrides read synchronously.
 */
export const loadOverrides = async (
  db: DatabaseSync,
): Promise<GameOverrides> => {
  overrides = loadGameOverrides(db);
  log.info('✅ Loaded manual overrides');
  return overrides;
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

    // Use exact matching only (no substring matching to avoid false positives like
    // "Hollow Knight: Silksong" incorrectly matching "Hollow Knight")
    const has1 = normalizedGames.some(g => g === norm1);
    const has2 = normalizedGames.some(g => g === norm2);

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

/**
 * Check if a game title matches any variant in a merge rule
 * Returns the canonical name if found, null otherwise
 */
export const getCanonicalNameFromVariant = (title: string): string | null => {
  if (!overrides?.forceMerge) return null;

  const normalized = normalizeGameName(title);

  for (const rule of overrides.forceMerge) {
    const normalizedGames = rule.games.map(g => normalizeGameName(g));

    // Check for exact match only (no substring matching)
    const matches = normalizedGames.some(g => g === normalized);

    if (matches) {
      return rule.canonicalName || rule.games[0];
    }
  }

  return null;
};

export const getOverrides = (): GameOverrides | null => overrides;

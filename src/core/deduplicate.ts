import { RawGameData, UnifiedGame, PLATFORM_PRIORITY } from '../types/game';
import {
  normalizeGameName,
  generateCanonicalId,
  areNamesMatching,
} from './normalize';

/**
 * Deduplicate raw games from multiple sources
 * Applies platform priority: Steam > Xbox > Epic > GOG > Game Pass > Manual
 */
export function deduplicateGames(
  rawGames: RawGameData[]
): Map<string, RawGameData[]> {
  const gameGroups = new Map<string, RawGameData[]>();

  for (const game of rawGames) {
    // First, try to group by Steam AppID (most reliable)
    if (game.steamAppId) {
      const key = `steam:${game.steamAppId}`;
      if (!gameGroups.has(key)) {
        gameGroups.set(key, []);
      }
      gameGroups.get(key)!.push(game);
      continue;
    }

    // Otherwise, try to find a matching group by name
    let matched = false;
    for (const [existingKey, existingGames] of gameGroups.entries()) {
      const existingGame = existingGames[0];

      if (areNamesMatching(game.name, existingGame.name)) {
        gameGroups.get(existingKey)!.push(game);
        matched = true;
        break;
      }
    }

    // If no match found, create a new group
    if (!matched) {
      const key = `name:${generateCanonicalId(game.name)}`;
      gameGroups.set(key, [game]);
    }
  }

  return gameGroups;
}

/**
 * Merge a group of duplicate raw games into a single unified game
 * Applies platform priority for metadata source
 */
export function mergeGameGroup(games: RawGameData[]): UnifiedGame {
  if (games.length === 0) {
    throw new Error('Cannot merge empty game group');
  }

  // Sort by platform priority
  const sorted = [...games].sort((a, b) => {
    return PLATFORM_PRIORITY[a.source] - PLATFORM_PRIORITY[b.source];
  });

  // Primary source is the highest priority platform
  const primary = sorted[0];
  const ownedSources = sorted.map(g => g.source);

  // Generate canonical ID
  const canonicalId = primary.steamAppId
    ? `steam:${primary.steamAppId}`
    : generateCanonicalId(primary.name);

  // Merge playtime (sum across all sources)
  const totalPlaytime = games.reduce((sum, game) => {
    return sum + (game.playtimeHours || 0);
  }, 0);

  // Use most recent last played date
  const lastPlayedDates = games
    .map(g => g.lastPlayedAt)
    .filter((d): d is Date => d !== undefined);

  const lastPlayedAt =
    lastPlayedDates.length > 0
      ? new Date(Math.max(...lastPlayedDates.map(d => d.getTime())))
      : undefined;

  const now = new Date();

  const unified: UnifiedGame = {
    canonicalId,
    name: primary.name,
    primarySource: primary.source,
    ownedSources,
    steamAppId: primary.steamAppId,
    playtimeHours: totalPlaytime > 0 ? totalPlaytime : undefined,
    lastPlayedAt,
    coverImageUrl: primary.coverImageUrl,
    releaseDate: primary.releaseDate,
    genres: primary.genres,
    createdAt: now,
    updatedAt: now,
  };

  return unified;
}

/**
 * Process raw games from multiple sources into deduplicated unified games
 */
export function processRawGames(rawGames: RawGameData[]): UnifiedGame[] {
  console.log(`Processing ${rawGames.length} raw games...`);

  const gameGroups = deduplicateGames(rawGames);
  console.log(`Deduplicated into ${gameGroups.size} unique games`);

  const unifiedGames: UnifiedGame[] = [];

  for (const [key, games] of gameGroups.entries()) {
    try {
      const unified = mergeGameGroup(games);
      unifiedGames.push(unified);

      if (games.length > 1) {
        const sources = games.map(g => g.source).join(', ');
        console.log(`Merged "${unified.name}" from sources: ${sources}`);
      }
    } catch (error) {
      console.warn(`Failed to merge game group ${key}:`, error);
    }
  }

  return unifiedGames;
}

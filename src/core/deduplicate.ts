import { RawGameData, UnifiedGame, PLATFORM_PRIORITY } from '../types/game';
import {
  normalizeGameName,
  generateCanonicalId,
  areNamesMatching,
} from './normalize';
import { shouldForceMerge } from './overrides';
import { getConfig } from '../config';

const debug = (message: string, ...args: any[]) => {
  if (getConfig().logLevel === 'debug') {
    console.log(`[DEBUG] ${message}`, ...args);
  }
};

/**
 * Deduplicate raw games from multiple sources
 * Applies platform priority: Steam > Xbox > Epic > GOG > Game Pass > Manual
 */
export const deduplicateGames = (
  rawGames: RawGameData[]
): Map<string, RawGameData[]> => {
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
};

/**
 * Merge a group of duplicate raw games into a single unified game
 * Applies platform priority for metadata source
 */
export const mergeGameGroup = (games: RawGameData[]): UnifiedGame => {
  if (games.length === 0) {
    throw new Error('Cannot merge empty game group');
  }

  // Sort by platform priority
  const sorted = [...games].sort((a, b) => {
    return PLATFORM_PRIORITY[a.source] - PLATFORM_PRIORITY[b.source];
  });

  // Primary source is the highest priority platform
  const primary = sorted[0];

  // Get unique sources, but apply Xbox/Game Pass exclusion rule:
  // If Xbox is present, exclude Game Pass from ownedSources
  const allSources = [...new Set(sorted.map(g => g.source))];
  const hasXbox = allSources.includes('xbox');
  const ownedSources = hasXbox
    ? allSources.filter(s => s !== 'gamepass')
    : allSources;

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

  // Check if any games in this group should use a canonical name from overrides
  let gameName = primary.name;
  if (games.length > 1) {
    // Check if there's a forced merge with a canonical name
    const canonicalName = shouldForceMerge(games[0].name, games[1].name);
    if (canonicalName && canonicalName !== primary.name) {
      debug(
        `Applying canonical name: "${canonicalName}" (was "${primary.name}")`
      );
      gameName = canonicalName;
    }
  }

  const unified: UnifiedGame = {
    canonicalId,
    name: gameName,
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
};

/**
 * Process raw games from multiple sources into deduplicated unified games
 */
export const processRawGames = (rawGames: RawGameData[]): UnifiedGame[] => {
  console.log(`Processing ${rawGames.length} raw games...`);

  const gameGroups = deduplicateGames(rawGames);
  console.log(`Deduplicated into ${gameGroups.size} unique games`);

  const unifiedGames: UnifiedGame[] = [];

  for (const [key, games] of gameGroups.entries()) {
    try {
      const unified = mergeGameGroup(games);
      unifiedGames.push(unified);

      // Only log merge if there are multiple different sources
      const uniqueSources = [...new Set(games.map(g => g.source))];
      if (uniqueSources.length > 1) {
        console.log(
          `Merged "${unified.name}" from sources: ${uniqueSources.join(', ')}`
        );
      }
    } catch (error) {
      console.warn(`Failed to merge game group ${key}:`, error);
      // Debug: Check if this is Silksong
      if (games.some(g => g.name === 'Hollow Knight: Silksong')) {
        console.error(
          `[ERROR] Failed to merge Silksong! Games in group:`,
          games.map(g => g.name)
        );
      }
    }
  }

  return unifiedGames;
};

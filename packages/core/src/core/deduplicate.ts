import { type RawGameData, type UnifiedGame, PLATFORM_PRIORITY } from '../types/game';
import { normalizeGameName, generateCanonicalId, areNamesMatching } from './normalize';
import { shouldForceMerge, getCanonicalNameFromVariant } from './overrides';
import { getConfig } from '../config';
import { log } from '../logger';

const debug = (message: string, ...args: any[]) => {
  if (getConfig().logLevel === 'debug') {
    log.info(`[DEBUG] ${message}`, ...args);
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

      // Check both normal name matching and forced merge overrides
      if (
        areNamesMatching(game.name, existingGame.name) ||
        shouldForceMerge(game.name, existingGame.name)
      ) {
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

  // Determine the canonical name FIRST (before generating canonical ID)
  // This ensures the ID is based on the correct name
  let gameName = primary.name;
  const canonicalNameOverride = getCanonicalNameFromVariant(primary.name);
  if (canonicalNameOverride && canonicalNameOverride !== primary.name) {
    debug(
      `Applying canonical name: "${canonicalNameOverride}" (was "${primary.name}")`
    );
    gameName = canonicalNameOverride;
  } else if (games.length > 1) {
    // Also check if there's a forced merge with a canonical name between games
    const mergeCanonical = shouldForceMerge(games[0].name, games[1].name);
    if (mergeCanonical && mergeCanonical !== primary.name) {
      debug(
        `Applying canonical name from merge: "${mergeCanonical}" (was "${primary.name}")`
      );
      gameName = mergeCanonical;
    }
  }

  // Get unique sources, but apply Xbox/Game Pass exclusion rule:
  // If Xbox is present, exclude Game Pass from ownedSources
  const allSources = [...new Set(sorted.map(g => g.source))];
  const hasXbox = allSources.includes('xbox');
  const ownedSources = hasXbox
    ? allSources.filter(s => s !== 'gamepass')
    : allSources;

  // Generate canonical ID using the canonical name (not the original name)
  const canonicalId = primary.steamAppId
    ? `steam:${primary.steamAppId}`
    : generateCanonicalId(gameName);

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

  // gameName was already determined above (before generating canonical ID)

  // Prefer the primary source's cover; fall back to any sibling source that
  // has one (e.g. Steam API no longer returns logo URLs, but Epic's store
  // cache does — better a secondary cover than none).
  const coverImageUrl =
    primary.coverImageUrl ??
    sorted.find(game => game.coverImageUrl != null)?.coverImageUrl;

  const unified: UnifiedGame = {
    canonicalId,
    name: gameName,
    primarySource: primary.source,
    ownedSources,
    steamAppId: primary.steamAppId,
    playtimeHours: totalPlaytime > 0 ? totalPlaytime : undefined,
    lastPlayedAt,
    coverImageUrl,
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
  log.info(`Processing ${rawGames.length} raw games...`);

  const gameGroups = deduplicateGames(rawGames);
  log.info(`Deduplicated into ${gameGroups.size} unique games`);

  const unifiedGames: UnifiedGame[] = [];

  for (const [key, games] of gameGroups.entries()) {
    try {
      const unified = mergeGameGroup(games);
      unifiedGames.push(unified);

      // Only log merge if there are multiple different sources
      const uniqueSources = [...new Set(games.map(g => g.source))];
      if (uniqueSources.length > 1) {
        log.info(
          `Merged "${unified.name}" from sources: ${uniqueSources.join(', ')}`
        );
      }
    } catch (error) {
      log.warn(`Failed to merge game group ${key}:`, error);
      // Debug: Check if this is Silksong
      if (games.some(g => g.name === 'Hollow Knight: Silksong')) {
        log.error(
          `[ERROR] Failed to merge Silksong! Games in group:`,
          games.map(g => g.name)
        );
      }
    }
  }

  return unifiedGames;
};

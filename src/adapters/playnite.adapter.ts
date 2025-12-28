import fs from 'fs/promises';
import { RawGameData, Source } from '../types/game';

/**
 * Playnite export JSON structure
 */
type PlayniteGame = {
  GameId: string;
  Id: string;
  Name: string;
  Source?: { Id: string; Name: string } | string; // Can be object or string
  SourceId?: string; // External ID from the source
  Playtime?: number; // in seconds
  LastActivity?: string; // ISO date string
  CoverImage?: string;
  ReleaseDate?: { ReleaseDate: string } | string; // Can be object or string
  Genres?: Array<{ Id: string; Name: string }>;
  Categories?: Array<{ Id: string; Name: string }>;
  Platforms?: Array<{ Id: string; Name: string; SpecificationId?: string }>;

  // Additional fields
  IsInstalled?: boolean;
};

// Support both wrapped and unwrapped formats
type PlayniteExport = PlayniteGame[] | { Games: PlayniteGame[] };

/**
 * Map Playnite source string to our Source type
 */
const mapPlayniteSource = (source?: { Name: string } | string): Source => {
  if (!source) {
    return 'manual';
  }

  // Handle both object and string formats
  const sourceName = typeof source === 'string' ? source : source.Name;
  const normalized = sourceName.toLowerCase();

  if (normalized.includes('steam')) return 'steam';
  if (normalized.includes('epic')) return 'epic';
  if (normalized.includes('gog')) return 'gog';
  if (normalized.includes('xbox') || normalized.includes('microsoft'))
    return 'xbox';
  if (normalized.includes('gamepass') || normalized.includes('game pass'))
    return 'gamepass';

  return 'manual';
};

/**
 * Map Playnite game data to our internal raw format
 */
const mapPlayniteGameToRaw = (
  game: PlayniteGame,
  source: Source
): RawGameData => {
  const playtimeHours = game.Playtime ? game.Playtime / 3600 : undefined;

  const lastPlayedAt = game.LastActivity
    ? new Date(game.LastActivity)
    : undefined;

  // Handle both ReleaseDate formats
  let releaseDate: Date | undefined;
  if (game.ReleaseDate) {
    if (typeof game.ReleaseDate === 'string') {
      releaseDate = new Date(game.ReleaseDate);
    } else if (game.ReleaseDate.ReleaseDate) {
      releaseDate = new Date(game.ReleaseDate.ReleaseDate);
    }
  }

  const genres = game.Genres?.map(g => g.Name) || undefined;

  // Try to extract Steam AppID from SourceId if available
  // Some Playnite plugins store Steam AppID even for non-Steam sources
  let steamAppId: number | undefined;
  if (game.SourceId && /^\d+$/.test(game.SourceId)) {
    const parsed = parseInt(game.SourceId, 10);
    if (!isNaN(parsed) && parsed > 0) {
      steamAppId = parsed;
    }
  }

  return {
    source,
    externalId: game.Id || game.GameId,
    name: game.Name,
    steamAppId,
    playtimeHours:
      playtimeHours && playtimeHours > 0 ? playtimeHours : undefined,
    lastPlayedAt,
    coverImageUrl: game.CoverImage,
    releaseDate,
    genres,
  };
};

/**
 * Get breakdown of games by source
 */
const getSourceBreakdown = (games: RawGameData[]): Record<string, number> => {
  const breakdown: Record<string, number> = {};

  for (const game of games) {
    breakdown[game.source] = (breakdown[game.source] || 0) + 1;
  }

  return breakdown;
};

/**
 * Load and parse Playnite export file
 *
 * @param exportPath Path to Playnite JSON export
 * @param gamePassFilter Optional function to check if a Game Pass game should be included
 */
const loadSnapshot = async (
  exportPath: string,
  gamePassFilter?: (gameTitle: string) => Promise<boolean>
): Promise<RawGameData[]> => {
  try {
    console.log(`Loading Playnite snapshot from ${exportPath}...`);

    // Read file and strip BOM (Byte Order Mark) if present
    // PowerShell exports often include UTF-8 BOM which breaks JSON parsing
    const fileContent = await fs.readFile(exportPath, 'utf-8');
    const cleanContent = fileContent.replace(/^\uFEFF/, ''); // Remove BOM
    const data: PlayniteExport = JSON.parse(cleanContent);

    // Support both array format and wrapped format
    const games = Array.isArray(data) ? data : data.Games;

    if (!games || !Array.isArray(games)) {
      throw new Error(
        'Invalid Playnite export format: expected array of games'
      );
    }

    console.log(`Found ${games.length} games in Playnite export`);

    // Filter and map games
    const rawGames: RawGameData[] = [];

    for (const game of games) {
      const source = mapPlayniteSource(game.Source);

      // Skip Steam games (they come from Steam adapter)
      if (source === 'steam') {
        continue;
      }

      // Handle Xbox/Game Pass games differently
      if (source === 'xbox') {
        // Check if this is an owned Xbox game or Game Pass game
        const sourceName =
          typeof game.Source === 'string'
            ? game.Source
            : game.Source?.Name || '';

        const isGamePass = sourceName.toLowerCase().includes('game pass');

        if (isGamePass && gamePassFilter) {
          // For Game Pass games, check if we should include it
          const shouldInclude = await gamePassFilter(game.Name);
          if (!shouldInclude) {
            continue; // Skip this Game Pass game
          }
        }

        // Include owned Xbox games or filtered Game Pass games
        const rawGame = mapPlayniteGameToRaw(game, source);
        rawGames.push(rawGame);
      } else if (source === 'epic' || source === 'gog') {
        // Always include Epic and GOG games
        const rawGame = mapPlayniteGameToRaw(game, source);
        rawGames.push(rawGame);
      }
    }

    console.log(
      `Processed ${rawGames.length} games from Playnite (Epic, GOG, Xbox)`
    );

    const breakdown = getSourceBreakdown(rawGames);
    console.log('Source breakdown:', breakdown);

    return rawGames;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(`Playnite export file not found: ${exportPath}`);
      return [];
    }
    throw new Error(`Failed to load Playnite snapshot: ${error}`);
  }
};

/**
 * Validate Playnite export file format
 */
const validateExport = async (exportPath: string): Promise<boolean> => {
  try {
    const content = await fs.readFile(exportPath, 'utf-8');
    const data = JSON.parse(content);

    // Support both array format and wrapped format
    const games = Array.isArray(data) ? data : data.Games;
    return games && Array.isArray(games);
  } catch {
    return false;
  }
};

/**
 * Playnite snapshot adapter
 * Reads game data from a Playnite JSON export file
 * Only processes Epic, GOG, and Xbox games (NOT Steam)
 */
export const playniteAdapter = {
  loadSnapshot,
  validateExport,
};

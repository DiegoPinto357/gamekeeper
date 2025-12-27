import fs from 'fs/promises';
import { RawGameData, Source } from '../types/game';

/**
 * Playnite export JSON structure
 */
type PlayniteGame = {
  GameId: string;
  Name: string;
  Source?: string; // e.g., "Epic", "GOG", "Xbox"
  SourceId?: string; // External ID from the source
  Playtime?: number; // in seconds
  LastActivity?: string; // ISO date string
  CoverImage?: string;
  ReleaseDate?: string; // ISO date string
  Genres?: Array<{ Name: string }>;
  Categories?: Array<{ Name: string }>;

  // Additional fields that might be useful
  IsInstalled?: boolean;
  Platform?: string;
  Platforms?: Array<{ Name: string }>;
};

type PlayniteExport = {
  Games: PlayniteGame[];
};

/**
 * Playnite snapshot adapter
 * Reads game data from a Playnite JSON export file
 * Only processes Epic, GOG, and Xbox games (NOT Steam)
 */
export class PlayniteAdapter {
  private exportPath: string;

  constructor(exportPath: string) {
    this.exportPath = exportPath;
  }

  /**
   * Load and parse Playnite export file
   */
  async loadSnapshot(): Promise<RawGameData[]> {
    try {
      console.log(`Loading Playnite snapshot from ${this.exportPath}...`);

      const fileContent = await fs.readFile(this.exportPath, 'utf-8');
      const data: PlayniteExport = JSON.parse(fileContent);

      if (!data.Games || !Array.isArray(data.Games)) {
        throw new Error('Invalid Playnite export format: missing Games array');
      }

      console.log(`Found ${data.Games.length} games in Playnite export`);

      // Filter and map games
      const rawGames: RawGameData[] = [];

      for (const game of data.Games) {
        const source = this.mapPlayniteSource(game.Source);

        // Skip Steam games (they come from Steam adapter)
        if (source === 'steam') {
          continue;
        }

        // Only process Epic, GOG, and Xbox
        if (source === 'epic' || source === 'gog' || source === 'xbox') {
          const rawGame = this.mapPlayniteGameToRaw(game, source);
          rawGames.push(rawGame);
        }
      }

      console.log(
        `Processed ${rawGames.length} games from Playnite (Epic, GOG, Xbox)`
      );

      const breakdown = this.getSourceBreakdown(rawGames);
      console.log('Source breakdown:', breakdown);

      return rawGames;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(`Playnite export file not found: ${this.exportPath}`);
        return [];
      }
      throw new Error(`Failed to load Playnite snapshot: ${error}`);
    }
  }

  /**
   * Map Playnite source string to our Source type
   */
  private mapPlayniteSource(playniteSource?: string): Source {
    if (!playniteSource) {
      return 'manual';
    }

    const normalized = playniteSource.toLowerCase();

    if (normalized.includes('steam')) return 'steam';
    if (normalized.includes('epic')) return 'epic';
    if (normalized.includes('gog')) return 'gog';
    if (normalized.includes('xbox') || normalized.includes('microsoft'))
      return 'xbox';
    if (normalized.includes('gamepass') || normalized.includes('game pass'))
      return 'gamepass';

    return 'manual';
  }

  /**
   * Map Playnite game data to our internal raw format
   */
  private mapPlayniteGameToRaw(
    game: PlayniteGame,
    source: Source
  ): RawGameData {
    const playtimeHours = game.Playtime ? game.Playtime / 3600 : undefined;

    const lastPlayedAt = game.LastActivity
      ? new Date(game.LastActivity)
      : undefined;

    const releaseDate = game.ReleaseDate
      ? new Date(game.ReleaseDate)
      : undefined;

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
      externalId: game.GameId,
      name: game.Name,
      steamAppId,
      playtimeHours:
        playtimeHours && playtimeHours > 0 ? playtimeHours : undefined,
      lastPlayedAt,
      coverImageUrl: game.CoverImage,
      releaseDate,
      genres,
    };
  }

  /**
   * Get breakdown of games by source
   */
  private getSourceBreakdown(games: RawGameData[]): Record<string, number> {
    const breakdown: Record<string, number> = {};

    for (const game of games) {
      breakdown[game.source] = (breakdown[game.source] || 0) + 1;
    }

    return breakdown;
  }

  /**
   * Validate Playnite export file format
   */
  static async validateExport(exportPath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(exportPath, 'utf-8');
      const data = JSON.parse(content);

      return data.Games && Array.isArray(data.Games);
    } catch {
      return false;
    }
  }
}

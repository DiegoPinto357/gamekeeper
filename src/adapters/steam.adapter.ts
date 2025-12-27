import axios from 'axios';
import { RawGameData } from '../types/game';

/**
 * Steam Web API response types
 */
interface SteamGame {
  appid: number;
  name: string;
  playtime_forever: number; // in minutes
  playtime_2weeks?: number;
  img_icon_url?: string;
  img_logo_url?: string;
  rtime_last_played?: number; // Unix timestamp
}

interface SteamOwnedGamesResponse {
  response: {
    game_count: number;
    games: SteamGame[];
  };
}

interface SteamAppDetails {
  [appId: string]: {
    success: boolean;
    data?: {
      name: string;
      steam_appid: number;
      header_image?: string;
      release_date?: {
        coming_soon: boolean;
        date: string;
      };
      genres?: Array<{ description: string }>;
      categories?: Array<{ description: string }>;
    };
  };
}

/**
 * Steam Web API adapter
 * Fetches owned games and their metadata from Steam
 */
export class SteamAdapter {
  private apiKey: string;
  private userId: string;
  private baseUrl = 'https://api.steampowered.com';
  private storeUrl = 'https://store.steampowered.com/api';

  constructor(apiKey: string, userId: string) {
    this.apiKey = apiKey;
    this.userId = userId;
  }

  /**
   * Fetch all owned games for the configured Steam user
   */
  async fetchOwnedGames(): Promise<RawGameData[]> {
    try {
      const url = `${this.baseUrl}/IPlayerService/GetOwnedGames/v1/`;
      const params = {
        key: this.apiKey,
        steamid: this.userId,
        include_appinfo: 1,
        include_played_free_games: 1,
        format: 'json',
      };

      console.log('Fetching Steam library...');
      const response = await axios.get<SteamOwnedGamesResponse>(url, {
        params,
      });

      if (!response.data.response.games) {
        console.warn('No games found in Steam library');
        return [];
      }

      const games = response.data.response.games;
      console.log(`Found ${games.length} games in Steam library`);

      return games.map(game => this.mapSteamGameToRaw(game));
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Steam API error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Fetch detailed information for a specific Steam app
   * Note: This is rate-limited and should be used sparingly
   */
  async fetchAppDetails(
    appId: number
  ): Promise<SteamAppDetails['0']['data'] | null> {
    try {
      const url = `${this.storeUrl}/appdetails`;
      const params = { appids: appId };

      const response = await axios.get<SteamAppDetails>(url, { params });
      const appData = response.data[appId.toString()];

      if (appData && appData.success && appData.data) {
        return appData.data;
      }

      return null;
    } catch (error) {
      console.warn(`Failed to fetch details for Steam app ${appId}:`, error);
      return null;
    }
  }

  /**
   * Map Steam API game data to our internal raw format
   */
  private mapSteamGameToRaw(game: SteamGame): RawGameData {
    const coverImageUrl = game.img_logo_url
      ? `https://steamcdn-a.akamaihd.net/steam/apps/${game.appid}/header.jpg`
      : undefined;

    const lastPlayedAt = game.rtime_last_played
      ? new Date(game.rtime_last_played * 1000)
      : undefined;

    return {
      source: 'steam',
      externalId: game.appid.toString(),
      name: game.name,
      steamAppId: game.appid,
      playtimeHours:
        game.playtime_forever > 0 ? game.playtime_forever / 60 : undefined,
      lastPlayedAt,
      coverImageUrl,
    };
  }

  /**
   * Generate Steam store URL for a game
   */
  static getStoreUrl(appId: number): string {
    return `https://store.steampowered.com/app/${appId}`;
  }

  /**
   * Validate Steam ID format (64-bit SteamID)
   */
  static isValidSteamId(steamId: string): boolean {
    return /^\d{17}$/.test(steamId);
  }
}

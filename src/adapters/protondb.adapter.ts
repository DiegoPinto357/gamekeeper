import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { ProtonInfo, ProtonTier, SteamDeckStatus } from '../types/game';

/**
 * ProtonDB API response types
 */
interface ProtonDBAppSummary {
  bestReportedTier: string;
  confidence: string;
  score: number;
  tier: string;
  total: number;
  trendingTier: string;
}

interface ProtonDBResponse {
  [appId: string]: ProtonDBAppSummary;
}

/**
 * Steam Deck verification API response
 */
interface SteamDeckVerifiedResponse {
  success: number;
  results?: {
    resolved_category?: number;
    resolved_items?: Array<{
      tag?: string;
    }>;
  };
}

/**
 * Cache entry structure
 */
interface CacheEntry {
  data: ProtonInfo;
  timestamp: number;
}

/**
 * ProtonDB adapter with disk-based caching
 * Fetches Steam Deck and Proton compatibility data for PC games
 */
export class ProtonDBAdapter {
  private protonDbUrl = 'https://www.protondb.com/api/v1/reports/summaries';
  private cacheDir: string;
  private cacheDurationMs: number;

  constructor(cacheDir = '.cache/protondb', cacheDays = 30) {
    this.cacheDir = cacheDir;
    this.cacheDurationMs = cacheDays * 24 * 60 * 60 * 1000;
  }

  /**
   * Initialize cache directory
   */
  async init(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      console.warn('Failed to create ProtonDB cache directory:', error);
    }
  }

  /**
   * Fetch ProtonDB compatibility info for a Steam app
   */
  async fetchCompatibility(steamAppId: number): Promise<ProtonInfo | null> {
    // Check cache first
    const cached = await this.getCached(steamAppId);
    if (cached) {
      return cached;
    }

    try {
      // Fetch from ProtonDB API
      const protonData = await this.fetchProtonDBData(steamAppId);

      // Fetch Steam Deck verification status
      const deckStatus = await this.fetchSteamDeckStatus(steamAppId);

      if (!protonData) {
        return null;
      }

      const protonInfo: ProtonInfo = {
        tier: this.mapProtonTier(protonData.tier),
        steamDeck: deckStatus,
        confidence: parseFloat(protonData.confidence) || undefined,
        trendingTier: protonData.trendingTier
          ? this.mapProtonTier(protonData.trendingTier)
          : undefined,
        lastUpdated: new Date(),
      };

      // Cache the result
      await this.setCached(steamAppId, protonInfo);

      return protonInfo;
    } catch (error) {
      console.warn(
        `Failed to fetch ProtonDB data for app ${steamAppId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Fetch ProtonDB compatibility data
   */
  private async fetchProtonDBData(
    steamAppId: number
  ): Promise<ProtonDBAppSummary | null> {
    try {
      const url = `${this.protonDbUrl}/${steamAppId}.json`;
      const response = await axios.get<ProtonDBResponse>(url, {
        timeout: 5000,
      });

      const appData = response.data[steamAppId.toString()];
      return appData || null;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // App not in ProtonDB, this is normal
        return null;
      }
      throw error;
    }
  }

  /**
   * Fetch Steam Deck verification status
   * Note: This uses an undocumented Steam API endpoint
   */
  private async fetchSteamDeckStatus(
    steamAppId: number
  ): Promise<SteamDeckStatus> {
    try {
      const url = `https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport`;
      const params = { nAppID: steamAppId };

      const response = await axios.get<SteamDeckVerifiedResponse>(url, {
        params,
        timeout: 5000,
      });

      if (
        response.data.success === 1 &&
        response.data.results?.resolved_category
      ) {
        const category = response.data.results.resolved_category;

        // Steam Deck categories: 3 = Verified, 2 = Playable, 1 = Unsupported
        switch (category) {
          case 3:
            return 'verified';
          case 2:
            return 'playable';
          case 1:
            return 'unsupported';
        }
      }

      return 'unknown';
    } catch (error) {
      // Fail gracefully - not all games have Deck verification
      return 'unknown';
    }
  }

  /**
   * Map ProtonDB tier string to our enum
   */
  private mapProtonTier(tier: string): ProtonTier {
    const normalized = tier.toLowerCase();
    switch (normalized) {
      case 'platinum':
        return 'platinum';
      case 'gold':
        return 'gold';
      case 'silver':
        return 'silver';
      case 'bronze':
        return 'bronze';
      case 'borked':
        return 'borked';
      default:
        return 'bronze'; // Conservative fallback
    }
  }

  /**
   * Get cached ProtonDB data
   */
  private async getCached(steamAppId: number): Promise<ProtonInfo | null> {
    try {
      const cachePath = this.getCachePath(steamAppId);
      const data = await fs.readFile(cachePath, 'utf-8');
      const entry: CacheEntry = JSON.parse(data);

      // Check if cache is still valid
      const now = Date.now();
      if (now - entry.timestamp < this.cacheDurationMs) {
        // Reconstruct dates from ISO strings
        return {
          ...entry.data,
          lastUpdated: entry.data.lastUpdated
            ? new Date(entry.data.lastUpdated)
            : undefined,
        };
      }

      // Cache expired, delete it
      await fs.unlink(cachePath).catch(() => {});
      return null;
    } catch (error) {
      // Cache miss or read error
      return null;
    }
  }

  /**
   * Save ProtonDB data to cache
   */
  private async setCached(steamAppId: number, data: ProtonInfo): Promise<void> {
    try {
      const cachePath = this.getCachePath(steamAppId);
      const entry: CacheEntry = {
        data,
        timestamp: Date.now(),
      };

      await fs.writeFile(cachePath, JSON.stringify(entry, null, 2), 'utf-8');
    } catch (error) {
      console.warn(
        `Failed to cache ProtonDB data for app ${steamAppId}:`,
        error
      );
    }
  }

  /**
   * Get cache file path for a Steam app
   */
  private getCachePath(steamAppId: number): string {
    return path.join(this.cacheDir, `${steamAppId}.json`);
  }

  /**
   * Clear expired cache entries
   */
  async cleanCache(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      const now = Date.now();

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.cacheDir, file);
        try {
          const data = await fs.readFile(filePath, 'utf-8');
          const entry: CacheEntry = JSON.parse(data);

          if (now - entry.timestamp >= this.cacheDurationMs) {
            await fs.unlink(filePath);
          }
        } catch {
          // Invalid cache file, delete it
          await fs.unlink(filePath).catch(() => {});
        }
      }
    } catch (error) {
      console.warn('Failed to clean ProtonDB cache:', error);
    }
  }
}

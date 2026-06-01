import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';

/**
 * Game Pass catalog game entry
 */
export type GamePassGame = {
  id: string;
  title: string;
  available: boolean;
  coverImageUrl?: string;
  releaseDate?: string;
  firstSeenAt?: string;
  catalogPosition?: number;
};

/**
 * Cached Game Pass catalog
 */
type GamePassCatalog = {
  lastUpdated: string;
  games: GamePassGame[];
};

/**
 * Check if cache is still valid (not older than cacheDays)
 */
const isCacheValid = async (
  cacheFile: string,
  cacheDays: number,
): Promise<boolean> => {
  try {
    const stat = await fs.stat(cacheFile);
    const ageMs = Date.now() - stat.mtimeMs;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return ageDays < cacheDays;
  } catch {
    return false;
  }
};

/**
 * Read cached catalog
 */
const readCache = async (
  cacheFile: string,
): Promise<GamePassCatalog | null> => {
  try {
    const content = await fs.readFile(cacheFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
};

/**
 * Write catalog to cache
 */
const writeCache = async (
  cacheFile: string,
  catalog: GamePassCatalog,
): Promise<void> => {
  const dir = path.dirname(cacheFile);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(catalog, null, 2), 'utf-8');
};

/**
 * Maps a raw Microsoft product object to a GamePassGame.
 * Exported for testing.
 */
export const mapProduct = (product: any): GamePassGame | null => {
  const title: string = product.LocalizedProperties?.[0]?.ProductTitle || '';
  if (!title) return null;
  const images: any[] = product.LocalizedProperties?.[0]?.Images ?? [];
  const boxArt = images.find((img: any) => img.ImagePurpose === 'BoxArt');
  const poster = images.find((img: any) => img.ImagePurpose === 'Poster');
  const imageEntry = boxArt ?? poster;
  const coverImageUrl = imageEntry?.Uri ? `https:${imageEntry.Uri}` : undefined;
  const releaseDate: string | undefined =
    product.MarketProperties?.[0]?.OriginalReleaseDate ?? undefined;
  return {
    id: product.ProductId || title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title,
    available: true,
    coverImageUrl,
    releaseDate,
  };
};

/**
 * Fetch current Game Pass catalog from Microsoft's official catalog API
 */
const fetchCatalog = async (): Promise<GamePassGame[]> => {
  try {
    // Platform IDs from Microsoft's catalog API
    // Fetching PC Game Pass since that's most relevant for Steam/ProtonDB comparison
    const platformIds = {
      console: 'f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e',
      pc: 'fdd9e2a7-0fee-49f6-ad69-4354098401ff',
      eaPlay: 'b8900d09-a491-44cc-916e-32b5acae621b',
    };

    const language = 'en-us';
    const market = 'US';

    // Step 1: Fetch game IDs for PC Game Pass
    console.log('Fetching PC Game Pass game IDs from Microsoft catalog...');
    const idsResponse = await axios.get(
      `https://catalog.gamepass.com/sigls/v2?id=${platformIds.pc}&language=${language}&market=${market}`,
    );

    const gameIds: string[] = idsResponse.data
      .filter((entry: any) => entry.id)
      .map((entry: any) => entry.id as string);

    // Build position map from the ordered IDs list (index 0 = most recently added per MS catalog)
    const positionByProductId = new Map(gameIds.map((id, idx) => [id, idx]));

    console.log(`Found ${gameIds.length} PC Game Pass game IDs`);

    // Step 2: Fetch detailed properties for all games
    console.log('Fetching game details from Microsoft display catalog...');
    const detailsResponse = await axios.get(
      `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${gameIds.join(
        ',',
      )}&market=${market}&languages=${language}`,
    );

    // Step 3: Extract game titles from the detailed response
    // Assign catalogPosition from the ordered IDs list so "recently added" sort works
    const games: GamePassGame[] = detailsResponse.data.Products.map(
      mapProduct,
    )
      .filter((g: GamePassGame | null): g is GamePassGame => g !== null)
      .map((g: GamePassGame) => ({
        ...g,
        catalogPosition: positionByProductId.get(g.id) ?? Number.MAX_SAFE_INTEGER,
      }));

    console.log(
      `✅ Successfully fetched ${games.length} PC Game Pass titles from Microsoft API`,
    );

    if (games.length === 0) {
      console.warn('⚠️  API returned no games. This is unexpected.');
    }

    return games;
  } catch (error) {
    console.error(
      'Failed to fetch Game Pass catalog from Microsoft API:',
      error,
    );
    throw new Error(
      'Failed to fetch Game Pass catalog. You can manually create .cache/gamepass/gamepass-catalog.json',
    );
  }
};

/**
 * Create Game Pass adapter with caching
 */
export const createGamePassAdapter = (cacheDir: string, cacheDays: number) => {
  const cacheFile = path.join(cacheDir, 'gamepass-catalog.json');

  /**
   * Get current Game Pass catalog
   * Uses cache if valid, otherwise fetches fresh data
   */
  const getCatalog = async (): Promise<GamePassGame[]> => {
    // Check if cache exists and is valid
    const cacheValid = await isCacheValid(cacheFile, cacheDays);

    if (cacheValid) {
      console.log('Using cached Game Pass catalog');
      const cached = await readCache(cacheFile);
      if (cached) {
        return cached.games;
      }
    }

    // Cache is invalid or doesn't exist, fetch fresh data
    console.log('Fetching fresh Game Pass catalog...');
    try {
      const freshGames = await fetchCatalog();

      // Preserve firstSeenAt for games already in the cache
      const staleCache = await readCache(cacheFile);
      const existingById = new Map(
        (staleCache?.games ?? []).map((g) => [g.id, g]),
      );
      const now = new Date().toISOString();
      const games = freshGames.map((g) => ({
        ...g,
        firstSeenAt: existingById.get(g.id)?.firstSeenAt ?? now,
      }));

      const catalog: GamePassCatalog = {
        lastUpdated: now,
        games,
      };

      await writeCache(cacheFile, catalog);
      console.log(`✅ Cached ${games.length} Game Pass games`);

      return games;
    } catch (error) {
      // If fetch fails, try to use stale cache
      console.warn('Failed to fetch catalog, attempting to use stale cache...');
      const cached = await readCache(cacheFile);
      if (cached) {
        console.log('Using stale cache as fallback');
        return cached.games;
      }
      throw error;
    }
  };

  /**
   * Check if a game is currently available on Game Pass
   */
  const isGameAvailable = async (gameTitle: string): Promise<boolean> => {
    const catalog = await getCatalog();
    const normalizedTitle = gameTitle.toLowerCase().trim();

    return catalog.some(
      game => game.title.toLowerCase().trim() === normalizedTitle,
    );
  };

  /**
   * Get all available game titles
   */
  const getAvailableTitles = async (): Promise<string[]> => {
    const catalog = await getCatalog();
    return catalog.map(game => game.title);
  };

  return {
    getCatalog,
    isGameAvailable,
    getAvailableTitles,
  };
};

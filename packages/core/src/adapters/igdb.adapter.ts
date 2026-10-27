import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { log } from '../logger';

/**
 * IGDB API adapter for matching games to Steam App IDs
 * Uses Twitch OAuth for authentication
 * Free tier: 4 requests/second, no monthly limit
 */

interface IGDBAuthToken {
  access_token: string;
  expires_in: number;
  token_type: string;
  expires_at: number;
}

interface IGDBGame {
  id: number;
  name: string;
  external_games?: Array<{
    external_game_source: number; // 1 = Steam (replaced the removed `category` field)
    uid: string; // Steam App ID
  }>;
  websites?: Array<{
    category: number; // 13 = Steam
    url: string; // Steam store URL
  }>;
}

interface CacheEntry {
  appId: number | null;
  lastChecked: number; // timestamp
}

type SteamAppIdCache = Record<string, number | null | CacheEntry>;

const TWITCH_CLIENT_ID = process.env.IGDB_CLIENT_ID || '';
const TWITCH_CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET || '';
const IGDB_API_URL = 'https://api.igdb.com/v4';
const TOKEN_CACHE_PATH = './.cache/igdb-token.json';
const STEAM_APP_ID_CACHE_PATH = './.cache/steam-appid-cache.json';
const RETRY_FAILED_AFTER_DAYS = 30; // Retry null entries after 30 days

let authToken: IGDBAuthToken | null = null;
let steamAppIdCache: SteamAppIdCache = {};

/**
 * Load cached authentication token
 */
const loadTokenCache = async (): Promise<IGDBAuthToken | null> => {
  try {
    const content = await fs.readFile(TOKEN_CACHE_PATH, 'utf-8');
    const token: IGDBAuthToken = JSON.parse(content);

    // Check if token is still valid (with 1 hour buffer)
    const now = Date.now();
    if (token.expires_at > now + 3600000) {
      return token;
    }
  } catch {
    // Cache doesn't exist or is invalid
  }
  return null;
};

/**
 * Save authentication token to cache
 */
const saveTokenCache = async (token: IGDBAuthToken): Promise<void> => {
  const tokenWithExpiry = {
    ...token,
    expires_at: Date.now() + token.expires_in * 1000,
  };

  await fs.mkdir(path.dirname(TOKEN_CACHE_PATH), { recursive: true });
  await fs.writeFile(
    TOKEN_CACHE_PATH,
    JSON.stringify(tokenWithExpiry, null, 2)
  );
};

/**
 * Authenticate with Twitch to get IGDB access token
 */
const authenticate = async (): Promise<string> => {
  if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
    throw new Error(
      'IGDB credentials not configured. Set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET environment variables.'
    );
  }

  // Try to load from cache first
  const cachedToken = await loadTokenCache();
  if (cachedToken) {
    authToken = cachedToken;
    return cachedToken.access_token;
  }

  // Get new token from Twitch
  const response = await axios.post<IGDBAuthToken>(
    'https://id.twitch.tv/oauth2/token',
    null,
    {
      params: {
        client_id: TWITCH_CLIENT_ID,
        client_secret: TWITCH_CLIENT_SECRET,
        grant_type: 'client_credentials',
      },
    }
  );

  authToken = response.data;
  await saveTokenCache(authToken);

  return authToken.access_token;
};

/**
 * Normalize a cache entry to the new format
 */
const normalizeCacheEntry = (value: number | null | CacheEntry): CacheEntry => {
  // If it's already the new format
  if (
    typeof value === 'object' &&
    value !== null &&
    'appId' in value &&
    'lastChecked' in value
  ) {
    return value;
  }

  // Convert old format (plain number or null) to new format
  return {
    appId: typeof value === 'number' ? value : null,
    lastChecked: Date.now(),
  };
};

/**
 * Check if a cache entry should be retried
 */
const shouldRetryEntry = (entry: CacheEntry): boolean => {
  // Always keep successful matches
  if (entry.appId !== null) {
    return false;
  }

  // Retry null entries after RETRY_FAILED_AFTER_DAYS
  const daysSinceCheck =
    (Date.now() - entry.lastChecked) / (1000 * 60 * 60 * 24);
  return daysSinceCheck >= RETRY_FAILED_AFTER_DAYS;
};

/**
 * Load Steam App ID cache
 */
const loadSteamAppIdCache = async (): Promise<void> => {
  try {
    const content = await fs.readFile(STEAM_APP_ID_CACHE_PATH, 'utf-8');
    steamAppIdCache = JSON.parse(content);
  } catch {
    steamAppIdCache = {};
  }
};

/**
 * Save Steam App ID cache
 */
const saveSteamAppIdCache = async (): Promise<void> => {
  await fs.mkdir(path.dirname(STEAM_APP_ID_CACHE_PATH), { recursive: true });
  await fs.writeFile(
    STEAM_APP_ID_CACHE_PATH,
    JSON.stringify(steamAppIdCache, null, 2)
  );
};

/**
 * Normalize game name for fuzzy matching
 */
const normalizeForMatching = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[™®©]/g, '') // Remove trademark symbols
    .replace(/[‘’‚]/g, "'") // Curly apostrophes → straight (DB vs IGDB casing)
    .replace(/[:\-–—]/g, ' ') // Replace punctuation with spaces
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
};

/**
 * Canonicalize a trailing roman/arabic sequel numeral ("II" / "2") to
 * arabic so "Alan Wake 2" matches IGDB's "Alan Wake II". Single-char
 * tokens (I, X) are excluded — too easy to confuse with real words.
 */
const ROMAN_NUMERALS: Record<string, string> = {
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
};

const foldTrailingNumeral = (normalized: string): string => {
  const match = normalized.match(/^(.*\s)([a-z]+|\d{1,2})$/);
  if (!match) return normalized;
  const [, base, token] = match;
  const arabic = ROMAN_NUMERALS[token] ?? (/^\d{1,2}$/.test(token) ? token : null);
  return arabic ? base + arabic : normalized;
};

/**
 * Remove common edition suffixes for broader matching
 */
const removeEditionSuffix = (name: string): string => {
  return name
    .replace(
      /\s*-?\s*(standard|deluxe|ultimate|complete|definitive|enhanced|remastered|redux|gold|goty|game of the year|collector's|digital)\s*(edition|ver\.?|version)?\s*$/i,
      ''
    )
    .trim();
};

/**
 * Extract Steam App ID from a Steam store URL
 */
const extractSteamAppIdFromUrl = (url: string): number | null => {
  // Steam store URLs: https://store.steampowered.com/app/271590/Grand_Theft_Auto_V/
  // or https://store.steampowered.com/app/257850 (without trailing slash)
  const match = url.match(/\/app\/(\d+)/);
  if (match) {
    const appId = parseInt(match[1], 10);
    return isNaN(appId) ? null : appId;
  }
  return null;
};

/**
 * Search for a game on IGDB and return its Steam App ID
 */
const findSteamAppId = async (gameName: string): Promise<number | null> => {
  // Normalize cache key
  const cacheKey = gameName.toLowerCase().trim();

  // Check cache first
  if (cacheKey in steamAppIdCache) {
    const entry = normalizeCacheEntry(steamAppIdCache[cacheKey]);

    // If it's a successful match, return immediately
    if (entry.appId !== null) {
      return entry.appId;
    }

    // If it's a null entry but not old enough to retry, return null
    if (!shouldRetryEntry(entry)) {
      return null;
    }

    // Otherwise, fall through to retry the lookup
  }

  try {
    const token = await authenticate();

    // Try multiple search strategies
    const searchTerms = [
      gameName, // Original name
      removeEditionSuffix(gameName), // Without edition suffix
    ];

    // Deduplicate search terms
    const uniqueSearchTerms = Array.from(new Set(searchTerms));

    for (const searchTerm of uniqueSearchTerms) {
      // Search for the game on IGDB
      const response = await axios.post<IGDBGame[]>(
        `${IGDB_API_URL}/games`,
        `search "${searchTerm}"; fields id, name, websites.*; limit 10;`,
        {
          headers: {
            'Client-ID': TWITCH_CLIENT_ID,
            Authorization: `Bearer ${token}`,
          },
        }
      );

      log.info(
        `[IGDB] Search "${searchTerm}" returned ${
          response.data?.length || 0
        } results`
      );

      if (!response.data || response.data.length === 0) {
        log.info(`[IGDB] No results for "${searchTerm}"`);
        continue; // Try next search term
      }

      // Collect all game IDs to query external_games in one batch
      const gameIds = response.data.map(g => g.id).join(',');

      // Small delay to avoid rate limiting (we just made 1 call for search)
      await new Promise(resolve => setTimeout(resolve, 250));

      try {
        // Fetch all external_games for these games in one request
        const externalResponse = await axios.post<
          Array<{ game: number; external_game_source: number; uid: string }>
        >(
          `${IGDB_API_URL}/external_games`,
          `fields game, external_game_source, uid; where game = (${gameIds}) & external_game_source = 1;`,
          {
            headers: {
              'Client-ID': TWITCH_CLIENT_ID,
              Authorization: `Bearer ${token}`,
            },
          }
        );

        // Map external_games back to their games
        const externalGamesMap = new Map<
          number,
          Array<{ external_game_source: number; uid: string }>
        >();
        for (const ext of externalResponse.data) {
          if (!externalGamesMap.has(ext.game)) {
            externalGamesMap.set(ext.game, []);
          }
          externalGamesMap
            .get(ext.game)!
            .push({ external_game_source: ext.external_game_source, uid: ext.uid });
        }

        // Attach to games
        for (const game of response.data) {
          game.external_games = externalGamesMap.get(game.id) || [];
        }
      } catch (error) {
        log.warn(
          `[IGDB] Failed to fetch external_games for batch:`,
          error instanceof Error ? error.message : error
        );
        // Set empty arrays so we don't fail
        for (const game of response.data) {
          game.external_games = [];
        }
      }

      // Normalize the search term for comparison
      const normalizedSearch = normalizeForMatching(searchTerm);
      const searchWithoutEdition = normalizeForMatching(
        removeEditionSuffix(searchTerm)
      );

      // Look for matches in order of preference
      for (const game of response.data) {
        const normalizedGameName = normalizeForMatching(game.name);
        const gameNameWithoutEdition = normalizeForMatching(
          removeEditionSuffix(game.name)
        );

        // Check for various levels of matching
        const isExactMatch = normalizedGameName === normalizedSearch;
        const isCloseMatch = normalizedGameName === searchWithoutEdition;
        const isCoreMatch = gameNameWithoutEdition === searchWithoutEdition;

        if (isExactMatch || isCloseMatch || isCoreMatch) {
          // Try external_games first (source 1 = Steam)
          const steamExternal = game.external_games?.find(
            eg => eg.external_game_source === 1
          );

          if (steamExternal) {
            const appId = parseInt(steamExternal.uid, 10);
            if (!isNaN(appId)) {
              // Cache the result with timestamp
              steamAppIdCache[cacheKey] = {
                appId,
                lastChecked: Date.now(),
              };
              await saveSteamAppIdCache();
              return appId;
            }
          }

          // Fallback: Try websites - look for Steam store URLs
          const steamWebsite = game.websites?.find(
            w => w.url && w.url.includes('steampowered.com/app/')
          );

          if (steamWebsite) {
            const appId = extractSteamAppIdFromUrl(steamWebsite.url);
            if (appId) {
              // Cache the result with timestamp
              steamAppIdCache[cacheKey] = {
                appId,
                lastChecked: Date.now(),
              };
              await saveSteamAppIdCache();
              return appId;
            }
          }
        }
      }

      // If no match with Steam ID, try first result with Steam external_games or website
      for (const game of response.data) {
        // Try external_games
        const steamExternal = game.external_games?.find(
          eg => eg.external_game_source === 1
        );

        if (steamExternal) {
          const appId = parseInt(steamExternal.uid, 10);
          if (!isNaN(appId)) {
            // This is a weaker match, but might be correct
            // Cache the result with timestamp
            steamAppIdCache[cacheKey] = {
              appId,
              lastChecked: Date.now(),
            };
            await saveSteamAppIdCache();
            return appId;
          }
        }

        // Try websites as fallback - look for Steam store URLs
        const steamWebsite = game.websites?.find(
          w => w.url && w.url.includes('steampowered.com/app/')
        );

        if (steamWebsite) {
          const appId = extractSteamAppIdFromUrl(steamWebsite.url);
          if (appId) {
            // Cache the result with timestamp
            steamAppIdCache[cacheKey] = {
              appId,
              lastChecked: Date.now(),
            };
            await saveSteamAppIdCache();
            return appId;
          }
        }
      }
    }

    // No Steam App ID found after all strategies - cache null with timestamp
    steamAppIdCache[cacheKey] = {
      appId: null,
      lastChecked: Date.now(),
    };
    await saveSteamAppIdCache();
    return null;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      log.warn(
        `IGDB API error for "${gameName}":`,
        error.response?.status,
        error.response?.data
      );
    } else {
      log.warn(`Failed to find Steam App ID for "${gameName}":`, error);
    }
    return null;
  }
};

/**
 * Initialize the IGDB adapter
 */
const initialize = async (): Promise<void> => {
  await loadSteamAppIdCache();

  // Test authentication
  try {
    await authenticate();
    log.info('✅ IGDB authentication successful');
  } catch (error) {
    log.warn('⚠️  IGDB authentication failed:', error);
    log.warn('Steam App ID lookup for non-Steam games will be disabled.');
  }
};

/**
 * Get cache statistics
 */
const getCacheStats = (): {
  totalEntries: number;
  foundEntries: number;
  notFoundEntries: number;
  retriableEntries: number;
} => {
  const entries = Object.values(steamAppIdCache).map(normalizeCacheEntry);
  const notFoundEntries = entries.filter(e => e.appId === null);
  const retriableEntries = notFoundEntries.filter(shouldRetryEntry);

  return {
    totalEntries: entries.length,
    foundEntries: entries.filter(e => e.appId !== null).length,
    notFoundEntries: notFoundEntries.length,
    retriableEntries: retriableEntries.length,
  };
};

/**
 * Clear the Steam App ID cache
 */
const clearCache = async (): Promise<void> => {
  steamAppIdCache = {};
  await saveSteamAppIdCache();
};

// ── Metadata enrichment (P3.3) ────────────────────────────────────────────────

export type IgdbMatch = {
  igdbId: number;
  name: string;
};

export type IgdbGameDetails = {
  igdbId: number;
  name: string;
  summary?: string;
  genres: string[];
  themes: string[];
  keywords: string[];
  similarGameIds: number[];
  developers: string[];
  publishers: string[];
};

const igdbHeaders = (token: string) => ({
  'Client-ID': TWITCH_CLIENT_ID,
  Authorization: `Bearer ${token}`,
});

/**
 * Resolve the IGDB game id for a Steam app via external_games
 * (external_game_source 1 = Steam, uid = appid).
 */
const fetchGameBySteamAppId = async (
  steamAppId: number,
): Promise<IgdbMatch | null> => {
  try {
    const token = await authenticate();

    const externalResponse = await axios.post<Array<{ id: number; game: number }>>(
      `${IGDB_API_URL}/external_games`,
      `where uid = "${steamAppId}" & external_game_source = 1; fields id, game; limit 1;`,
      { headers: igdbHeaders(token) },
    );
    const external = externalResponse.data?.[0];
    if (!external?.game) return null;

    const gameResponse = await axios.post<Array<{ id: number; name: string }>>(
      `${IGDB_API_URL}/games`,
      `where id = ${external.game}; fields id, name; limit 1;`,
      { headers: igdbHeaders(token) },
    );
    const game = gameResponse.data?.[0];
    if (!game) return null;

    return { igdbId: game.id, name: game.name };
  } catch (error) {
    log.warn(
      `[IGDB] Steam lookup failed for app ${steamAppId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
};

/**
 * Fetch full metadata for an IGDB game id: summary, genres, themes,
 * keywords, similar game ids, and involved companies.
 */
const fetchGameDetails = async (
  igdbId: number,
): Promise<IgdbGameDetails | null> => {
  try {
    const token = await authenticate();

    const response = await axios.post<
      Array<{
        id: number;
        name: string;
        summary?: string;
        genres?: Array<{ name: string }>;
        themes?: Array<{ name: string }>;
        keywords?: Array<{ name: string }>;
        similar_games?: Array<{ id: number }>;
        involved_companies?: Array<{
          company: { name: string };
          developer?: boolean;
          publisher?: boolean;
        }>;
      }>
    >(
      `${IGDB_API_URL}/games`,
      `where id = ${igdbId}; fields name, summary, genres.name, themes.name, keywords.name, similar_games.id, involved_companies.company.name, involved_companies.developer, involved_companies.publisher; limit 1;`,
      { headers: igdbHeaders(token) },
    );

    const game = response.data?.[0];
    if (!game) return null;

    return {
      igdbId: game.id,
      name: game.name,
      summary: game.summary,
      genres: (game.genres ?? []).map((g) => g.name).filter(Boolean),
      themes: (game.themes ?? []).map((t) => t.name).filter(Boolean),
      keywords: (game.keywords ?? []).map((k) => k.name).filter(Boolean),
      similarGameIds: (game.similar_games ?? []).map((s) => s.id),
      developers: (game.involved_companies ?? [])
        .filter((c) => c.developer)
        .map((c) => c.company.name)
        .filter(Boolean),
      publishers: (game.involved_companies ?? [])
        .filter((c) => c.publisher)
        .map((c) => c.company.name)
        .filter(Boolean),
    };
  } catch (error) {
    log.warn(
      `[IGDB] Details fetch failed for game ${igdbId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
};

/**
 * Drop trailing parenthetical qualifiers — "(Windows)", "(Game Preview)",
 * "(Classic)" — which IGDB names never carry.
 */
const removeTrailingParens = (name: string): string =>
  name.replace(/\s*\([^)]*\)\s*$/, '').trim();

/**
 * Resolve an IGDB game id by exact-ish name: search, then match on the
 * normalized name (or edition/paren-stripped forms). No first-result
 * fallback — misattached metadata is worse than a skipped game; force
 * retries.
 */
const stripAllEditions = (name: string): string => {
  let current = name;
  for (;;) {
    const next = removeEditionSuffix(removeTrailingParens(current));
    if (next === current) return current;
    current = next;
  }
};

const findByName = async (name: string): Promise<IgdbMatch | null> => {
  try {
    const token = await authenticate();

    // IGDB's search returns no results for queries containing ™®© or
    // parentheses, so retry with the cleaned form before giving up.
    const cleaned = normalizeForMatching(stripAllEditions(name));
    const searchTerms = [...new Set([name, cleaned])].filter(t =>
      t.trim().length > 0,
    );

    const target = normalizeForMatching(name);
    const targetCore = normalizeForMatching(stripAllEditions(name));
    const targetFolded = foldTrailingNumeral(target);

    for (const term of searchTerms) {
      const response = await axios.post<Array<{ id: number; name: string }>>(
        `${IGDB_API_URL}/games`,
        `search "${term.replace(/"/g, '')}"; fields id, name; limit 10;`,
        { headers: igdbHeaders(token) },
      );
      const results = response.data ?? [];
      if (results.length === 0) continue;

      const match =
        results.find((g) => normalizeForMatching(g.name) === target) ??
        results.find(
          (g) =>
            normalizeForMatching(stripAllEditions(g.name)) === targetCore,
        ) ??
        results.find(
          (g) =>
            foldTrailingNumeral(normalizeForMatching(g.name)) ===
            targetFolded,
        );
      if (match) return { igdbId: match.id, name: match.name };
    }

    return null;
  } catch (error) {
    log.warn(
      `[IGDB] Name lookup failed for "${name}":`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
};

export const igdbAdapter = {
  initialize,
  findSteamAppId,
  getCacheStats,
  clearCache,
  fetchGameBySteamAppId,
  fetchGameDetails,
  findByName,
};

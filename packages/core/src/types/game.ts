import { z } from 'zod';

/**
 * Source platforms for games
 */
export const SourceSchema = z.enum([
  'steam',
  'xbox',
  'epic',
  'gog',
  'amazon',
  'gamepass',
  'manual',
]);

export type Source = z.infer<typeof SourceSchema>;

/**
 * Platform priority for deduplication (lower number = higher priority)
 */
export const PLATFORM_PRIORITY: Record<Source, number> = {
  steam: 1,
  xbox: 2,
  gamepass: 2,
  epic: 3,
  gog: 4,
  amazon: 5,
  manual: 6,
};

/**
 * Per-source screenshot URLs (stored as a JSON map on `games.screenshots`).
 * Keys are capture providers, not store sources: `ms` covers xbox/gamepass,
 * `igdb` is the last-resort fallback for stores without their own media.
 */
export const SCREENSHOT_SOURCES = ['steam', 'gog', 'ms', 'igdb'] as const;
export type ScreenshotSource = (typeof SCREENSHOT_SOURCES)[number];
export type ScreenshotMap = Partial<Record<ScreenshotSource, string[]>>;

/** Gallery size per source — hero + drawer need a handful, not everything. */
export const SCREENSHOTS_PER_SOURCE = 5;

export const ScreenshotMapSchema = z.object({
  steam: z.array(z.string()).optional(),
  gog: z.array(z.string()).optional(),
  ms: z.array(z.string()).optional(),
  igdb: z.array(z.string()).optional(),
});

export const capScreenshotUrls = (urls: string[]): string[] =>
  urls.slice(0, SCREENSHOTS_PER_SOURCE);

export const capScreenshotMap = (map: ScreenshotMap): ScreenshotMap => {
  const capped: ScreenshotMap = {};
  for (const key of SCREENSHOT_SOURCES) {
    const urls = map[key];
    if (urls) capped[key] = capScreenshotUrls(urls);
  }
  return capped;
};

export const parseScreenshotMap = (json: string | null): ScreenshotMap => {
  if (!json) return {};
  try {
    const parsed = ScreenshotMapSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
};

/** Store source → screenshot-provider key (null = no direct store media). */
export const screenshotKeyForSource = (
  source: Source,
): ScreenshotSource | null => {
  if (source === 'steam') return 'steam';
  if (source === 'gog') return 'gog';
  if (source === 'xbox' || source === 'gamepass') return 'ms';
  return null;
};

/**
 * Resolve the display list: owned sources in platform-priority order —
 * the first provider with actual URLs wins; IGDB is the final fallback so
 * Epic/Amazon titles (no store media) still get images.
 */
export const resolveScreenshots = (
  map: ScreenshotMap | null | undefined,
  ownedSources: Source[],
): string[] => {
  if (!map) return [];
  const sorted = [...ownedSources].sort(
    (a, b) => PLATFORM_PRIORITY[a] - PLATFORM_PRIORITY[b],
  );
  for (const source of sorted) {
    const key = screenshotKeyForSource(source);
    const urls = key ? map[key] : undefined;
    if (urls && urls.length > 0) return urls;
  }
  return map.igdb && map.igdb.length > 0 ? map.igdb : [];
};

/**
 * Per-key union (winner order first, capped). A key present on either side
 * is kept — an explicit `[]` marks "captured, none found" and must survive.
 * Null only when neither side has any key.
 */
export const mergeScreenshotMaps = (
  winner: ScreenshotMap | null | undefined,
  loser: ScreenshotMap | null | undefined,
): ScreenshotMap | null => {
  const merged: ScreenshotMap = {};
  for (const key of SCREENSHOT_SOURCES) {
    const w = winner?.[key];
    const l = loser?.[key];
    if (w === undefined && l === undefined) continue;
    merged[key] = capScreenshotUrls([
      ...new Set([...(w ?? []), ...(l ?? [])]),
    ]);
  }
  return Object.keys(merged).length > 0 ? merged : null;
};

/**
 * ProtonDB compatibility tier
 */
export const ProtonTierSchema = z.enum([
  'platinum',
  'gold',
  'silver',
  'bronze',
  'borked',
]);

export type ProtonTier = z.infer<typeof ProtonTierSchema>;

/**
 * Steam Deck compatibility status
 */
export const SteamDeckStatusSchema = z.enum([
  'verified',
  'playable',
  'unsupported',
  'unknown',
]);

export type SteamDeckStatus = z.infer<typeof SteamDeckStatusSchema>;

/**
 * ProtonDB information for PC games
 */
export const ProtonInfoSchema = z.object({
  tier: ProtonTierSchema,
  steamDeck: SteamDeckStatusSchema,
  confidence: z.number().optional(), // Score/confidence level
  trendingTier: ProtonTierSchema.optional(), // Recent trend
  lastUpdated: z.date().optional(),
});

export type ProtonInfo = z.infer<typeof ProtonInfoSchema>;

/**
 * User interest level
 */
export const InterestSchema = z.enum(['want-to-play', 'none']);

export type Interest = z.infer<typeof InterestSchema>;

/**
 * Unified game model - the canonical representation
 */
export const UnifiedGameSchema = z.object({
  canonicalId: z.string(), // steamAppId when available, otherwise normalized slug
  name: z.string(),
  primarySource: SourceSchema,
  ownedSources: z.array(SourceSchema),
  steamAppId: z.number().optional(),
  playtimeHours: z.number().optional(),
  lastPlayedAt: z.date().optional(),
  interest: InterestSchema.optional(),
  proton: ProtonInfoSchema.optional(),

  // Additional metadata
  coverImageUrl: z.string().optional(),
  releaseDate: z.date().optional(),
  genres: z.array(z.string()).optional(),
  description: z.string().optional(),
  developer: z.string().optional(),
  publisher: z.string().optional(),
  screenshots: ScreenshotMapSchema.optional(),

  // Tracking
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type UnifiedGame = z.infer<typeof UnifiedGameSchema>;

/**
 * Raw game data from various sources before normalization
 */
export type RawGameData = {
  source: Source;
  externalId: string; // Source-specific ID
  name: string;
  steamAppId?: number;
  playtimeHours?: number;
  lastPlayedAt?: Date;
  coverImageUrl?: string;
  releaseDate?: Date;
  genres?: string[];
  description?: string;
  developer?: string;
  publisher?: string;
  /** Per-source screenshot URLs captured by this source (e.g. `{gog:[…]}`). */
  screenshots?: ScreenshotMap;
};

/**
 * Notion sync configuration - which properties to include
 */
export const NotionSyncPropertiesSchema = z.object({
  canonicalId: z.boolean().default(true),
  primarySource: z.boolean().default(true),
  ownedOn: z.boolean().default(true),
  steamAppId: z.boolean().default(true),
  playtime: z.boolean().default(true),
  lastPlayed: z.boolean().default(true),
  protonTier: z.boolean().default(true),
  steamDeck: z.boolean().default(true),
  coverImage: z.boolean().default(true),
  libraryStatus: z.boolean().default(true),
});

export type NotionSyncProperties = z.infer<typeof NotionSyncPropertiesSchema>;

/**
 * Configuration for the application
 */
export const ConfigSchema = z.object({
  steam: z.object({
    apiKey: z.string(),
    userId: z.string(),
  }),
  notion: z.object({
    apiKey: z.string(),
    databaseId: z.string(),
    titleProperty: z.string().default('Name'),
    syncProperties: NotionSyncPropertiesSchema.optional().default({}),
  }),
  protondb: z.object({
    cacheDays: z.number().default(30),
  }),
  logLevel: z.enum(['debug', 'info']).default('info'),
  dryRun: z.boolean().default(false),
  playniteEnabled: z.boolean().default(false),
  heroic: z.object({
    storeCachePath: z.string(),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

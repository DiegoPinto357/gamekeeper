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
  epic: 3,
  gog: 4,
  amazon: 5,
  gamepass: 6,
  manual: 7,
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
});

export type Config = z.infer<typeof ConfigSchema>;

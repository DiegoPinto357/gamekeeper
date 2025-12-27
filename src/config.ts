import { Config, ConfigSchema } from './types/game';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Load and validate configuration from environment variables
 */
export const loadConfig = (): Config => {
  const config = {
    steam: {
      apiKey: process.env.STEAM_API_KEY || '',
      userId: process.env.STEAM_USER_ID || '',
    },
    notion: {
      apiKey: process.env.NOTION_API_KEY || '',
      databaseId: process.env.NOTION_DATABASE_ID || '',
      titleProperty: process.env.NOTION_TITLE_PROPERTY || 'Name',
      syncProperties: {
        canonicalId: process.env.NOTION_SYNC_CANONICAL_ID !== 'false',
        primarySource: process.env.NOTION_SYNC_PRIMARY_SOURCE !== 'false',
        ownedOn: process.env.NOTION_SYNC_OWNED_ON !== 'false',
        steamAppId: process.env.NOTION_SYNC_STEAM_APP_ID !== 'false',
        playtime: process.env.NOTION_SYNC_PLAYTIME !== 'false',
        lastPlayed: process.env.NOTION_SYNC_LAST_PLAYED !== 'false',
        protonTier: process.env.NOTION_SYNC_PROTON_TIER !== 'false',
        steamDeck: process.env.NOTION_SYNC_STEAM_DECK !== 'false',
        coverImage: process.env.NOTION_SYNC_COVER_IMAGE !== 'false',
      },
    },
    protondb: {
      cacheDays: parseInt(process.env.PROTONDB_CACHE_DAYS || '30', 10),
    },
  };

  return ConfigSchema.parse(config);
};

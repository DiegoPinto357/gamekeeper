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
    },
    protondb: {
      cacheDays: parseInt(process.env.PROTONDB_CACHE_DAYS || '30', 10),
    },
  };

  return ConfigSchema.parse(config);
}

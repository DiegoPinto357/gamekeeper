#!/usr/bin/env node

/**
 * Setup validation script
 * Checks that all required configuration is in place
 */

import dotenv from 'dotenv';
import fs from 'fs/promises';
import { SteamAdapter } from './adapters/steam.adapter.js';

dotenv.config();

async function validate() {
  console.log('🔍 GameKeeper Setup Validation\n');

  let hasErrors = false;

  // Check .env file
  console.log('📋 Checking environment variables...');

  const requiredEnvVars = [
    'STEAM_API_KEY',
    'STEAM_USER_ID',
    'NOTION_API_KEY',
    'NOTION_DATABASE_ID',
  ];

  for (const varName of requiredEnvVars) {
    const value = process.env[varName];
    if (!value || value === `your_${varName.toLowerCase()}_here`) {
      console.log(`   ❌ ${varName} is not set or still has default value`);
      hasErrors = true;
    } else {
      console.log(`   ✅ ${varName} is set`);
    }
  }

  // Validate Steam ID format
  if (process.env.STEAM_USER_ID) {
    if (!SteamAdapter.isValidSteamId(process.env.STEAM_USER_ID)) {
      console.log(
        `   ⚠️  STEAM_USER_ID format looks incorrect (should be 17 digits)`
      );
      hasErrors = true;
    }
  }

  console.log();

  // Check data directory
  console.log('📁 Checking data directory...');

  try {
    await fs.access('./data');
    console.log('   ✅ data/ directory exists');

    try {
      await fs.access('./data/playnite-export.json');
      console.log('   ✅ data/playnite-export.json found');
    } catch {
      console.log(
        '   ⚠️  data/playnite-export.json not found (optional, but needed for Epic/GOG/Xbox)'
      );
    }
  } catch {
    console.log('   ❌ data/ directory not found');
    hasErrors = true;
  }

  console.log();

  // Check cache directory
  console.log('📦 Checking cache directory...');

  try {
    await fs.access('.cache');
    console.log('   ✅ .cache/ directory exists');
  } catch {
    console.log('   ℹ️  .cache/ directory will be created automatically');
  }

  console.log();

  if (hasErrors) {
    console.log('❌ Setup validation failed. Please fix the errors above.\n');
    console.log('💡 Tips:');
    console.log('   • Copy .env.example to .env and fill in your credentials');
    console.log(
      '   • Get Steam API key: https://steamcommunity.com/dev/apikey'
    );
    console.log('   • Get Steam ID: https://steamid.io/');
    console.log(
      '   • Create Notion integration: https://www.notion.so/my-integrations\n'
    );
    process.exit(1);
  } else {
    console.log('✅ Setup validation passed!\n');
    console.log('You can now run:');
    console.log('   npm run dev\n');
  }
}

validate().catch(error => {
  console.error('Validation error:', error);
  process.exit(1);
});

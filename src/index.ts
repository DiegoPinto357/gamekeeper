import { loadConfig } from './config.js';
import { SteamAdapter } from './adapters/steam.adapter.js';
import { PlayniteAdapter } from './adapters/playnite.adapter.js';
import { ProtonDBAdapter } from './adapters/protondb.adapter.js';
import { NotionClient } from './notion/notion.client.js';
import { processRawGames } from './core/deduplicate.js';
import { RawGameData, UnifiedGame } from './types/game.js';

/**
 * Main orchestration function
 * Coordinates the entire sync process
 */
async function main() {
  console.log('🎮 GameKeeper - Starting sync...\n');

  try {
    // 1. Load configuration
    console.log('📋 Loading configuration...');
    const config = loadConfig();
    console.log('✅ Configuration loaded\n');

    // 2. Initialize adapters
    console.log('🔧 Initializing adapters...');
    const steamAdapter = new SteamAdapter(config.steam.apiKey, config.steam.userId);
    const playniteAdapter = new PlayniteAdapter('./data/playnite-export.json');
    const protonDbAdapter = new ProtonDBAdapter('.cache/protondb', config.protondb.cacheDays);
    const notionClient = new NotionClient(config.notion.apiKey, config.notion.databaseId);

    await protonDbAdapter.init();
    console.log('✅ Adapters initialized\n');

    // 3. Verify Notion database access
    console.log('🔍 Verifying Notion database...');
    const notionAccessible = await notionClient.verifyDatabase();
    if (!notionAccessible) {
      throw new Error('Cannot access Notion database. Check your API key and database ID.');
    }
    console.log('✅ Notion database verified\n');

    // 4. Fetch games from all sources
    console.log('📥 Fetching games from sources...\n');
    
    const rawGames: RawGameData[] = [];

    // Fetch Steam games
    console.log('⚙️  Fetching from Steam...');
    try {
      const steamGames = await steamAdapter.fetchOwnedGames();
      rawGames.push(...steamGames);
      console.log(`✅ Steam: ${steamGames.length} games\n`);
    } catch (error) {
      console.error('❌ Failed to fetch Steam games:', error);
      console.log('Continuing without Steam data...\n');
    }

    // Load Playnite snapshot
    console.log('📦 Loading Playnite snapshot...');
    try {
      const playniteGames = await playniteAdapter.loadSnapshot();
      rawGames.push(...playniteGames);
      console.log(`✅ Playnite: ${playniteGames.length} games\n`);
    } catch (error) {
      console.error('❌ Failed to load Playnite snapshot:', error);
      console.log('Continuing without Playnite data...\n');
    }

    if (rawGames.length === 0) {
      console.warn('⚠️  No games found from any source. Exiting.');
      return;
    }

    console.log(`📊 Total raw games: ${rawGames.length}\n`);

    // 5. Deduplicate and merge games
    console.log('🔄 Deduplicating and merging games...');
    const unifiedGames = processRawGames(rawGames);
    console.log(`✅ Unified into ${unifiedGames.length} games\n`);

    // 6. Enrich PC games with ProtonDB data
    console.log('🐧 Enriching PC games with ProtonDB data...');
    let enrichedCount = 0;
    
    for (const game of unifiedGames) {
      // Only enrich if game has a Steam AppID (PC games)
      if (game.steamAppId) {
        try {
          const protonInfo = await protonDbAdapter.fetchCompatibility(game.steamAppId);
          if (protonInfo) {
            game.proton = protonInfo;
            enrichedCount++;
          }
          
          // Rate limiting for ProtonDB
          if (enrichedCount % 5 === 0) {
            await sleep(1000);
          }
        } catch (error) {
          console.warn(`Failed to fetch ProtonDB data for "${game.name}":`, error);
        }
      }
    }
    
    console.log(`✅ Enriched ${enrichedCount} games with ProtonDB data\n`);

    // 7. Clean expired ProtonDB cache
    console.log('🧹 Cleaning expired ProtonDB cache...');
    await protonDbAdapter.cleanCache();
    console.log('✅ Cache cleaned\n');

    // 8. Sync to Notion
    console.log('☁️  Syncing to Notion...');
    await notionClient.syncGames(unifiedGames);
    console.log('✅ Sync to Notion complete\n');

    // 9. Summary
    console.log('📈 Summary:');
    console.log(`   • Total unique games: ${unifiedGames.length}`);
    console.log(`   • Games with ProtonDB data: ${enrichedCount}`);
    
    const sourceBreakdown = getSourceBreakdown(unifiedGames);
    console.log(`   • Source breakdown:`);
    for (const [source, count] of Object.entries(sourceBreakdown)) {
      console.log(`     - ${source}: ${count} games`);
    }

    console.log('\n✅ GameKeeper sync completed successfully!');
  } catch (error) {
    console.error('\n❌ Error during sync:', error);
    process.exit(1);
  }
}

/**
 * Get breakdown of games by primary source
 */
function getSourceBreakdown(games: UnifiedGame[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  
  for (const game of games) {
    breakdown[game.primarySource] = (breakdown[game.primarySource] || 0) + 1;
  }
  
  return breakdown;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

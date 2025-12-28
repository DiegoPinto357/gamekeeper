import { loadConfig } from './config';
import { steamAdapter } from './adapters/steam.adapter';
import { playniteAdapter } from './adapters/playnite.adapter';
import { createProtonDBAdapter } from './adapters/protondb.adapter';
import { createNotionClient } from './notion/notion.client';
import { processRawGames } from './core/deduplicate';
import { RawGameData, UnifiedGame } from './types/game';

/**
 * Main orchestration function
 * Coordinates the entire sync process
 */
const main = async () => {
  console.log('🎮 GameKeeper - Starting sync...\n');

  try {
    // 1. Load configuration
    console.log('📋 Loading configuration...');
    const config = loadConfig();
    console.log('✅ Configuration loaded\n');

    // 2. Initialize adapters
    console.log('🔧 Initializing adapters...');
    const protonDbAdapter = createProtonDBAdapter(
      '.cache/protondb',
      config.protondb.cacheDays
    );
    const notionClient = createNotionClient(
      config.notion.apiKey,
      config.notion.databaseId,
      config.notion.titleProperty,
      config.notion.syncProperties
    );

    await protonDbAdapter.init();
    console.log('✅ Adapters initialized\n');

    // 3. Verify Notion database access
    console.log('🔍 Verifying Notion database...');
    const notionAccessible = await notionClient.verifyDatabase();
    if (!notionAccessible) {
      throw new Error(
        'Cannot access Notion database. Check your API key and database ID.'
      );
    }
    console.log('✅ Notion database verified\n');

    // 4. Fetch games from all sources
    console.log('📥 Fetching games from sources...\n');

    const rawGames: RawGameData[] = [];

    // Fetch Steam games
    console.log('⚙️  Fetching from Steam...');
    try {
      const steamGames = await steamAdapter.fetchOwnedGames(
        config.steam.apiKey,
        config.steam.userId
      );
      rawGames.push(...steamGames);
      console.log(`✅ Steam: ${steamGames.length} games\n`);
    } catch (error) {
      console.error('❌ Failed to fetch Steam games:', error);
      console.log('Continuing without Steam data...\n');
    }

    // Load Playnite snapshot
    console.log('📦 Loading Playnite snapshot...');
    try {
      const playniteGames = await playniteAdapter.loadSnapshot(
        './data/playnite.json'
      );
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
    const pcGames = unifiedGames.filter(g => g.steamAppId);
    console.log(`Found ${pcGames.length} PC games to enrich`);

    for (let i = 0; i < unifiedGames.length; i++) {
      const game = unifiedGames[i];

      // Only enrich if game has a Steam AppID (PC games)
      if (game.steamAppId) {
        try {
          const protonInfo = await protonDbAdapter.fetchCompatibility(
            game.steamAppId
          );
          if (protonInfo) {
            game.proton = protonInfo;
            enrichedCount++;
          }

          // Progress indicator every 10 games
          if ((i + 1) % 10 === 0) {
            console.log(
              `  Progress: ${i + 1}/${pcGames.length} PC games processed...`
            );
          }

          // Rate limiting for ProtonDB
          if (enrichedCount % 5 === 0) {
            await sleep(1000);
          }
        } catch (error) {
          console.warn(
            `Failed to fetch ProtonDB data for "${game.name}":`,
            error
          );
        }
      }
    }

    console.log(`✅ Enriched ${enrichedCount} games with ProtonDB data\n`);

    // // 7. Clean expired ProtonDB cache
    // console.log('🧹 Cleaning expired ProtonDB cache...');
    // await protonDbAdapter.cleanCache();
    // console.log('✅ Cache cleaned\n');

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
};

/**
 * Get breakdown of games by primary source
 */
const getSourceBreakdown = (games: UnifiedGame[]): Record<string, number> => {
  const breakdown: Record<string, number> = {};

  for (const game of games) {
    breakdown[game.primarySource] = (breakdown[game.primarySource] || 0) + 1;
  }

  return breakdown;
};

/**
 * Sleep helper
 */
const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// Run main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

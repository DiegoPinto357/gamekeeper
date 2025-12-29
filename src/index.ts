import { loadConfig } from './config';
import { steamAdapter } from './adapters/steam.adapter';
import { playniteAdapter } from './adapters/playnite.adapter';
import { createProtonDBAdapter } from './adapters/protondb.adapter';
import { createGamePassAdapter } from './adapters/gamepass.adapter';
import { createNotionClient } from './notion/notion.client';
import { processRawGames } from './core/deduplicate';
import { loadOverrides } from './core/overrides';
import {
  generateMergeSuggestions,
  saveMergeSuggestions,
} from './core/suggestions';
import { RawGameData, UnifiedGame } from './types/game';
import fs from 'fs/promises';

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

    // 2. Load manual overrides
    await loadOverrides('./data/overrides.json');

    // 3. Initialize adapters
    console.log('🔧 Initializing adapters...');
    const protonDbAdapter = createProtonDBAdapter(
      '.cache/protondb',
      config.protondb.cacheDays
    );
    const gamePassAdapter = createGamePassAdapter(
      '.cache/gamepass',
      7 // Cache for 7 days
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
      // Load Game Pass interests list
      let gamePassInterests: string[] = [];
      try {
        const interestsContent = await fs.readFile(
          './data/gamepass-interests.json',
          'utf-8'
        );
        const interestsData = JSON.parse(interestsContent);
        gamePassInterests = interestsData.wantToPlay || [];
        console.log(
          `📝 Loaded ${gamePassInterests.length} Game Pass interests`
        );
      } catch {
        console.warn(
          '⚠️  No Game Pass interests file found, will include all owned Xbox games only'
        );
      }

      // Create Game Pass filter function
      const gamePassFilter = async (gameTitle: string): Promise<boolean> => {
        // Check if user wants to play this game
        const isInterested = gamePassInterests.some(
          interest =>
            interest.toLowerCase().trim() === gameTitle.toLowerCase().trim()
        );

        if (!isInterested) {
          return false; // Not interested, skip it
        }

        // Check if game is currently available on Game Pass
        const isAvailable = await gamePassAdapter.isGameAvailable(gameTitle);

        return isAvailable; // Only include if both interested AND available
      };

      const playniteGames = await playniteAdapter.loadSnapshot(
        './data/playnite.json',
        gamePassFilter
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

    // 6. Generate merge suggestions
    console.log('💡 Generating merge suggestions...');
    const suggestions = generateMergeSuggestions(rawGames);
    await saveMergeSuggestions(suggestions);
    console.log();

    // 7. Enrich PC games with ProtonDB data
    console.log('🐧 Enriching PC games with ProtonDB data...');
    const pcGames = unifiedGames.filter(g => g.steamAppId);
    console.log(`Found ${pcGames.length} PC games to enrich`);

    let enrichedCount = 0;
    const BATCH_SIZE = 20; // Process 20 games at a time (safe for cache reads)

    for (let i = 0; i < pcGames.length; i += BATCH_SIZE) {
      const batch = pcGames.slice(i, i + BATCH_SIZE);

      // Process batch in parallel
      await Promise.all(
        batch.map(async game => {
          try {
            const protonInfo = await protonDbAdapter.fetchCompatibility(
              game.steamAppId!
            );
            if (protonInfo) {
              game.proton = protonInfo;
              enrichedCount++;
            }
          } catch (error) {
            console.warn(
              `Failed to fetch ProtonDB data for "${game.name}":`,
              error
            );
          }
        })
      );

      // Progress indicator every batch
      const processed = Math.min(i + BATCH_SIZE, pcGames.length);
      if (processed % 20 === 0 || processed === pcGames.length) {
        console.log(
          `  Progress: ${processed}/${pcGames.length} PC games processed...`
        );
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

import '../bootstrap';
import { createGamePassAdapter } from '@gamekeeper/core';

/**
 * Utility script to view the current Game Pass catalog
 * Useful for finding exact game titles to add to gamepass-interests.json
 */
const main = async () => {
  console.log('🎮 Xbox Game Pass Catalog Viewer\n');

  const gamePassAdapter = createGamePassAdapter('.cache/gamepass', 7);

  try {
    console.log('📥 Fetching Game Pass catalog...\n');
    const catalog = await gamePassAdapter.getCatalog();

    console.log(`✅ Found ${catalog.length} games on Game Pass:\n`);

    // Sort alphabetically for easier browsing
    const sortedGames = catalog
      .map(g => g.title)
      .sort((a, b) => a.localeCompare(b));

    // Print in columns for better readability
    sortedGames.forEach((title, index) => {
      console.log(`  ${(index + 1).toString().padStart(4)}. ${title}`);
    });

    console.log(
      `\n💡 Copy exact titles to data/gamepass-interests.json to track them`
    );
  } catch (error) {
    console.error('❌ Failed to fetch catalog:', error);
    process.exit(1);
  }
};

main();

import { loadConfig } from '../config';
import { steamAdapter } from '../adapters/steam.adapter';

(async function main() {
  try {
    const config = loadConfig();

    if (!config.steam.apiKey || !config.steam.userId) {
      console.error('STEAM_API_KEY or STEAM_USER_ID missing in .env');
      process.exit(1);
    }

    console.log('Fetching Steam library...');
    const games = await steamAdapter.fetchOwnedGames(
      config.steam.apiKey,
      config.steam.userId
    );

    console.log(`Found ${games.length} Steam games:`);
    for (const g of games) {
      console.log(`${g.steamAppId || 'n/a'}\t${g.name}\tplaytimeHours:${g.playtimeHours || 0}`);
    }

    const examples = ['dirt 2', 'not my war'];
    console.log('\nLookup for example titles:');
    for (const ex of examples) {
      const matches = games.filter(g => g.name.toLowerCase().includes(ex));
      if (matches.length === 0) {
        console.log(`  - "${ex}" not found`);
      } else {
        for (const m of matches) console.log(`  - Found: ${m.steamAppId} ${m.name}`);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error('Error fetching Steam games:', err);
    process.exit(1);
  }
})();
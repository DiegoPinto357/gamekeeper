import { loadConfig } from '../config';
import { steamAdapter } from '../adapters/steam.adapter';
import { calculateNameSimilarity, normalizeGameName } from '../core/normalize';

(async function main() {
  try {
    const config = loadConfig();

    if (!config.steam.apiKey || !config.steam.userId) {
      console.error('STEAM_API_KEY or STEAM_USER_ID missing in .env');
      process.exit(1);
    }

    const query = 'Not My War';
    console.log(`Searching Steam library for near-matches to: "${query}"\n`);

    const games = await steamAdapter.fetchOwnedGames(
      config.steam.apiKey,
      config.steam.userId
    );

    console.log(`Total owned Steam games: ${games.length}\n`);

    const normQuery = normalizeGameName(query);
    const exactNormalized = games.filter(g => normalizeGameName(g.name) === normQuery);
    if (exactNormalized.length > 0) {
      console.log('Exact normalized matches:');
      for (const g of exactNormalized) {
        console.log(` - ${g.steamAppId || 'n/a'}\t${g.name}`);
      }
      process.exit(0);
    }

    // Compute similarity scores and show top candidates
    const scored = games
      .map(g => ({ steamAppId: g.steamAppId, name: g.name, score: calculateNameSimilarity(g.name, query) }))
      .sort((a, b) => b.score - a.score);

    console.log('Top 15 closest matches (score % / SteamAppID / Title):');
    for (let i = 0; i < Math.min(15, scored.length); i++) {
      const s = scored[i];
      console.log(` ${ (s.score * 100).toFixed(1).padStart(5)}%  \t${s.steamAppId || 'n/a'}\t${s.name}`);
    }

    // Also check simple substring tokens
    const tokenMatches = games.filter(g => {
      const lower = g.name.toLowerCase();
      return lower.includes('not my war') || (lower.includes('not') && lower.includes('war')) || lower.includes('my war');
    });

    if (tokenMatches.length > 0) {
      console.log('\nToken matches:');
      for (const g of tokenMatches) {
        console.log(` - ${g.steamAppId || 'n/a'}\t${g.name}`);
      }
    } else {
      console.log('\nNo token matches found.');
    }

    process.exit(0);
  } catch (err) {
    console.error('Error during fuzzy search:', err);
    process.exit(1);
  }
})();
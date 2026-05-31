export { loadConfig } from './config';
export { steamAdapter } from './adapters/steam.adapter';
export { playniteAdapter } from './adapters/playnite.adapter';
export { heroicAdapter } from './adapters/heroic.adapter';
export { createProtonDBAdapter } from './adapters/protondb.adapter';
export { createGamePassAdapter } from './adapters/gamepass.adapter';
export { igdbAdapter } from './adapters/igdb.adapter';
export { createNotionClient } from './notion/notion.client';
export { processRawGames } from './core/deduplicate';
export { loadOverrides } from './core/overrides';
export { normalizeGameName, calculateNameSimilarity } from './core/normalize';
export {
  generateMergeSuggestions,
  saveMergeSuggestions,
} from './core/suggestions';
export {
  loadOwnedXboxGames,
  processGamePassAvailability,
  saveUnavailableGames,
  getInterestGamesToSync,
  shouldSyncToNotion,
  resolveXboxSource,
} from './core/xbox-gamepass';
export type { RawGameData, UnifiedGame, Source, Config } from './types/game';

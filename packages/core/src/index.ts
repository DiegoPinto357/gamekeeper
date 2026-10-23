export { loadConfig } from './config';
export {
  log,
  getLogger,
  setLogger,
  silentLogger,
  consoleLogger,
  type Logger,
} from './logger';
export { runSync } from './sync/orchestrator';
export { defaultSyncIO } from './sync/default-io';
export type {
  SyncEvent,
  SyncSummary,
  SyncOptions,
  SyncDeps,
  SyncIO,
  SyncAdapters,
  SyncStepKey,
} from './sync/types';
export { steamAdapter } from './adapters/steam.adapter';
export { playniteAdapter } from './adapters/playnite.adapter';
export { heroicAdapter } from './adapters/heroic.adapter';
export { createProtonDBAdapter } from './adapters/protondb.adapter';
export { createGamePassAdapter } from './adapters/gamepass.adapter';
export { igdbAdapter } from './adapters/igdb.adapter';
export { createNotionClient } from './notion/notion.client';
export { processRawGames } from './core/deduplicate';
export { loadOverrides } from './core/overrides';
export { normalizeGameName, calculateNameSimilarity, wordSortedKey } from './core/normalize';
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
export {
  openDb,
  defaultDbPath,
  type Db,
  migrate,
  MIGRATIONS,
  seedStatuses,
  DEFAULT_STATUSES,
  type StatusSeed,
  upsertGames,
  getGame,
  listGames,
  rebuildGamesFts,
  reconcileUnavailableReasons,
  type UnavailableFlag,
  listStatuses,
  getLibraryGames,
  setGameStatus,
  materializeBacklog,
  UnknownStatusError,
  UnknownGameError,
  type StatusEntry,
  type LibraryGame,
  type SetStatusResult,
  installSqliteWarningSuppression,
} from './db/index';
